"use client";

import type { Application } from "pixi.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AvatarAdapter } from "@/lib/adapters/AvatarAdapter";
import {
  canvasToPngBlob,
  compositeProcessedComponents,
  fetchProviders,
  type ProviderAvailability,
  postprocessGeneratedBlob,
  prepareOpenAISourcesFromMasks,
  prepareOpenAISourcesPerComponent,
  refinePrompt,
  submitGenerate,
} from "@/lib/ai/client";
import type { ProviderId } from "@/lib/ai/types";
import { renderPuppetReference } from "@/lib/avatar/canonicalPoseRender";
import {
  bboxFromMask,
  type ComponentInfo,
  componentThumbnail,
  findAlphaComponents,
} from "@/lib/avatar/connectedComponents";
import { buildInpaintMaskFromAlpha } from "@/lib/avatar/inpaintMask";
import { bakeTransparencyToNeutral, padInpaintMaskToFrame } from "@/lib/avatar/inpaintSourcePrep";
import { extractCurrentLayerCanvas } from "@/lib/avatar/regionExtract";
import type { Layer } from "@/lib/avatar/types";
import { componentSignature, useComponentLabels } from "@/lib/avatar/useComponentLabels";
import { useReferences } from "@/lib/avatar/useReferences";
import { useRegionMasks } from "@/lib/avatar/useRegionMasks";
import {
  type AIJobRow,
  deleteLayerOverride,
  listAIJobsForLayer,
  saveAIJob,
} from "@/lib/persistence/db";
import { useEditorStore } from "@/lib/store/editor";
import { DecomposeStudio } from "./DecomposeStudio";

type Props = {
  adapter: AvatarAdapter | null;
  /** Pixi Application instance behind the editor canvas. Used to capture
   *  a full-character reference snapshot at submit time so AI calls
   *  ride along with spatial context for the drawable being edited.
   *  Null while the puppet is still loading. */
  app: Application | null;
  layer: Layer;
  /** Stable puppet key for IDB job history. `null` disables persistence. */
  puppetKey: string | null;
};

/**
 * AI texture generation modal. The submit path now hits real backends
 * — Google Gemini (Nano Banana) and OpenAI gpt-image-2 — through the
 * Next.js `/api/ai/*` routes. Replicate / SDXL ControlNet lands in
 * Sprint 3.2; the picker shows it as unavailable until then.
 *
 * Flow:
 *   1. Mount → extractLayerCanvas captures the layer footprint.
 *   2. Mount → fetch /api/ai/providers to learn which keys are set.
 *   3. User picks provider, types prompt, clicks generate.
 *   4. Client converts source / mask to the provider's expected
 *      shape (canvasToPngBlob, padToOpenAISquare, buildOpenAIMaskCanvas).
 *   5. submitGenerate POSTs and polls until done; returns the result blob.
 *   6. Preview shown next to the source. Apply-to-atlas lands in 3.3.
 */
export function GeneratePanel({ adapter, app, layer, puppetKey }: Props) {
  const close = useEditorStore((s) => s.setGenerateLayer);
  const existingMask = useEditorStore((s) => s.layerMasks[layer.id] ?? null);
  const existingTexture = useEditorStore((s) => s.layerTextureOverrides[layer.id] ?? null);
  const setLayerTextureOverride = useEditorStore((s) => s.setLayerTextureOverride);

  const sourceRef = useRef<HTMLCanvasElement | null>(null);
  /** G.7: separate canvas for the focused-region RESULT preview.
   *  In multi-region focus mode the composite blob is at the full
   *  layer-source dims (≈4k px) — when scaled to the RESULT panel's
   *  ~500×500 box, this region's edited area becomes a few pixels
   *  and the silent UX failure mode is "I generated, ✓ generated
   *  shows, but RESULT looks blank." Painting just the focused
   *  region's bbox (same crop the SOURCE preview uses) into a
   *  dedicated canvas fixes the visibility. */
  const resultRef = useRef<HTMLCanvasElement | null>(null);
  /** Source we send to the AI: post-gen, *pre-mask*. Keeping the
   *  pixels populated under the layer's mask region matters — gpt-
   *  image-2 falls back to free generation when its input is mostly
   *  transparent, so an aggressively pre-masked source produces
   *  prompt-only outputs ("skin" → a hand) instead of edits. The mask
   *  blob is sent separately and tells the model what to preserve. */
  const aiSourceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  /** Source we display in the panel: post-gen, *post-mask*. Matches
   *  what the live atlas renders. */
  const previewSourceRef = useRef<HTMLCanvasElement | null>(null);
  /** Pristine source — extracted with NO texture override applied.
   *  Used by per-region revert: when the user wants to wipe just
   *  one region's edits back to the original atlas content (not
   *  the whole layer like the existing "revert texture" does), we
   *  isolate that region's silhouette out of this canvas and
   *  swap it into regionStates. */
  const originalSourceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [providers, setProviders] = useState<ProviderAvailability[] | null>(null);
  const [providerId, setProviderId] = useState<ProviderId>("gemini");
  const [modelId, setModelId] = useState<string>("");
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");

  /** GeneratePanel tabs. "gen" is the existing source+preview+controls
   *  experience; "mask" is the inpaint-mask brush surface. The two
   *  share `inpaintMaskBlob` state. */
  const [activeTab, setActiveTab] = useState<"gen" | "mask">("gen");
  /** User-painted inpaint mask. `null` = no user override — fall back
   *  to "whole component = edit zone" at submit time. Stays in
   *  component-local state (no IDB persistence) because the natural
   *  lifecycle is one editing session per layer.
   *
   *  NOT the same thing as the DecomposeStudio mask. See
   *  `components/GenerateMaskEditor.tsx` for the convention split. */
  const [inpaintMaskBlob, setInpaintMaskBlob] = useState<Blob | null>(null);
  /** Object URL for the inpaint mask preview shown next to the SOURCE
   *  label. Held as state so the URL stays stable across renders and
   *  gets revoked on cleanup. */
  const [inpaintMaskPreviewUrl, setInpaintMaskPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!inpaintMaskBlob) {
      setInpaintMaskPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(inpaintMaskBlob);
    setInpaintMaskPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [inpaintMaskBlob]);

  /** Last submit's component count, surfaced in the structured submit
   *  log so the user can correlate result quality with how many
   *  per-island calls fired. Multi-component layers (e.g. torso +
   *  shoulder frill in one slot) split into N parallel OpenAI calls
   *  and N postprocesses are composited back into a single texture. */
  const lastComponentCountRef = useRef<number>(0);

  /** Per-region info computed at mount time from the AI source canvas.
   *  When > 1 the panel switches into multi-region mode: each component
   *  gets its own thumbnail + sub-prompt textarea, and the source
   *  preview overlays color-coded outlines so the user can see which
   *  bbox is which. Empty / single-component layers stay in the
   *  classic single-prompt UI. */
  const [components, setComponents] = useState<ComponentInfo[]>([]);
  const [componentThumbs, setComponentThumbs] = useState<HTMLCanvasElement[]>([]);
  /** Per-region prompt strings, indexed by component id. Edited
   *  independently of `prompt`. The submit pipeline appends each
   *  string to the common prompt and sends one composed prompt per
   *  component call. */
  const [componentPrompts, setComponentPrompts] = useState<string[]>([]);

  /** G: which region the modal is currently focused on. Drives the
   *  single-region UX — SOURCE / RESULT / prompt / generate all bind
   *  to this one region. Multi-region layers default to `null` so
   *  the user lands on a picker view first and explicitly enters a
   *  region; single-component layers auto-focus index 0 so they
   *  look identical to the legacy single-source UX. The earlier
   *  "generate all 6 at once" flow is deliberately gone — per the
   *  user, simultaneous edits across many regions don't reflect how
   *  the work actually goes (you fix one region at a time). */
  const [focusedRegionIdx, setFocusedRegionIdx] = useState<number | null>(null);

  /** F.2: per-region run state. Each entry tracks the latest blob
   *  this region contributes to the composite + its current call
   *  status. On mount we seed every region with its isolated source
   *  blob (the unedited original) so the composite the user sees in
   *  RESULT matches what the atlas would render with no edits. As
   *  individual regions get regenerated, only those entries flip to
   *  the postprocessed gen output — letting the user iterate one
   *  region at a time without disrupting the others. */
  type RegionRunState = {
    resultBlob: Blob;
    status: "idle" | "running" | "succeeded" | "failed";
    failedReason?: string;
  };
  const [regionStates, setRegionStates] = useState<RegionRunState[]>([]);
  /** Mirror of `regionStates` for synchronous access from async
   *  callbacks. The previous implementation relied on capturing
   *  `next.map(...)` inside a `setRegionStates(updater)` callback
   *  to feed the result into `recompositeResult` — but in React 18
   *  the updater runs asynchronously, so by the time `await`
   *  yielded the captured array was still its `[]` initial value.
   *  Empty array → composite blob with no per-region content →
   *  apply-to-atlas wrote a blank texture and the user saw no
   *  change. Reading the latest blobs from this ref dodges the
   *  race entirely. */
  const regionStatesRef = useRef<RegionRunState[]>([]);
  useEffect(() => {
    regionStatesRef.current = regionStates;
  }, [regionStates]);
  /** Cache of `prepareOpenAISources*` output. Built once at mount
   *  and reused across both generate-all and per-region regenerate
   *  so we don't pay the isolation / pad cost on every call. */
  const preparedRef = useRef<import("@/lib/ai/client").PreparedComponent[] | null>(null);

  /** G: focus-mode binding helpers. When the panel is focused on a
   *  specific region of a multi-region layer, the textarea reads /
   *  writes that region's componentPrompts entry; the legacy panel
   *  `prompt` state stays the source of truth for everything else
   *  (Gemini single-source, single-component OpenAI). The Generate
   *  button likewise dispatches to `regenerateOneRegion(focused)`
   *  in multi-region focus or `onSubmit` otherwise. Declared up
   *  here so the SOURCE / RESULT preview effects can read them. */
  const isFocusedMulti =
    components.length > 1 && focusedRegionIdx !== null && focusedRegionIdx >= 0;
  const focusedPromptValue = isFocusedMulti
    ? (componentPrompts[focusedRegionIdx ?? 0] ?? "")
    : prompt;
  const setFocusedPromptValue = (val: string) => {
    if (isFocusedMulti && focusedRegionIdx !== null) {
      const idx = focusedRegionIdx;
      setComponentPrompts((prev) => {
        const next = [...prev];
        next[idx] = val;
        return next;
      });
    } else {
      setPrompt(val);
    }
  };
  const focusedRegionState =
    isFocusedMulti && focusedRegionIdx !== null ? regionStates[focusedRegionIdx] : null;

  /** Color palette cycled across components for the source-overlay
   *  outlines and the per-region tile borders. Six saturated hues
   *  that read cleanly on the dark panel background and remain
   *  distinguishable for typical multi-island counts (2–4). */
  const COMPONENT_COLORS = useMemo(
    () => ["#22c55e", "#f97316", "#ec4899", "#3b82f6", "#eab308", "#a855f7"],
    [],
  );

  // E.3 — manually-defined regions painted in DecomposeStudio's
  // split mode. When non-empty these take precedence over auto-
  // detected components; the user has chosen explicit boundaries
  // and naming, so we honor them. Declared before the mount effect
  // so the effect can read the hook's value.
  const { regions: manualRegions } = useRegionMasks(puppetKey, layer.externalId);
  /** "manual" when manualRegions drove the components state; "auto"
   *  when findAlphaComponents did. Surfaced in the panel + diagnostic
   *  log so the user can tell which path is active. */
  const [regionSource, setRegionSource] = useState<"manual" | "auto">("auto");

  /** Persisted history for this layer. Newest first. Repopulated on
   *  every successful save so the list reflects what's in IDB. */
  const [history, setHistory] = useState<AIJobRow[]>([]);
  /** History rows selected for the side-by-side comparison viewer.
   *  Capped at 2 — user picks A and B, opens compare modal, sees them
   *  next to each other with metadata. Selection is independent of
   *  the "click to revisit" action that the row body still owns. */
  const [comparisonIds, setComparisonIds] = useState<string[]>([]);
  const [comparisonOpen, setComparisonOpen] = useState(false);

  /** Puppet reference rows the user explicitly toggled OFF for this
   *  session. Default-state is ON for everything; persistence isn't
   *  warranted since the disable is usually a "skip this once"
   *  decision while iterating. */
  const [disabledRefIds, setDisabledRefIds] = useState<Set<string>>(new Set());
  /** Iterative refinement: when ON, the most recent succeeded result
   *  rides along on the next submit as an additional reference. This
   *  is the cloud-API stand-in for previous_response_id-style chaining
   *  — the model sees "what I just made" alongside "what the user
   *  wants now" and refines instead of starting from scratch. */
  const [useLastResult, setUseLastResult] = useState(true);
  /** Most recent succeeded blob in this panel session. Replaced after
   *  every success; not persisted, so closing the panel resets it. */
  const [lastResultBlob, setLastResultBlob] = useState<Blob | null>(null);

  /** Sprint 5.4 — when ON, the user's prompt is run through a chat
   *  model on the way to gpt-image-2 so vague phrasing gets reshaped
   *  into the explicit slot-mapping / preservation language the
   *  image edit endpoint responds best to. Default ON for OpenAI;
   *  meaningless for providers that don't take refs. */
  const [usePromptRefine, setUsePromptRefine] = useState(true);
  /** The most recent server-returned refined prompt + the model that
   *  produced it, shown in the "what we actually sent" diagnostic
   *  block once a generate cycle completes its refinement step. */
  const [refinement, setRefinement] = useState<{
    refined: string;
    rawAtRefine: string;
    model: string;
  } | null>(null);
  const [refining, setRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);

  const [phase, setPhase] = useState<
    | { kind: "idle" }
    | { kind: "submitting" }
    | { kind: "running" }
    | { kind: "succeeded"; url: string; blob: Blob }
    | { kind: "applying" }
    | { kind: "failed"; reason: string }
  >({ kind: "idle" });

  // ----- mount: extract two source canvases -----
  // The display canvas mirrors the live atlas (post-gen + post-mask)
  // so the user sees what's currently rendered. The AI canvas keeps
  // the mask region populated so gpt-image-2 has dense content to
  // edit; the mask still ships separately and tells the model what
  // to preserve.
  useEffect(() => {
    setReady(false);
    setError(null);
    if (!adapter || !layer.texture) {
      setError("이 레이어에는 텍스처 영역이 없습니다");
      return;
    }

    let cancelled = false;
    void (async () => {
      const aiExtracted = await extractCurrentLayerCanvas(adapter, layer, {
        texture: existingTexture,
        // mask deliberately omitted — see comment on aiSourceCanvasRef
      });
      if (cancelled) return;
      if (!aiExtracted) {
        setError("영역이 비어있거나 렌더링할 수 없습니다");
        return;
      }
      aiSourceCanvasRef.current = aiExtracted.canvas;

      // Pristine source for per-region revert. Pass `texture: null`
      // explicitly (no override applied) so the extracted canvas
      // shows whatever the atlas would render with all AI textures
      // wiped. Falls back to aiSource when there's no existing
      // texture override (the two are identical anyway).
      if (existingTexture) {
        const originalExtracted = await extractCurrentLayerCanvas(adapter, layer, {
          texture: null,
        });
        if (cancelled) return;
        originalSourceCanvasRef.current = originalExtracted?.canvas ?? aiExtracted.canvas;
      } else {
        originalSourceCanvasRef.current = aiExtracted.canvas;
      }

      const previewExtracted = await extractCurrentLayerCanvas(adapter, layer, {
        texture: existingTexture,
        mask: existingMask,
      });
      if (cancelled) return;
      previewSourceRef.current = previewExtracted?.canvas ?? aiExtracted.canvas;

      // E.3: pick region source. If the user painted manual regions
      // in DecomposeStudio's split mode, those take precedence —
      // their boundaries / names / colors flow straight into the
      // panel + the submit pipeline. Otherwise fall back to
      // findAlphaComponents auto-detection. Both paths produce a
      // ComponentInfo[] that the rest of the panel consumes
      // uniformly; manual entries carry `name` + `color` so the UI
      // can render readonly names + matching swatches.
      let regionList: ComponentInfo[];
      let activeSource: "manual" | "auto";
      if (manualRegions.length > 0) {
        activeSource = "manual";
        regionList = [];
        for (let i = 0; i < manualRegions.length; i++) {
          const r = manualRegions[i];
          const c = document.createElement("canvas");
          c.width = aiExtracted.canvas.width;
          c.height = aiExtracted.canvas.height;
          const cctx = c.getContext("2d");
          if (cctx) {
            try {
              const url = URL.createObjectURL(r.maskBlob);
              const img = await new Promise<HTMLImageElement>((resolve, reject) => {
                const i2 = new Image();
                i2.onload = () => resolve(i2);
                i2.onerror = () => reject(new Error("image load failed"));
                i2.src = url;
              });
              URL.revokeObjectURL(url);
              cctx.drawImage(img, 0, 0, c.width, c.height);
            } catch {
              // skip — region's mask couldn't decode; leave canvas blank
            }
          }
          const bbox = bboxFromMask(c);
          if (!bbox) continue;
          regionList.push({
            id: i,
            bbox: { x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h },
            area: bbox.area,
            maskCanvas: c,
            name: r.name,
            color: r.color,
          });
        }
      } else {
        activeSource = "auto";
        regionList = findAlphaComponents(aiExtracted.canvas);
      }
      if (cancelled) return;
      const thumbs = regionList.map((c) => componentThumbnail(aiExtracted.canvas, c, 96));
      setRegionSource(activeSource);
      setComponents(regionList);
      setComponentThumbs(thumbs);
      // Initialize per-region prompts to empty strings. Existing
      // prompts (if user re-opens the same layer) are reset because
      // the component identity isn't stable across mounts.
      setComponentPrompts(regionList.map(() => ""));

      // F.2: pre-prepare each region's submit-ready package + seed
      // regionStates with the unedited isolated source. This lets
      // per-region regenerate skip the isolation/pad work on each
      // click and lets RESULT show the correct partial-state
      // composite even before the first generate.
      preparedRef.current = null;
      if (regionList.length > 0) {
        try {
          const prepared =
            activeSource === "manual"
              ? await prepareOpenAISourcesFromMasks(
                  aiExtracted.canvas,
                  regionList.map((c) => c.maskCanvas),
                )
              : await prepareOpenAISourcesPerComponent(aiExtracted.canvas);
          if (cancelled) return;
          preparedRef.current = prepared;

          const initStates: RegionRunState[] = await Promise.all(
            prepared.map(async (p) => {
              const blob = await canvasToPngBlob(p.isolatedSource);
              return { resultBlob: blob, status: "idle" as const };
            }),
          );
          if (cancelled) return;
          setRegionStates(initStates);
        } catch (e) {
          console.warn("[GeneratePanel] prepare regions failed", e);
          setRegionStates([]);
        }
      } else {
        setRegionStates([]);
      }

      // G: pick the initial focused region. Single-component layers
      // (and Gemini single-source) auto-enter focus on index 0 so
      // the existing UX is preserved end-to-end. Multi-region layers
      // start at the picker view (focus = null) — the user explicitly
      // picks which region to work on.
      setFocusedRegionIdx(regionList.length === 1 ? 0 : null);

      setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [adapter, layer, existingTexture, existingMask, manualRegions]);

  // ----- after-mount: paint preview onto the display canvas -----
  // Split from the extract effect because the display `<canvas>` is only
  // rendered when `ready === true`, so its ref isn't attached during the
  // same effect tick that flips ready. This effect runs after the next
  // render, when the canvas is actually in the DOM.
  //
  // G: when focused on a specific region in a multi-region layer, we
  // tight-crop the AI source to that region's bbox + apply the
  // component mask, so the SOURCE preview shows only the region the
  // user is editing (not the whole layer with other regions visible
  // in the corners). Single-component layers and the picker view
  // both fall through to painting the full preview.
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeTab is intentional — forces redraw when the GEN body remounts after a MASK-tab visit
  useEffect(() => {
    if (!ready) return;
    const display = sourceRef.current;
    if (!display) return;

    if (components.length > 1 && focusedRegionIdx !== null && components[focusedRegionIdx]) {
      const c = components[focusedRegionIdx];
      const aiSource = aiSourceCanvasRef.current;
      if (aiSource) {
        display.width = c.bbox.w;
        display.height = c.bbox.h;
        const ctx = display.getContext("2d");
        if (ctx) {
          ctx.clearRect(0, 0, display.width, display.height);
          ctx.drawImage(aiSource, c.bbox.x, c.bbox.y, c.bbox.w, c.bbox.h, 0, 0, c.bbox.w, c.bbox.h);
          ctx.globalCompositeOperation = "destination-in";
          ctx.drawImage(
            c.maskCanvas,
            c.bbox.x,
            c.bbox.y,
            c.bbox.w,
            c.bbox.h,
            0,
            0,
            c.bbox.w,
            c.bbox.h,
          );
          ctx.globalCompositeOperation = "source-over";
        }
        return;
      }
    }

    const preview = previewSourceRef.current;
    if (!preview) return;
    display.width = preview.width;
    display.height = preview.height;
    display.getContext("2d")?.drawImage(preview, 0, 0);
    // `activeTab` is in deps so the SOURCE canvas redraws when the
    // user comes back from the MASK tab — the GEN body is unmounted
    // while MASK is active, so the new canvas DOM is blank on
    // remount and we have to repaint it.
  }, [ready, focusedRegionIdx, components, activeTab]);

  // ----- G.7: focus-mode RESULT preview -----
  // Paints the focused region's `regionStates[idx].resultBlob`
  // tight-cropped into the RESULT canvas. Same bbox as the SOURCE
  // preview, so the user can compare 1:1. In picker view (not
  // focused) this canvas isn't rendered; in single-component /
  // Gemini paths the legacy `<img src={phase.url}>` still drives
  // RESULT.
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeTab forces redraw on GEN-tab remount (mirrors the SOURCE preview effect)
  useEffect(() => {
    if (!ready) return;
    if (!isFocusedMulti || focusedRegionIdx === null) return;
    const display = resultRef.current;
    if (!display) return;
    const c = components[focusedRegionIdx];
    const state = regionStates[focusedRegionIdx];
    if (!c || !state) return;

    let cancelled = false;
    const url = URL.createObjectURL(state.resultBlob);
    const img = new Image();
    img.onload = () => {
      if (cancelled) {
        URL.revokeObjectURL(url);
        return;
      }
      display.width = c.bbox.w;
      display.height = c.bbox.h;
      const ctx = display.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, display.width, display.height);
        // The result blob is at full source-canvas dims with content
        // only at this region's silhouette. Crop the bbox area in,
        // matching the SOURCE preview's framing exactly.
        ctx.drawImage(img, c.bbox.x, c.bbox.y, c.bbox.w, c.bbox.h, 0, 0, c.bbox.w, c.bbox.h);
      }
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
    };
    img.src = url;

    return () => {
      cancelled = true;
    };
    // `activeTab` so RESULT canvas redraws on GEN-tab remount, same
    // reason as the SOURCE preview effect above.
  }, [ready, isFocusedMulti, focusedRegionIdx, components, regionStates, activeTab]);

  // ----- mount: load AI job history for this layer -----
  useEffect(() => {
    if (!puppetKey) {
      setHistory([]);
      return;
    }
    let cancelled = false;
    listAIJobsForLayer(puppetKey, layer.externalId)
      .then((rows) => {
        if (!cancelled) setHistory(rows);
      })
      .catch((e) => {
        console.warn("[GeneratePanel] history load failed", e);
      });
    return () => {
      cancelled = true;
    };
  }, [puppetKey, layer.externalId]);

  // ----- mount: load provider availability -----
  useEffect(() => {
    let cancelled = false;
    fetchProviders()
      .then((list) => {
        if (cancelled) return;
        setProviders(list);
        // pick the first available; fall back to gemini even if disabled
        const firstAvail = list.find((p) => p.available);
        if (firstAvail) {
          setProviderId(firstAvail.id);
          setModelId(firstAvail.capabilities.defaultModelId);
        }
      })
      .catch((e) => {
        console.warn("[GeneratePanel] /api/ai/providers failed", e);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Update modelId when provider changes
  useEffect(() => {
    const p = providers?.find((x) => x.id === providerId);
    if (p) setModelId(p.capabilities.defaultModelId);
  }, [providerId, providers]);

  /** G/F-style close guard. Three failure modes a stray click can
   *  hit:
   *    1. Generation in flight — closing drops the API call's
   *       result on the floor (the cost was already paid). Reject
   *       the close outright with an alert; the user can hit
   *       "reset · keep generating" if they actually want to
   *       discard the run.
   *    2. Succeeded result not applied — closing wipes the result
   *       blob from memory. Confirm-to-discard.
   *    3. Per-region focused result not applied — same risk for
   *       multi-region focus mode. Confirm-to-discard.
   *  Used by every dismiss path: header close, backdrop click,
   *  Esc key. */
  const requestClose = useCallback(() => {
    if (
      phase.kind === "running" ||
      phase.kind === "submitting" ||
      phase.kind === "applying" ||
      refining
    ) {
      if (typeof window !== "undefined") {
        window.alert(
          "생성이 진행 중입니다. 완료될 때까지 기다리거나 'reset · keep generating' 으로 진행 중인 작업을 취소한 후 닫아주세요.",
        );
      }
      return;
    }
    const hasUnappliedComposite = phase.kind === "succeeded";
    const hasUnappliedRegion = regionStates.some((s) => s.status === "succeeded");
    if (hasUnappliedComposite || hasUnappliedRegion) {
      if (typeof window !== "undefined") {
        const ok = window.confirm(
          "적용되지 않은 생성 결과가 있습니다.\n\n" +
            "확인 = 결과를 버리고 닫기\n" +
            "취소 = 계속 편집 ('apply to atlas' 로 결과를 적용한 후 닫기)",
        );
        if (!ok) return;
      }
    }
    close(null);
  }, [phase.kind, refining, regionStates, close]);

  // Esc routes through the guard so in-flight jobs are protected
  // and unsaved results prompt a confirm.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose]);

  // Cleanup blob URL on phase change / unmount
  useEffect(() => {
    return () => {
      if (phase.kind === "succeeded") URL.revokeObjectURL(phase.url);
    };
  }, [phase]);

  // Capture the most recent succeeded blob into `lastResultBlob` so
  // the iterative-anchor toggle can pick it up on the next submit.
  // We don't reset to null on a subsequent failure — the user might
  // tweak the prompt and retry, and that retry should still chain
  // off whatever last worked.
  useEffect(() => {
    if (phase.kind === "succeeded") {
      setLastResultBlob(phase.blob);
    }
  }, [phase]);

  const provider = providers?.find((p) => p.id === providerId);

  // Per-puppet character / style refs. Forwarded as `image[]` to
  // providers whose capabilities advertise multi-image input
  // (gpt-image-2). Other providers see them dropped at the route.
  const { references } = useReferences(puppetKey);

  // E.1 — persisted per-component labels keyed by component bbox.
  const { labels: componentLabels, setLabel: setComponentLabel } = useComponentLabels(
    puppetKey,
    layer.externalId,
  );
  const supportsRefs = provider?.capabilities.supportsReferenceImages === true;
  /** Composition order matters — model treats earlier image[] entries
   *  as the dominant anchor. We put user-uploaded refs first (the
   *  user's deliberate "this is the character" signal), then the
   *  iterative anchor (this run's predecessor) so it nudges rather
   *  than overrides. */
  const activeRefBlobs: Blob[] = supportsRefs
    ? [
        ...references.filter((r) => !disabledRefIds.has(r.id)).map((r) => r.blob),
        ...(useLastResult && lastResultBlob ? [lastResultBlob] : []),
      ]
    : [];

  /** Toggle a row in/out of the comparison set. Capped at 2 — third
   *  click drops the oldest selection. Easier UX than disabling the
   *  third checkbox. */
  function toggleComparison(rowId: string) {
    setComparisonIds((prev) => {
      if (prev.includes(rowId)) return prev.filter((id) => id !== rowId);
      const next = [...prev, rowId];
      return next.length > 2 ? next.slice(next.length - 2) : next;
    });
  }
  /** History filtered to the currently-focused region (multi-region
   *  focus mode only). Each apply tags its row with the focused
   *  region's bbox signature; history filtered to matches gives the
   *  user a per-region log of attempts so revisiting / comparing
   *  stays scoped. Picker view (no focus) and single-source layers
   *  see the full history list. Old rows without a regionSignature
   *  show only in non-focused views. */
  const visibleHistory = useMemo(() => {
    if (!isFocusedMulti || focusedRegionIdx === null) return history;
    const focusedComp = components[focusedRegionIdx];
    if (!focusedComp) return history;
    const sig = componentSignature(focusedComp.bbox);
    return history.filter((r) => r.regionSignature === sig);
  }, [history, isFocusedMulti, focusedRegionIdx, components]);
  const comparisonRows = useMemo(
    () =>
      comparisonIds
        .map((id) => visibleHistory.find((r) => r.id === id))
        .filter((r): r is AIJobRow => !!r),
    [comparisonIds, visibleHistory],
  );
  // Drop selections that no longer exist (e.g. history was reloaded
  // and a row got pruned). Run after every history fetch.
  useEffect(() => {
    setComparisonIds((prev) => prev.filter((id) => history.some((r) => r.id === id)));
  }, [history]);

  /** F.2: run one region's gen call end-to-end. Used by both
   *  "generate all" (looped over every prepared component) and the
   *  per-region ↻ button (called for a single index). The caller
   *  builds the refined prompt + active refs once and threads them
   *  through; this helper just composes the per-region prompt,
   *  fires the API call, and postprocesses the result into a
   *  source-canvas-sized blob with only this region's silhouette
   *  populated. */
  const runRegionGen = useCallback(
    async (
      idx: number,
      prepared: import("@/lib/ai/client").PreparedComponent[],
      baseText: string,
      refsBlobs: Blob[],
    ): Promise<Blob> => {
      const comp = prepared[idx];
      const perRegion = (componentPrompts[idx] ?? "").trim();
      const detected = components[idx];
      const label = detected
        ? (detected.name ?? componentLabels[componentSignature(detected.bbox)] ?? "").trim()
        : "";
      const regionDescriptor = label
        ? `region '${label}' (${idx + 1} of ${prepared.length}, ${comp.sourceBBox.w}×${comp.sourceBBox.h} px)`
        : `region ${idx + 1} of ${prepared.length} (${comp.sourceBBox.w}×${comp.sourceBBox.h} px)`;
      // F.4: when the user is doing per-region work and didn't fill
      // COMMON CONTEXT, the panel-level `prompt` is empty — the API
      // route rejects that with a 400 (`prompt` is required). Fall
      // back to the per-region textarea as the raw prompt in that
      // case so the request is well-formed even without a shared
      // common context.
      const baseTrimmed = baseText.trim();
      const composedPrompt =
        baseTrimmed.length > 0
          ? perRegion
            ? `${baseText}\n\nFor [image 1] (${regionDescriptor}): ${perRegion}`
            : label
              ? `${baseText}\n\n[image 1] is the ${label} region.`
              : baseText
          : perRegion
            ? `For [image 1] (${regionDescriptor}): ${perRegion}`
            : label
              ? `[image 1] is the ${label} region.`
              : "";
      const rawPromptForRoute =
        prompt.trim().length > 0 ? prompt : perRegion.length > 0 ? perRegion : "";
      const compSourceBlob = await canvasToPngBlob(comp.padded);
      const rawResult = await submitGenerate({
        providerId,
        prompt: rawPromptForRoute,
        refinedPrompt: composedPrompt || undefined,
        negativePrompt: negativePrompt.trim() || undefined,
        modelId: modelId || undefined,
        sourceImage: compSourceBlob,
        // User MASK travels as a soft region hint via image[] (see
        // openai.ts composePrompt). Each region call gets the same
        // layer-level mask — the prompt language tells the model to
        // treat the white pixels as "focus the edit here".
        maskReferenceImage: inpaintMaskBlob ?? undefined,
        referenceImages: refsBlobs.length > 0 ? refsBlobs : undefined,
      });
      return await postprocessGeneratedBlob({
        blob: rawResult,
        sourceCanvas: comp.componentMaskCanvas,
        openAIPadding: {
          paddingOffset: comp.paddingOffset,
          sourceBBox: comp.sourceBBox,
        },
      });
    },
    [
      componentPrompts,
      components,
      componentLabels,
      providerId,
      prompt,
      negativePrompt,
      modelId,
      inpaintMaskBlob,
    ],
  );

  /** F.2: composite the panel's current set of per-region result blobs
   *  into a single source-canvas-sized image and update the RESULT
   *  preview. Called after both generate-all and per-region runs. */
  const recompositeResult = useCallback(async (blobs: Blob[]): Promise<void> => {
    const sourceCanvas = aiSourceCanvasRef.current;
    if (!sourceCanvas) return;
    const composite = await compositeProcessedComponents({
      componentBlobs: blobs,
      sourceCanvas,
    });
    setPhase((prev) => {
      if (prev.kind === "succeeded") URL.revokeObjectURL(prev.url);
      return {
        kind: "succeeded" as const,
        url: URL.createObjectURL(composite),
        blob: composite,
      };
    });
    // Update the iteration anchor source-of-truth alongside the
    // displayed result so the next submit picks up "what I just
    // saw" as a reference.
    setLastResultBlob(composite);
  }, []);

  /** F.2: regenerate a single region. Cheap iteration loop for "one
   *  tile came out wrong" instead of reburning the whole N-region
   *  budget. Skips refinement entirely when the user's prompt hasn't
   *  changed since the last refine — re-uses the cached
   *  `refinement.refined` text. */
  const regenerateOneRegion = useCallback(
    async (idx: number) => {
      const prepared = preparedRef.current;
      if (!prepared || providerId !== "openai") return;
      if (!provider) return;

      // F.4: fail fast on empty-prompt — the API rejects a request
      // without `prompt`, and the surfaced "failed" tile with no
      // reason was confusing. Now we set the failure reason in-band
      // before the fetch so the inline error block can guide the
      // user to fix it.
      const perRegionText = (componentPrompts[idx] ?? "").trim();
      const baseTrimmed = prompt.trim();
      if (perRegionText.length === 0 && baseTrimmed.length === 0) {
        setRegionStates((prev) => {
          const next = [...prev];
          if (next[idx]) {
            next[idx] = {
              ...next[idx],
              status: "failed" as const,
              failedReason:
                "type a prompt before regenerating — either in COMMON CONTEXT or this region's textarea",
            };
          }
          return next;
        });
        return;
      }

      setRegionStates((prev) => {
        const next = [...prev];
        if (next[idx])
          next[idx] = {
            ...next[idx],
            status: "running" as const,
            failedReason: undefined,
          };
        return next;
      });

      // G.9: per-region refinement. Earlier this branch only re-used
      // a cached refined prompt and never *called* `refinePrompt`
      // itself — so in focus mode (where every generate runs through
      // here, not through onSubmit) the "Refine prompt via chat
      // model" toggle was effectively a no-op. Now we run the chat
      // refiner with this region's prompt + isolated source so the
      // LLM sees just the region we're editing, then the resulting
      // refined text rides as `baseText` into runRegionGen.
      //
      // Cache key is the raw user prompt that drove the refine —
      // jumping between regions whose prompts differ produces
      // cache misses (one chat call per region). Same region with
      // unchanged prompt re-uses the cached refined text.
      const userPromptForRefine = perRegionText.length > 0 ? perRegionText : baseTrimmed;
      let refinedText: string | undefined;
      if (usePromptRefine && userPromptForRefine.length > 0) {
        if (refinement?.rawAtRefine === userPromptForRefine) {
          refinedText = refinement.refined;
        } else {
          setRefining(true);
          setRefineError(null);
          try {
            // Use the focused region's isolated source so the LLM's
            // visual analysis is scoped to the region under edit
            // (not the whole layer with other silhouettes visible).
            const preparedComp = prepared[idx];
            const refineSourceBlob = await canvasToPngBlob(preparedComp.isolatedSource);
            const result = await refinePrompt({
              userPrompt: userPromptForRefine,
              layerName: layer.name,
              hasMask: false,
              negativePrompt: negativePrompt.trim() || undefined,
              sourceImage: refineSourceBlob,
              referenceImages: activeRefBlobs,
            });
            refinedText = result.refinedPrompt;
            setRefinement({
              refined: result.refinedPrompt,
              rawAtRefine: userPromptForRefine,
              model: result.model,
            });
          } catch (e) {
            const reason = e instanceof Error ? e.message : String(e);
            console.warn("[GeneratePanel] per-region refine failed", reason);
            setRefineError(reason);
            // fall back to unrefined text below
          } finally {
            setRefining(false);
          }
        }
      }
      const baseText = refinedText ?? userPromptForRefine;
      try {
        const newBlob = await runRegionGen(idx, prepared, baseText, activeRefBlobs);
        // G.8: build the composite source-of-truth from the
        // ref-mirror of regionStates rather than capturing the
        // setter's updater closure. The async updater wasn't
        // running before `await recompositeResult(...)` did, so
        // the array was stale ([] on first run) and the resulting
        // composite blob was blank — apply-to-atlas then quietly
        // overwrote the layer with empty pixels.
        const baseStates = regionStatesRef.current;
        const updatedBlobs = baseStates.map((s, i) => (i === idx ? newBlob : s.resultBlob));
        setRegionStates((prev) => {
          const next = [...prev];
          if (next[idx]) {
            next[idx] = { resultBlob: newBlob, status: "succeeded" as const };
          }
          return next;
        });
        await recompositeResult(updatedBlobs);
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        setRegionStates((prev) => {
          const next = [...prev];
          if (next[idx]) {
            next[idx] = { ...next[idx], status: "failed" as const, failedReason: reason };
          }
          return next;
        });
      }
    },
    [
      providerId,
      provider,
      refinement,
      prompt,
      runRegionGen,
      activeRefBlobs,
      recompositeResult,
      componentPrompts,
      usePromptRefine,
      layer.name,
      negativePrompt,
    ],
  );

  async function onSubmit() {
    setPhase({ kind: "submitting" });
    lastComponentCountRef.current = 0;
    try {
      const sourceCanvas = aiSourceCanvasRef.current;
      if (!sourceCanvas) throw new Error("source not ready");
      if (!provider) throw new Error("provider unavailable");

      // OpenAI gets the source only — never the mask. The DecomposeStudio
      // mask is a *live-render* destination-out wipe ("erase this region
      // from the final atlas"); sending it as an inpaint mask caused
      // model-side confusion ("edit only this bbox" / "preserve the
      // painted region" — both wrong). The mask-less behavior the user
      // confirmed: dense source + prompt → edited 1024² → postprocess
      // crops + alpha-enforces. The live compositor's mask runs as
      // destination-out at render time; the two effects compose cleanly.
      //
      // For Gemini we still pass the raw mask through — Gemini does
      // accept a binary mask and uses it correctly.
      //
      // **User MASK = soft hint, not a hard inpaint mask**. Every FLUX
      // inpaint endpoint we tried (PR #15/#27/#28) reads the mask as
      // a strict bound and fills the silhouette with a complete
      // character regardless. gpt-image-2's multi-image edit pipeline
      // (the multi-component path we already use) handles atlas crops
      // correctly because there's no inpaint prior to fight. So we
      // ride the mask as an extra `image[]` entry + a prompt-language
      // hint, instead of switching paths based on its presence. See
      // `lib/ai/providers/openai.ts` composePrompt for the hint text.
      const useMultiComponent = providerId === "openai";
      // F.2: prefer the mount-time cached prepared bundle so we don't
      // pay isolation/pad cost on every submit. Falls through to the
      // recompute path only if the cache hasn't filled yet.
      const prepared = useMultiComponent
        ? (preparedRef.current ??
          (regionSource === "manual" && components.length > 0
            ? await prepareOpenAISourcesFromMasks(
                sourceCanvas,
                components.map((c) => c.maskCanvas),
              )
            : await prepareOpenAISourcesPerComponent(sourceCanvas)))
        : null;
      if (useMultiComponent && prepared) preparedRef.current = prepared;
      if (prepared) {
        lastComponentCountRef.current = prepared.length;
        console.info(
          `[GeneratePanel] openai submit: sourceCanvas=${sourceCanvas.width}x${sourceCanvas.height}, ` +
            `components=${prepared.length}` +
            prepared
              .map(
                (c, i) =>
                  `\n  [${i}] sourceBBox=${c.sourceBBox.w}x${c.sourceBBox.h}@(${c.sourceBBox.x},${c.sourceBBox.y}) ` +
                  `area=${c.area} padded=${c.padded.width}x${c.padded.height}`,
              )
              .join("") +
            `\n hasUserMask=${!!existingMask}, maskSentToAI=false`,
        );
      }

      // Gemini path — single source + raw mask. Used only when not OpenAI.
      //
      // **Mask convention split**: DecomposeStudio's mask
      // (`existingMask`) is a destination-out hide tool — `alpha=255`
      // marks pixels to ERASE from the final atlas. Inpainting models
      // (fal.ai flux-inpainting and friends) read `alpha=255` /
      // white as "REGENERATE this pixel". The two semantics are
      // opposites; forwarding the Decompose mask makes the inpainter
      // rewrite exactly what the user wanted to keep.
      //
      // For inpainting models we derive a fresh mask from the source
      // canvas alpha: the entire component becomes the edit zone, which
      // is the natural default for a Live2D texture layer ("the user
      // picked this layer because they want it edited"). Gemini's
      // raw-mask path keeps consuming the Decompose mask verbatim
      // since it isn't an inpainter and the convention question
      // doesn't apply.
      // Any fal.ai mask-aware model — both flux-inpainting (FLUX.1 dev)
      // and the higher-quality flux-pro-fill go through the same source
      // bake + mask forward path. flux-2/edit doesn't take a mask so
      // it's excluded.
      const isInpaintingModel =
        providerId === "falai" && (modelId === "flux-inpainting" || modelId === "flux-pro-fill");
      let geminiSourceBlob: Blob | undefined;
      let geminiMaskBlob: Blob | undefined;
      // OpenAI inpaint records the padding metadata so the
      // postprocess step can crop the model's output back into the
      // atlas slot. Other paths leave this null.
      let openaiInpaintPadding: {
        paddingOffset: { x: number; y: number; w: number; h: number };
        sourceBBox: { x: number; y: number; w: number; h: number };
        canvasSize: number;
      } | null = null;
      if (!useMultiComponent) {
        if (isInpaintingModel) {
          // **fal flux-inpainting / flux-pro-fill path** — pad the
          // source into an oversized grey frame so the silhouette
          // becomes a small clipped patch rather than the whole
          // canvas. Naive PR #25 baking still let the silhouette fill
          // the frame edge to edge, which kept the "character outline
          // — fill this in" prior fully active. Shrinking the silhouette
          // to ~1/3 of the frame breaks that prior. The same padding
          // metadata aligns the mask and drives the postprocess crop.
          const baked = await bakeTransparencyToNeutral(sourceCanvas, { scale: 3 });
          geminiSourceBlob = baked.blob;
          openaiInpaintPadding = baked.padding;
          console.info(
            `[generate] inpaint source: padded ${sourceCanvas.width}x${sourceCanvas.height} ` +
              `into ${baked.padding.canvasSize}x${baked.padding.canvasSize} grey frame ` +
              `(silhouette at offset=(${baked.padding.paddingOffset.x},${baked.padding.paddingOffset.y}), ` +
              `${baked.padding.paddingOffset.w}x${baked.padding.paddingOffset.h}). ` +
              "Forces the inpainter to read the silhouette as a patch, not a character outline.",
          );
          // Priority: user-painted MASK tab > derived from source alpha.
          // Either way the mask must be aligned to the same padded frame.
          let rawMask: Blob;
          if (inpaintMaskBlob) {
            rawMask = inpaintMaskBlob;
            console.info(
              `[generate] inpaint mask: user-painted in MASK tab (${inpaintMaskBlob.size}B).`,
            );
          } else {
            rawMask = await buildInpaintMaskFromAlpha(sourceCanvas);
            console.info(
              `[generate] inpaint mask: derived from source alpha (${rawMask.size}B). DecomposeStudio mask ignored (hide-vs-edit convention conflict).`,
            );
          }
          geminiMaskBlob = await padInpaintMaskToFrame(rawMask, baked.padding);
          console.info(
            `[generate] inpaint mask: padded to ${baked.padding.canvasSize}² frame (${geminiMaskBlob.size}B).`,
          );
        } else {
          geminiSourceBlob = await canvasToPngBlob(sourceCanvas);
          geminiMaskBlob = existingMask ?? undefined;
        }
      }

      // ── character reference snapshot ─────────────────────────────
      // Capture the puppet's current rendered state once per submit
      // and ride it along as the last image[] entry. Gives the model
      // spatial context for what the edited drawable is part of (the
      // face the hair frames, the body the jacket sits on). Appended
      // rather than prepended so user-uploaded references stay the
      // dominant anchor — the snapshot is context, not identity.
      // Skipped when the budget is already full (>3 user refs leaves
      // no slot for one more under gpt-image-2's image[] limit).
      //
      // **Provider gating**: fal.ai flux-2/edit treats every entry in
      // image_urls[] as a visual *example* to imitate, not as context.
      // Sending the canonical-pose snapshot makes flux stamp the whole
      // character onto the drawable. OpenAI gpt-image-2 honours the
      // "spatial context only" framing because its prompt scaffold
      // can carry that disambiguation; flux doesn't. Until we have a
      // separate `spatialContextImage` channel that providers opt
      // into, only OpenAI gets the canonical-pose ref.
      const supportsCharacterRef = providerId === "openai";
      let characterRefBlob: Blob | null = null;
      if (app && supportsRefs && supportsCharacterRef && activeRefBlobs.length <= 3) {
        try {
          characterRefBlob = await renderPuppetReference(app);
        } catch (e) {
          console.warn("[generate] character-ref capture failed; skipping", e);
        }
      }
      const submitRefs: Blob[] = characterRefBlob
        ? [...activeRefBlobs, characterRefBlob]
        : activeRefBlobs;
      console.info(
        `[generate] character-ref: ${
          characterRefBlob
            ? `attached (${characterRefBlob.size}B, slot ${submitRefs.length})`
            : !supportsCharacterRef
              ? `skipped (provider=${providerId} doesn't disambiguate ref roles)`
              : app
                ? `skipped (refs budget=${activeRefBlobs.length}, supportsRefs=${supportsRefs})`
                : "skipped (no Pixi app)"
        }`,
      );

      // ── prompt refinement (optional) ────────────────────────────
      // When usePromptRefine is on AND the picked provider is OpenAI,
      // run the user's prompt through `/api/ai/refine-prompt` so the
      // chat model can rewrite it as the structured slot-mapping
      // language gpt-image-2 responds best to. Result is stashed in
      // `refinement` for the diagnostic block + threaded into
      // submitGenerate as `refinedPrompt`. Failures here fall back to
      // the raw prompt — refinement is a quality booster, not a
      // hard dependency.
      let refinedPromptForSubmit: string | undefined;
      if (usePromptRefine && providerId === "openai" && prompt.trim().length > 0) {
        setRefining(true);
        setRefineError(null);
        try {
          // Hand the LLM the *unpadded* source so it focuses on the
          // actual layer texture, not the white border that the
          // OpenAI padding adds. Active refs are already what we'll
          // send to the image model — same blobs go to the refiner
          // so its description targets the exact bytes the image
          // edit step will see. For multi-component layers we still
          // refine against the full source canvas in this sprint —
          // per-component refinement lands in A.4. The single shared
          // refined prompt then rides along on every component
          // submit, which is enough to give each call the same
          // structured language without ballooning chat costs.
          const refineSourceBlob = await canvasToPngBlob(sourceCanvas);
          const result = await refinePrompt({
            userPrompt: prompt,
            layerName: layer.name,
            // Mask never reaches OpenAI in this pipeline; non-OpenAI
            // paths set hasMask via geminiMaskBlob below.
            hasMask: !!geminiMaskBlob,
            negativePrompt: negativePrompt.trim() || undefined,
            sourceImage: refineSourceBlob,
            referenceImages: activeRefBlobs,
          });
          refinedPromptForSubmit = result.refinedPrompt;
          setRefinement({
            refined: result.refinedPrompt,
            rawAtRefine: prompt,
            model: result.model,
          });
        } catch (e) {
          const reason = e instanceof Error ? e.message : String(e);
          console.warn("[GeneratePanel] prompt refine failed, sending raw prompt", reason);
          setRefineError(reason);
          // intentionally keep refinedPromptForSubmit undefined — fall
          // back to the raw prompt below
        } finally {
          setRefining(false);
        }
      } else if (refinement && refinement.rawAtRefine !== prompt) {
        // user edited the prompt since the last refine; clear stale
        // refinement so the diagnostic doesn't lie about what was sent
        setRefinement(null);
      }

      setPhase({ kind: "running" });
      // ── structured submit log ────────────────────────────────────
      // Surfaces exactly what's about to leave the browser so the
      // user can correlate result quality with inputs. Each Blob is
      // also given an object-URL so DevTools "preview" links the
      // raw bytes — click-to-open in a tab. URLs leak intentionally
      // until panel unmount; size is bounded by ref count.
      const refDetails = activeRefBlobs.map((b, i) => {
        const matched = references.find((r) => r.blob === b);
        const isLastResult = !matched && b === lastResultBlob;
        return {
          slot: `image[${i + 1}]`,
          source: matched ? "puppet ref" : isLastResult ? "iteration anchor (last result)" : "?",
          name: matched?.name ?? (isLastResult ? "last-result" : `ref-${i}`),
          type: b.type || "(no MIME)",
          bytes: b.size,
          preview: URL.createObjectURL(b),
        };
      });
      console.groupCollapsed(
        `[ai/submit] layer="${layer.name}" provider=${providerId} model=${modelId || "(default)"} ` +
          `refs=${activeRefBlobs.length}` +
          (prepared ? ` components=${prepared.length}` : ""),
      );
      console.info("layer:", {
        id: layer.id,
        name: layer.name,
        externalId: layer.externalId,
        textureId: layer.texture?.textureId,
        rect: layer.texture?.rect,
      });
      console.info("provider:", { id: providerId, model: modelId || "(provider default)" });
      if (prepared) {
        console.info(
          `source split into ${prepared.length} component(s) (${regionSource}) — one OpenAI call per component, results composited:`,
          prepared.map((c, i) => ({
            componentId: i,
            label: components[i]
              ? (components[i].name ??
                componentLabels[componentSignature(components[i].bbox)] ??
                "(unnamed)")
              : "(unmatched)",
            sourceBBox: c.sourceBBox,
            paddingOffset: c.paddingOffset,
            area: c.area,
            paddedDim: `${c.padded.width}x${c.padded.height}`,
            // toDataURL stays synchronous — fine for diagnostic previews
            // on the per-component canvases (typically small).
            isolatedPreview: c.isolatedSource.toDataURL("image/png"),
          })),
        );
      } else if (geminiSourceBlob) {
        console.info("source image (image[0]):", {
          slot: "image[0]",
          bytes: geminiSourceBlob.size,
          type: geminiSourceBlob.type || "(no MIME)",
          preview: URL.createObjectURL(geminiSourceBlob),
        });
      }
      if (geminiMaskBlob) {
        console.info("mask:", {
          bytes: geminiMaskBlob.size,
          type: geminiMaskBlob.type || "(no MIME)",
          preview: URL.createObjectURL(geminiMaskBlob),
          appliesTo: "image[0]",
        });
      } else {
        console.info("mask: (none — OpenAI runs unmasked / footprint-only)");
      }
      if (refDetails.length === 0) {
        console.info("references: (none)");
      } else {
        console.info(`references (${refDetails.length}):`, refDetails);
      }
      console.info("prompt (user, verbatim):", prompt);
      if (refinedPromptForSubmit) {
        console.info("prompt (refined by chat model):", refinedPromptForSubmit);
      } else if (usePromptRefine && providerId === "openai") {
        console.info("prompt refinement: skipped (refine off / empty / errored)");
      }
      if (prepared?.some((_, i) => (componentPrompts[i] ?? "").trim())) {
        console.info(
          "per-region prompts (combined with common at submit):",
          prepared.map((_, i) => ({
            region: i + 1,
            label: components[i]
              ? (components[i].name ??
                componentLabels[componentSignature(components[i].bbox)] ??
                "")
              : "",
            text: componentPrompts[i] ?? "",
          })),
        );
      }
      if (negativePrompt.trim()) console.info("negative prompt:", negativePrompt);
      console.info(
        "note: provider wraps the (refined) prompt in slot-mapping + preservation scaffolding. Check the [openai] server log for the full composed text actually sent to /v1/images/edits.",
      );
      console.groupEnd();

      let processed: Blob;

      if (prepared) {
        // Multi-component OpenAI path: fire N submits in parallel
        // through the per-region helper, capture per-region results
        // into regionStates, then composite. Failed regions keep
        // their previous blob (initial isolated source on the first
        // run, last successful gen on subsequent runs) so the
        // composite degrades gracefully — one bad region doesn't
        // wipe the rest.
        const baseText = refinedPromptForSubmit ?? prompt;
        // Mark every region as running before the parallel fan-out
        // so the tile UI can show a spinner per region.
        setRegionStates((prev) =>
          prev.length === prepared.length
            ? prev.map((s) => ({ ...s, status: "running" as const }))
            : prepared.map(() => ({
                resultBlob: new Blob(),
                status: "running" as const,
              })),
        );

        const settled = await Promise.allSettled(
          prepared.map((_, idx) => runRegionGen(idx, prepared, baseText, submitRefs)),
        );

        // G.8: same fix as regenerateOneRegion — read finalBlobs
        // from the ref-mirror, not the setRegionStates updater
        // (the updater is async and doesn't fire before the await
        // below runs). Without this, the composite was an empty
        // array → blank atlas after apply.
        const baseStates = regionStatesRef.current;
        const finalBlobs: Blob[] = baseStates.map((s, idx) => {
          const r = settled[idx];
          return r && r.status === "fulfilled" ? r.value : s.resultBlob;
        });
        setRegionStates((prev) => {
          const next = [...prev];
          settled.forEach((r, idx) => {
            const previous = next[idx];
            if (r.status === "fulfilled") {
              next[idx] = { resultBlob: r.value, status: "succeeded" as const };
            } else if (previous) {
              next[idx] = {
                ...previous,
                status: "failed" as const,
                failedReason: r.reason instanceof Error ? r.reason.message : String(r.reason),
              };
            }
          });
          return next;
        });

        // Surface the first failure as a panel-level error if every
        // region failed — otherwise let per-tile status flags carry
        // partial-failure info.
        const allFailed = settled.every((r) => r.status === "rejected");
        if (allFailed) {
          const reason = settled
            .map((r) => (r.status === "rejected" ? String(r.reason) : ""))
            .filter(Boolean)
            .join(" / ");
          throw new Error(reason || "all region calls failed");
        }

        processed = await compositeProcessedComponents({
          componentBlobs: finalBlobs,
          sourceCanvas,
        });
      } else {
        // Gemini / fal / OpenAI-inpaint share the single-source +
        // mask submit path. The postprocess crop differs: OpenAI
        // inpaint went through `prepareOpenAISource`, so its result
        // needs the same `paddingOffset` / `sourceBBox` matching that
        // the multi-component OpenAI path uses. Gemini / fal paths
        // stay at native dims.
        if (!geminiSourceBlob) throw new Error("gemini source not prepared");
        const rawResult = await submitGenerate({
          providerId,
          prompt,
          refinedPrompt: refinedPromptForSubmit,
          negativePrompt: negativePrompt.trim() || undefined,
          modelId: modelId || undefined,
          sourceImage: geminiSourceBlob,
          maskImage: geminiMaskBlob,
          referenceImages: submitRefs.length > 0 ? submitRefs : undefined,
        });
        processed = await postprocessGeneratedBlob({
          blob: rawResult,
          sourceCanvas,
          openAIPadding: openaiInpaintPadding ?? undefined,
        });
      }

      const url = URL.createObjectURL(processed);
      setPhase({ kind: "succeeded", url, blob: processed });
    } catch (e) {
      setPhase({ kind: "failed", reason: e instanceof Error ? e.message : String(e) });
    }
  }

  async function onApply() {
    if (phase.kind !== "succeeded") return;
    setPhase({ kind: "applying" });
    try {
      // `phase.blob` is the postprocess output (cropped + re-positioned
      // + alpha-enforced) — produced at submit success or by `onRevisit`
      // for an IDB-stored job. Either way it's already at the layer's
      // upright canvas dimensions, so we apply it directly.
      const processed = phase.blob;
      // Save to store. The LayersPanel effect picks it up and the
      // adapter composites onto the atlas page within one frame.
      setLayerTextureOverride(layer.id, processed);

      // Persist the apply'd job to IDB for this layer's history.
      // `puppetKey === null` is a transient guard kept for safety —
      // current editor routes always resolve a key before mounting
      // this panel, but skipping persistence is the right fallback.
      if (puppetKey) {
        try {
          // Tag the row with the focused region's bbox signature so
          // history can filter per-region in focus mode. Single-
          // source applies (no focus or non-multi) leave it
          // undefined and show only in the picker / single-source
          // history list.
          const focusedComp =
            isFocusedMulti && focusedRegionIdx !== null ? components[focusedRegionIdx] : null;
          const regionSig = focusedComp ? componentSignature(focusedComp.bbox) : undefined;
          await saveAIJob({
            puppetKey,
            layerExternalId: layer.externalId,
            providerId,
            modelId: modelId || undefined,
            prompt,
            negativePrompt: negativePrompt.trim() || undefined,
            resultBlob: processed,
            regionSignature: regionSig,
          });
          // Refresh history so the user sees the new entry next time
          // the panel opens for this layer.
          listAIJobsForLayer(puppetKey, layer.externalId)
            .then(setHistory)
            .catch(() => {});
        } catch (e) {
          console.warn("[GeneratePanel] saveAIJob failed", e);
        }
      }

      // Free the preview URL — store now owns the blob.
      URL.revokeObjectURL(phase.url);
      close(null);
    } catch (e) {
      setPhase({ kind: "failed", reason: e instanceof Error ? e.message : String(e) });
    }
  }

  /** Re-run the last submission with the same prompt + provider. */
  function onRetry() {
    void onSubmit();
  }

  /** Reload an old job into the result preview. User can then "apply"
   *  it as if it were freshly generated. The blob came from IDB so it's
   *  already postprocessed (alpha-enforced + cropped + re-positioned);
   *  we wrap it in a fresh URL and pretend the submit pipeline produced
   *  it. */
  function onRevisit(row: AIJobRow) {
    if (phase.kind === "succeeded") URL.revokeObjectURL(phase.url);
    // The saved blob is already at the layer's upright dim — no further
    // postprocess is needed at apply time.
    lastComponentCountRef.current = 0;
    const url = URL.createObjectURL(row.resultBlob);
    setPrompt(row.prompt);
    setNegativePrompt(row.negativePrompt ?? "");
    setProviderId(row.providerId);
    if (row.modelId) setModelId(row.modelId);
    setPhase({ kind: "succeeded", url, blob: row.resultBlob });
  }

  function onReset() {
    if (phase.kind === "succeeded") URL.revokeObjectURL(phase.url);
    setPhase({ kind: "idle" });
  }

  /** F.3: revert the layer's applied texture override back to the
   *  original atlas content. Different from `onReset`: that only
   *  dismisses the panel's pending result, this wipes the saved
   *  edit on the layer so the live atlas re-renders the unedited
   *  texture. The mask stays — only the AI texture channel is
   *  cleared. Confirms before acting; the action is destructive
   *  (no undo within the panel — user can revisit a history row to
   *  re-apply a previous gen). */
  async function onRevertTexture() {
    if (!existingTexture) return;
    if (typeof window !== "undefined") {
      const ok = window.confirm(
        "이 레이어에 적용된 AI 텍스처를 모두 지우시겠습니까? atlas 가 원본 상태로 복귀합니다. (마스크는 유지)",
      );
      if (!ok) return;
    }
    setLayerTextureOverride(layer.id, null);
    if (puppetKey) {
      try {
        await deleteLayerOverride(puppetKey, layer.externalId, "texture");
      } catch (e) {
        console.warn("[GeneratePanel] deleteLayerOverride failed", e);
      }
    }
    // Drop any pending preview so the panel reflects the cleared
    // state cleanly — the user can still revisit a history row to
    // re-apply a previous gen.
    if (phase.kind === "succeeded") URL.revokeObjectURL(phase.url);
    setPhase({ kind: "idle" });
    // Reset per-region states' status flags so the tiles don't
    // claim "succeeded" against the cleared atlas.
    setRegionStates((prev) => prev.map((s) => ({ ...s, status: "idle" as const })));
    setLastResultBlob(null);
  }

  /** Revert just the focused region to its pristine atlas content,
   *  leaving every other region's previously-applied gen intact.
   *  Different from onRevertTexture (which wipes the whole layer).
   *
   *  Pulls the region's silhouette out of `originalSourceCanvasRef`
   *  (extracted at mount with no texture override), swaps it into
   *  regionStates[focused], recomposites with the other regions'
   *  current blobs, and writes the new composite straight to the
   *  layer's texture override. The user sees the atlas update
   *  immediately — no separate "apply" step needed for revert. */
  async function onRevertFocusedRegion() {
    if (!isFocusedMulti || focusedRegionIdx === null) return;
    const original = originalSourceCanvasRef.current;
    const sourceCanvas = aiSourceCanvasRef.current;
    if (!original || !sourceCanvas) return;
    const c = components[focusedRegionIdx];
    if (!c) return;
    if (typeof window !== "undefined") {
      const label = (c.name ?? componentLabels[componentSignature(c.bbox)] ?? "").trim();
      const display = label || `region ${focusedRegionIdx + 1}`;
      const ok = window.confirm(
        `region "${display}" 만 원본 atlas 내용으로 되돌리시겠습니까? 다른 region 의 편집은 유지됩니다.`,
      );
      if (!ok) return;
    }
    // Lazy-import the isolation helper so the connectedComponents
    // module isn't pulled in just for this less-common path.
    const { isolateWithMask } = await import("@/lib/avatar/connectedComponents");
    const isolatedOriginal = isolateWithMask(original, c.maskCanvas);
    const newBlob = await canvasToPngBlob(isolatedOriginal);

    // Swap the region's blob into regionStates and recompose using
    // the other regions' current blobs (regionStatesRef avoids the
    // useState-updater race; same pattern as regenerateOneRegion).
    const baseStates = regionStatesRef.current;
    const idx = focusedRegionIdx;
    const updatedBlobs = baseStates.map((s, i) => (i === idx ? newBlob : s.resultBlob));
    setRegionStates((prev) => {
      const next = [...prev];
      if (next[idx]) {
        next[idx] = { resultBlob: newBlob, status: "idle" as const, failedReason: undefined };
      }
      return next;
    });

    const composite = await compositeProcessedComponents({
      componentBlobs: updatedBlobs,
      sourceCanvas,
    });
    // Push to the live atlas immediately and persist via the store
    // (the existing useLayerOverridesPersistence bridge mirrors to
    // IDB).
    setLayerTextureOverride(layer.id, composite);
    setLastResultBlob(composite);
    // Clear any pending preview so the panel reflects the new state.
    if (phase.kind === "succeeded") URL.revokeObjectURL(phase.url);
    const url = URL.createObjectURL(composite);
    setPhase({ kind: "succeeded", url, blob: composite });
  }

  const submitDisabled =
    !ready ||
    !provider?.available ||
    phase.kind === "submitting" ||
    phase.kind === "running" ||
    phase.kind === "applying" ||
    focusedRegionState?.status === "running" ||
    !focusedPromptValue.trim();

  const previewBg = useMemo<React.CSSProperties>(
    () => ({
      backgroundImage:
        "linear-gradient(45deg, #1a1d22 25%, transparent 25%), linear-gradient(-45deg, #1a1d22 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #1a1d22 75%), linear-gradient(-45deg, transparent 75%, #1a1d22 75%)",
      backgroundSize: "16px 16px",
      backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
      backgroundColor: "#0e1115",
    }),
    [],
  );

  return (
    <div className="fixed inset-0 z-40 flex items-stretch bg-black/70 backdrop-blur-sm">
      <button
        type="button"
        aria-label="close"
        onClick={requestClose}
        className="absolute inset-0 cursor-default"
      />
      <div className="relative z-10 m-auto flex h-[95vh] w-[min(96vw,1800px)] flex-col rounded border border-[var(--color-border)] bg-[var(--color-bg)] shadow-2xl">
        <header className="flex shrink-0 items-center gap-3 border-b border-[var(--color-border)] px-4 py-2 text-xs">
          <span className="font-mono text-[var(--color-accent)]">generate · v1</span>
          <span className="text-[var(--color-fg-dim)]">{layer.name}</span>
          <div className="ml-2 flex gap-1">
            <button
              type="button"
              onClick={() => setActiveTab("gen")}
              className={[
                "rounded border px-2 py-0.5 font-mono text-[11px] transition",
                activeTab === "gen"
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-[var(--color-accent)]"
                  : "border-[var(--color-border)] text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]",
              ].join(" ")}
            >
              GEN
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("mask")}
              className={[
                "rounded border px-2 py-0.5 font-mono text-[11px] transition",
                activeTab === "mask"
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-[var(--color-accent)]"
                  : "border-[var(--color-border)] text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]",
              ].join(" ")}
              title="Edit the inpaint mask used by mask-aware models (fal.ai flux-inpainting). Different concept from DecomposeStudio's hide mask."
            >
              MASK
              {inpaintMaskBlob && (
                <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
              )}
            </button>
          </div>
          {/* G: focused-region breadcrumb + back navigation. Only
              shown when there's more than one region — single-
              component layers stay on the legacy single-source UX
              with no picker / no back button. */}
          {components.length > 1 && focusedRegionIdx !== null && (
            <>
              <span className="text-[var(--color-fg-dim)]">·</span>
              {(() => {
                const c = components[focusedRegionIdx];
                const sig = c ? componentSignature(c.bbox) : "";
                const regionName = c
                  ? (c.name ?? componentLabels[sig] ?? `region ${focusedRegionIdx + 1}`)
                  : `region ${focusedRegionIdx + 1}`;
                const color =
                  c?.color ?? COMPONENT_COLORS[focusedRegionIdx % COMPONENT_COLORS.length];
                return (
                  <>
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-sm"
                      style={{ background: color }}
                    />
                    <span className="font-medium text-[var(--color-fg)]">{regionName}</span>
                    <button
                      type="button"
                      onClick={() => setFocusedRegionIdx(null)}
                      className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
                      title="back to region picker"
                    >
                      ← regions
                    </button>
                  </>
                );
              })()}
            </>
          )}
          {existingMask && provider?.capabilities.supportsBinaryMask && (
            <span
              className="rounded border border-[var(--color-accent)] px-1 font-mono text-[10px] text-[var(--color-accent)]"
              title="DecomposeStudio mask used as inpaint mask"
            >
              mask in use
            </span>
          )}
          {existingMask && provider && !provider.capabilities.supportsBinaryMask && (
            <span
              className="rounded border border-[var(--color-border)] px-1 font-mono text-[10px] text-[var(--color-fg-dim)]"
              title="provider doesn't take a binary mask; passed as a second reference image with prompt instructions"
            >
              mask as ref
            </span>
          )}
          <button
            type="button"
            onClick={requestClose}
            className="ml-auto rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
            title="esc"
          >
            close
          </button>
        </header>

        {activeTab === "mask" ? (
          // Reuse DecomposeStudio in embedded mode — same brush UX
          // (Toolbox, OptionsBar, BrushCursor, viewport, history,
          // shortcuts) as the standalone Edit-flow mask editor. The
          // `embedded` flag drops the modal chrome and the
          // `onMaskCommit` callback routes the saved mask back into
          // GeneratePanel's inpaint state instead of the
          // hide-mask store.
          <DecomposeStudio
            adapter={adapter}
            layer={layer}
            puppetKey={puppetKey}
            embedded
            maskBaseline={inpaintMaskBlob}
            onMaskCommit={setInpaintMaskBlob}
            onClose={() => setActiveTab("gen")}
          />
        ) : null}

        {activeTab === "gen" && (
          <>
            {/* G: when there are multiple regions and no focus, show the
            picker — a full-modal grid of region tiles. The user
            picks one, the modal switches into focus mode for that
            region. Skips entirely for single-component layers
            (they go straight into focus mode at mount). */}
            {components.length > 1 && focusedRegionIdx === null ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
                <div className="mb-4 text-sm">
                  <div className="mb-1 text-[var(--color-fg)]">pick a region to edit</div>
                  <p className="text-[var(--color-fg-dim)]">
                    this layer has {components.length} disjoint silhouettes. each is edited
                    independently — pick one, type a prompt for it, generate. references and refine
                    settings are shared across regions. (atlas changes from previous regions stay
                    applied.)
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {components.map((c, idx) => {
                    const color = c.color ?? COMPONENT_COLORS[idx % COMPONENT_COLORS.length];
                    const sig = componentSignature(c.bbox);
                    const isManual = c.name !== undefined;
                    const name = isManual ? (c.name ?? "") : (componentLabels[sig] ?? "");
                    const thumb = componentThumbs[idx];
                    const state = regionStates[idx];
                    return (
                      <button
                        type="button"
                        key={c.id}
                        onClick={() => setFocusedRegionIdx(idx)}
                        className="group relative flex flex-col gap-2 rounded border-2 bg-[var(--color-bg)] p-2 text-left transition hover:bg-[var(--color-accent)]/5"
                        style={{ borderColor: color }}
                      >
                        <div
                          className="relative flex h-32 items-center justify-center overflow-hidden rounded"
                          style={{ background: "rgba(255,255,255,0.04)" }}
                        >
                          {thumb && (
                            // biome-ignore lint/performance/noImgElement: data URL thumbnail
                            <img
                              src={thumb.toDataURL("image/png")}
                              alt={`region ${idx + 1}`}
                              className="max-h-full max-w-full"
                              draggable={false}
                            />
                          )}
                          <span
                            className="absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold text-black"
                            style={{ background: color }}
                          >
                            {idx + 1}
                          </span>
                          {state?.status === "succeeded" && (
                            <span className="absolute right-1.5 top-1.5 rounded bg-[var(--color-accent)]/90 px-1.5 py-0.5 text-[10px] font-bold text-black">
                              ✓
                            </span>
                          )}
                          {state?.status === "running" && (
                            <span className="absolute inset-0 flex items-center justify-center bg-black/60 text-xs text-white">
                              generating…
                            </span>
                          )}
                          {state?.status === "failed" && (
                            <span className="absolute right-1.5 top-1.5 rounded bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                              !
                            </span>
                          )}
                        </div>
                        <div className="text-[12px] font-medium text-[var(--color-fg)]">
                          {name || (
                            <span className="italic text-[var(--color-fg-dim)]">
                              region {idx + 1}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-[var(--color-fg-dim)]">
                          {c.bbox.w}×{c.bbox.h} · {c.area.toLocaleString()} px
                        </div>
                      </button>
                    );
                  })}
                </div>
                {/* Picker-mode actions: only revert is meaningful at the
                layer level — generate / apply require a focused region.
                The user can revert any time to wipe applied AI texture. */}
                <div className="mt-6 flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void onRevertTexture();
                    }}
                    disabled={!existingTexture}
                    title={
                      existingTexture
                        ? "clear the applied AI texture and restore the original atlas content"
                        : "no AI texture applied to this layer"
                    }
                    className="rounded border border-red-500/40 px-3 py-1 text-xs text-red-300 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    revert layer · all regions
                  </button>
                </div>
              </div>
            ) : (
              // Sidebar bumped 320px → 480px (1.5×) so the prompt
              // textarea, refs list, refine panel, and history fit
              // comfortably with room to read. The two preview columns
              // still split whatever's left equally.
              <div className="grid min-h-0 flex-1 grid-cols-[1fr_1fr_480px] overflow-hidden">
                {/* source */}
                <div
                  className="flex min-h-0 min-w-0 flex-col items-center justify-center gap-2 border-r border-[var(--color-border)] p-4"
                  style={previewBg}
                >
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
                    <span>source</span>
                    {isFocusedMulti &&
                      focusedRegionIdx !== null &&
                      components[focusedRegionIdx] && (
                        <span className="text-[var(--color-accent)]">
                          · region {focusedRegionIdx + 1} of {components.length}
                        </span>
                      )}
                    {inpaintMaskPreviewUrl && (
                      <button
                        type="button"
                        onClick={() => setActiveTab("mask")}
                        className="flex items-center gap-1.5 rounded border border-[var(--color-accent)]/60 bg-[var(--color-accent)]/5 px-1.5 py-0.5 normal-case tracking-normal text-[var(--color-accent)] transition hover:bg-[var(--color-accent)]/15"
                        title="inpaint mask preview — click to edit in MASK tab. white = AI redraws, black = preserved."
                      >
                        {/* biome-ignore lint/performance/noImgElement: tiny blob URL thumbnail */}
                        <img
                          src={inpaintMaskPreviewUrl}
                          alt="inpaint mask preview"
                          className="h-5 w-5 rounded-sm border border-[var(--color-accent)]/40 object-contain"
                          style={{ background: "#000" }}
                        />
                        <span className="font-mono text-[10px]">mask · edit</span>
                      </button>
                    )}
                  </div>
                  {error ? (
                    <div className="text-sm text-red-400">{error}</div>
                  ) : !ready ? (
                    <div className="text-sm text-[var(--color-fg-dim)]">영역 불러오는 중…</div>
                  ) : (
                    <div className="relative inline-flex max-h-full max-w-full">
                      <canvas
                        ref={sourceRef}
                        className="max-h-full max-w-full border border-[var(--color-border)]"
                      />
                      {/* G: bbox SVG overlay used to live here (E.3) for the
                    unfocused multi-region case. The picker view now
                    owns region selection, and focus mode shows a
                    tight-cropped isolated region — both make the
                    overlay redundant, so it's gone. */}
                    </div>
                  )}
                </div>

                {/* result */}
                <div
                  className="flex min-h-0 min-w-0 flex-col items-center justify-center gap-2 p-4"
                  style={previewBg}
                >
                  <div className="text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
                    result
                    {isFocusedMulti &&
                      focusedRegionIdx !== null &&
                      components[focusedRegionIdx] && (
                        <span className="ml-2 text-[var(--color-accent)]">
                          · region {focusedRegionIdx + 1} of {components.length}
                        </span>
                      )}
                  </div>
                  {/* G.7: focus-mode RESULT — show this region's result
                  tight-cropped on a canvas (matches SOURCE preview).
                  The state messages overlay during running/failed/etc;
                  the canvas itself stays mounted so the user keeps
                  seeing the previous successful blob while a new run
                  is in flight (instead of a "generating…" placeholder
                  that wipes context). */}
                  {isFocusedMulti ? (
                    <>
                      {focusedRegionState?.status === "idle" && (
                        <div className="text-sm text-[var(--color-fg-dim)]">
                          프롬프트를 입력하고 generate 하면 결과가 표시됩니다
                        </div>
                      )}
                      {focusedRegionState?.status === "running" && (
                        <div className="flex flex-col items-center gap-1 text-sm text-[var(--color-fg-dim)]">
                          <span>이 region 생성 중 · provider 호출 중</span>
                          <span className="text-xs">OpenAI ~10–30초 · 닫지 마세요</span>
                        </div>
                      )}
                      {focusedRegionState?.status === "failed" && (
                        <div className="max-w-md text-sm text-red-400">
                          <div className="mb-2 font-medium">실패</div>
                          <div className="text-xs">{focusedRegionState.failedReason}</div>
                        </div>
                      )}
                      {focusedRegionState?.status === "succeeded" && (
                        <canvas
                          ref={resultRef}
                          className="max-h-full max-w-full border border-[var(--color-border)]"
                        />
                      )}
                    </>
                  ) : (
                    <>
                      {phase.kind === "idle" && (
                        <div className="text-sm text-[var(--color-fg-dim)]">
                          generate 하면 결과가 표시됩니다
                        </div>
                      )}
                      {phase.kind === "submitting" && (
                        <div className="text-sm text-[var(--color-fg-dim)]">제출 중…</div>
                      )}
                      {phase.kind === "running" && (
                        <div className="flex flex-col items-center gap-1 text-sm text-[var(--color-fg-dim)]">
                          <span>생성 중 · provider 호출 중</span>
                          <span className="text-xs">
                            Gemini ~5–15초 · OpenAI ~10–30초 · 닫지 마세요
                          </span>
                        </div>
                      )}
                      {phase.kind === "failed" && (
                        <div className="max-w-md text-sm text-red-400">
                          <div className="mb-2 font-medium">실패</div>
                          <div className="text-xs">{phase.reason}</div>
                          <div className="mt-3 flex gap-2">
                            <button
                              type="button"
                              onClick={onRetry}
                              className="rounded border border-[var(--color-accent)] px-2 py-0.5 text-[var(--color-accent)]"
                              title="re-run with the same prompt and provider"
                            >
                              retry
                            </button>
                            <button
                              type="button"
                              onClick={onReset}
                              className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
                            >
                              dismiss
                            </button>
                          </div>
                        </div>
                      )}
                      {phase.kind === "succeeded" && (
                        // biome-ignore lint/performance/noImgElement: blob URL output
                        <img
                          src={phase.url}
                          alt="generated"
                          className="max-h-full max-w-full border border-[var(--color-border)]"
                        />
                      )}
                    </>
                  )}
                </div>

                <aside className="flex min-h-0 flex-col border-l border-[var(--color-border)] text-xs">
                  {/* F.1: scrollable content + sticky actions footer. The
                content area takes all the space the actions don't
                claim, and overflow-y-auto keeps the buttons in view
                even when the user has 6+ regions or a long history.
                Without this split the buttons used to scroll off the
                bottom of the modal entirely. */}
                  <div className="flex-1 overflow-y-auto p-4">
                    <div className="mb-3">
                      <div className="mb-1 uppercase tracking-widest text-[var(--color-fg-dim)]">
                        provider
                      </div>
                      <select
                        value={providerId}
                        onChange={(e) => setProviderId(e.target.value as ProviderId)}
                        className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm text-[var(--color-fg)] focus:border-[var(--color-accent)] focus:outline-none"
                      >
                        {(providers ?? []).map((p) => (
                          <option key={p.id} value={p.id} disabled={!p.available}>
                            {p.displayName}
                            {!p.available ? ` · ${p.reason}` : ""}
                          </option>
                        ))}
                      </select>
                      {provider && !provider.available && (
                        <div className="mt-1 text-[var(--color-fg-dim)]">{provider.reason}</div>
                      )}
                    </div>

                    {provider && provider.capabilities.models.length > 1 && (
                      <div className="mb-3">
                        <div className="mb-1 uppercase tracking-widest text-[var(--color-fg-dim)]">
                          model
                        </div>
                        <select
                          value={modelId}
                          onChange={(e) => setModelId(e.target.value)}
                          className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs text-[var(--color-fg)] focus:border-[var(--color-accent)] focus:outline-none"
                        >
                          {provider.capabilities.models.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.displayName} · {m.id}
                            </option>
                          ))}
                        </select>
                        {(() => {
                          const m = provider.capabilities.models.find((x) => x.id === modelId);
                          return m?.description ? (
                            <p className="mt-1 leading-relaxed text-[var(--color-fg-dim)]">
                              {m.description}
                            </p>
                          ) : null;
                        })()}
                      </div>
                    )}

                    {/* Per-region tiles. Only shown when this layer split into
                multiple silhouette islands. Each tile shows a thumb
                (with the matching outline color from the SOURCE
                overlay) and a textarea for region-specific prompt
                language. Submit composes one prompt per component as
                `<common> + "Region N: <per-region>"`, so the user can
                say "common: skin tone soft peach" and "region 1:
                exposed midriff" / "region 2: lace frill". */}
                    {/* G: legacy multi-region tile list inside aside. The
                  picker view (rendered when focused === null) now
                  owns the region-picking UX, so this block only
                  fires when focusedRegionIdx is set AND we still
                  want a contextual reminder of where the user is. To
                  avoid duplicating the picker — and the per-tile
                  ↻ buttons that confused the multi-region story —
                  we hide this entirely. The current focused region's
                  controls live above (prompt textarea + clear). */}
                    {false && components.length > 1 && (
                      <div className="mb-3">
                        <div className="mb-1 flex items-baseline justify-between">
                          <div className="uppercase tracking-widest text-[var(--color-fg-dim)]">
                            regions
                            <span className="ml-1 normal-case tracking-normal text-[var(--color-accent)]">
                              · {components.length} OpenAI calls
                            </span>
                          </div>
                          {/* E.3: surface which path produced these regions
                      so the user knows whether DecomposeStudio split
                      mode is winning over auto-detect. */}
                          <span
                            className={`rounded px-1 font-mono text-[10px] ${
                              regionSource === "manual"
                                ? "border border-[var(--color-accent)] text-[var(--color-accent)]"
                                : "border border-[var(--color-border)] text-[var(--color-fg-dim)]"
                            }`}
                            title={
                              regionSource === "manual"
                                ? "user-defined regions from DecomposeStudio split mode"
                                : "auto-detected by connected-components — open DecomposeStudio split mode to override"
                            }
                          >
                            {regionSource}
                          </span>
                        </div>
                        <div className="flex flex-col gap-2">
                          {components.map((c, idx) => {
                            const color =
                              c.color ?? COMPONENT_COLORS[idx % COMPONENT_COLORS.length];
                            const thumb = componentThumbs[idx];
                            const sig = componentSignature(c.bbox);
                            // Manual regions carry their own name (read-only
                            // here — DecomposeStudio owns editing). Auto
                            // regions pull from the E.1 label dictionary,
                            // editable inline.
                            const isManual = c.name !== undefined;
                            const name = isManual ? (c.name ?? "") : (componentLabels[sig] ?? "");
                            const regionState = regionStates[idx];
                            const isRegionRunning = regionState?.status === "running";
                            const isRegionFailed = regionState?.status === "failed";
                            // F.4: gate ↻ on having *some* prompt to send. The
                            // panel-level Generate button has the same guard
                            // (`submitDisabled` includes `!prompt.trim()`); the
                            // ↻ button used to skip it and the API would 400
                            // with "prompt required", which surfaced as a
                            // mysterious "failed" tile. Now ↻ is disabled when
                            // both the common context and this region's
                            // textarea are empty — and the tooltip says why.
                            const regionHasPrompt =
                              prompt.trim().length > 0 ||
                              (componentPrompts[idx] ?? "").trim().length > 0;
                            const regenDisabled =
                              !provider?.available ||
                              providerId !== "openai" ||
                              phase.kind === "submitting" ||
                              phase.kind === "running" ||
                              phase.kind === "applying" ||
                              isRegionRunning ||
                              refining ||
                              !regionHasPrompt;
                            return (
                              <div
                                key={c.id}
                                className="rounded border bg-[var(--color-bg)] p-1.5"
                                style={{ borderColor: color }}
                              >
                                <div className="flex gap-2">
                                  <div
                                    className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded"
                                    style={{ background: "rgba(255,255,255,0.04)" }}
                                  >
                                    {thumb && (
                                      // biome-ignore lint/performance/noImgElement: thumbnail comes from a runtime data URL — next/image can't process it
                                      <img
                                        src={thumb.toDataURL("image/png")}
                                        alt={`region ${idx + 1}`}
                                        className="max-h-full max-w-full"
                                        draggable={false}
                                      />
                                    )}
                                    <span
                                      className="absolute -left-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-black"
                                      style={{ background: color }}
                                    >
                                      {idx + 1}
                                    </span>
                                    {/* F.2: per-region status overlay. Spinner
                                  on running, red dot on failed. Idle
                                  and succeeded are silent. */}
                                    {isRegionRunning && (
                                      <span className="absolute inset-0 flex items-center justify-center rounded bg-black/50 text-[10px] text-white">
                                        …
                                      </span>
                                    )}
                                    {isRegionFailed && (
                                      <span
                                        className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white"
                                        title={regionState?.failedReason ?? "failed"}
                                      >
                                        !
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                                    <div className="flex items-center gap-1">
                                      {isManual ? (
                                        // Manual regions: name is set in
                                        // DecomposeStudio split mode. Show
                                        // read-only here so the source of truth
                                        // stays single.
                                        <div className="min-w-0 flex-1 truncate text-[11px] font-medium text-[var(--color-fg)]">
                                          {name || (
                                            <span className="italic text-[var(--color-fg-dim)]">
                                              (unnamed)
                                            </span>
                                          )}
                                        </div>
                                      ) : (
                                        // E.1: editable region name. Persists per
                                        // (puppet, layer, component bbox) signature.
                                        <input
                                          type="text"
                                          value={name}
                                          onChange={(e) => setComponentLabel(sig, e.target.value)}
                                          placeholder={`name (e.g. torso, frill)`}
                                          className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-fg)] placeholder:text-[var(--color-fg-dim)] focus:border-[var(--color-accent)] focus:outline-none"
                                        />
                                      )}
                                      {/* F.4: per-region clear. Resets just
                                    this region's status + textarea to
                                    idle without disrupting the others.
                                    Useful when the failed/running tile
                                    is stuck and you want a fresh start. */}
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setComponentPrompts((prev) => {
                                            const next = [...prev];
                                            next[idx] = "";
                                            return next;
                                          });
                                          setRegionStates((prev) => {
                                            const next = [...prev];
                                            if (next[idx])
                                              next[idx] = {
                                                ...next[idx],
                                                status: "idle" as const,
                                                failedReason: undefined,
                                              };
                                            return next;
                                          });
                                        }}
                                        disabled={isRegionRunning}
                                        title="clear this region's prompt + status"
                                        className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[11px] text-[var(--color-fg-dim)] hover:border-[var(--color-fg-dim)] hover:text-[var(--color-fg)] disabled:cursor-not-allowed disabled:opacity-40"
                                      >
                                        ✕
                                      </button>
                                      {/* F.2: per-region regenerate. Reburns
                                    just this island's API call without
                                    touching the others. Cheap iteration
                                    when one tile came out wrong. */}
                                      <button
                                        type="button"
                                        onClick={() => {
                                          void regenerateOneRegion(idx);
                                        }}
                                        disabled={regenDisabled}
                                        title={
                                          isRegionRunning
                                            ? "regenerating this region…"
                                            : !regionHasPrompt
                                              ? "type a prompt (common context or this region's textarea) before regenerating"
                                              : "regenerate just this region (1 OpenAI call)"
                                        }
                                        className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[11px] text-[var(--color-fg-dim)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-40"
                                      >
                                        ↻
                                      </button>
                                    </div>
                                    <div className="flex items-center justify-between text-[10px] text-[var(--color-fg-dim)]">
                                      <span>
                                        {c.bbox.w}×{c.bbox.h} · {c.area.toLocaleString()} px
                                      </span>
                                      {regionState?.status === "succeeded" && (
                                        <span className="text-[var(--color-accent)]">
                                          ✓ generated
                                        </span>
                                      )}
                                      {isRegionFailed && (
                                        <span
                                          className="text-red-400"
                                          title={regionState?.failedReason}
                                        >
                                          failed
                                        </span>
                                      )}
                                    </div>
                                    {/* F.4: inline failure reason. Tooltips
                                  alone are too easy to miss; expand
                                  the reason under the tile so the user
                                  knows what to fix before retrying. */}
                                    {isRegionFailed && regionState?.failedReason && (
                                      <div className="rounded border border-red-500/30 bg-red-500/10 px-1.5 py-1 text-[10px] leading-relaxed text-red-300">
                                        {regionState.failedReason}
                                      </div>
                                    )}
                                    <textarea
                                      value={componentPrompts[idx] ?? ""}
                                      onChange={(e) =>
                                        setComponentPrompts((prev) => {
                                          const next = [...prev];
                                          next[idx] = e.target.value;
                                          return next;
                                        })
                                      }
                                      placeholder={
                                        name
                                          ? `${name} — what should fill this region?`
                                          : `region ${idx + 1} — what should fill this island?`
                                      }
                                      className="h-12 w-full resize-none rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-1.5 text-[11px] text-[var(--color-fg)] placeholder:text-[var(--color-fg-dim)] focus:border-[var(--color-accent)] focus:outline-none"
                                    />
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="mb-3">
                      <div className="mb-1 flex items-baseline justify-between">
                        <div className="uppercase tracking-widest text-[var(--color-fg-dim)]">
                          prompt
                          {isFocusedMulti && (
                            <span className="ml-1 normal-case tracking-normal text-[var(--color-fg-dim)]">
                              · this region only
                            </span>
                          )}
                        </div>
                        {/* G: per-region status / clear in focus mode. */}
                        {isFocusedMulti && focusedRegionState && (
                          <div className="flex items-center gap-1 text-[10px]">
                            {focusedRegionState.status === "succeeded" && (
                              <span className="text-[var(--color-accent)]">✓ generated</span>
                            )}
                            {focusedRegionState.status === "running" && (
                              <span className="text-[var(--color-fg-dim)]">running…</span>
                            )}
                            {focusedRegionState.status === "failed" && (
                              <span className="text-red-400">failed</span>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setFocusedPromptValue("");
                                if (focusedRegionIdx !== null) {
                                  const idx = focusedRegionIdx;
                                  setRegionStates((prev) => {
                                    const next = [...prev];
                                    if (next[idx])
                                      next[idx] = {
                                        ...next[idx],
                                        status: "idle" as const,
                                        failedReason: undefined,
                                      };
                                    return next;
                                  });
                                }
                              }}
                              className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
                              title="clear this region's prompt + status"
                            >
                              clear
                            </button>
                          </div>
                        )}
                      </div>
                      <textarea
                        value={focusedPromptValue}
                        onChange={(e) => setFocusedPromptValue(e.target.value)}
                        placeholder={
                          isFocusedMulti
                            ? `이 region 을 어떻게 채울지 설명 — 예: '네이비 플리츠 스커트, 흰색 레이스 단'`
                            : "새 텍스처 설명 — 예: '빨간 체크 스커트, 부드러운 코튼 재질'"
                        }
                        className="h-28 w-full resize-none rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-dim)] focus:border-[var(--color-accent)] focus:outline-none"
                      />
                      {isFocusedMulti &&
                        focusedRegionState?.status === "failed" &&
                        focusedRegionState.failedReason && (
                          <div className="mt-1 rounded border border-red-500/30 bg-red-500/10 px-1.5 py-1 text-[10px] leading-relaxed text-red-300">
                            {focusedRegionState.failedReason}
                          </div>
                        )}
                    </div>

                    <div className="mb-3">
                      <div className="mb-1 uppercase tracking-widest text-[var(--color-fg-dim)]">
                        negative prompt
                        <span className="ml-1 normal-case tracking-normal text-[var(--color-fg-dim)]">
                          (optional)
                        </span>
                      </div>
                      <textarea
                        value={negativePrompt}
                        onChange={(e) => setNegativePrompt(e.target.value)}
                        placeholder="피하고 싶은 요소"
                        className="h-16 w-full resize-none rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-dim)] focus:border-[var(--color-accent)] focus:outline-none"
                      />
                    </div>

                    {/* Active references — full control over what rides along
                this submit. Two channels:
                  1. Puppet refs (uploaded via ReferencesPanel) — toggle
                     individually for "skip this one this time" decisions.
                  2. Last result anchor — feeds the most recent succeeded
                     blob back as a reference so chained edits refine
                     rather than restart from scratch. The cloud-API
                     equivalent of `previous_response_id` chaining. */}
                    {provider && (references.length > 0 || lastResultBlob) && (
                      <div className="mb-3 rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2 text-[11px]">
                        {supportsRefs ? (
                          <>
                            <div className="mb-1.5 flex items-center justify-between text-[var(--color-fg)]">
                              <span>
                                Active references ({activeRefBlobs.length}/
                                {references.length + (lastResultBlob ? 1 : 0)})
                              </span>
                              <span className="text-[10px] text-[var(--color-fg-dim)]">
                                sent as <span className="font-mono">image[]</span> after source
                              </span>
                            </div>
                            {references.length > 0 && (
                              <ul className="mb-1 space-y-0.5">
                                {references.map((r) => {
                                  const enabled = !disabledRefIds.has(r.id);
                                  return (
                                    <li key={r.id} className="flex items-center gap-1.5">
                                      <input
                                        type="checkbox"
                                        checked={enabled}
                                        onChange={() => {
                                          setDisabledRefIds((prev) => {
                                            const next = new Set(prev);
                                            if (enabled) next.add(r.id);
                                            else next.delete(r.id);
                                            return next;
                                          });
                                        }}
                                        className="h-3 w-3"
                                        aria-label={`toggle reference ${r.name}`}
                                      />
                                      <span
                                        className={`flex-1 truncate font-mono ${
                                          enabled
                                            ? "text-[var(--color-fg)]"
                                            : "text-[var(--color-fg-dim)] line-through"
                                        }`}
                                        title={r.name}
                                      >
                                        {r.name}
                                      </span>
                                      <span className="shrink-0 text-[10px] text-[var(--color-fg-dim)]">
                                        {(r.blob.size / 1024).toFixed(0)}KB
                                      </span>
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                            {lastResultBlob && (
                              <label className="flex items-center gap-1.5 border-t border-[var(--color-border)] pt-1">
                                <input
                                  type="checkbox"
                                  checked={useLastResult}
                                  onChange={(e) => setUseLastResult(e.target.checked)}
                                  className="h-3 w-3"
                                  aria-label="toggle last-result iterative anchor"
                                />
                                <span
                                  className={`flex-1 italic ${
                                    useLastResult
                                      ? "text-[var(--color-accent)]"
                                      : "text-[var(--color-fg-dim)] line-through"
                                  }`}
                                  title="Most recent succeeded result, fed back as a reference so the next generation refines instead of restarting"
                                >
                                  last result · iteration anchor
                                </span>
                                <span className="shrink-0 text-[10px] text-[var(--color-fg-dim)]">
                                  {(lastResultBlob.size / 1024).toFixed(0)}KB
                                </span>
                              </label>
                            )}
                          </>
                        ) : (
                          <div className="text-[var(--color-fg-dim)]">
                            {references.length} reference image{references.length === 1 ? "" : "s"}{" "}
                            stored, but {provider.displayName} doesn't accept multi-image input —
                            they'll be ignored for this generation.
                          </div>
                        )}
                      </div>
                    )}

                    {/* Prompt refinement (Sprint 5.4) — chat-model rewrite
                of the user prompt into structured gpt-image-2 edit
                language. Only meaningful for OpenAI; the toggle stays
                visible even for other providers but is force-off so
                the user understands which lever applies where. */}
                    {provider && providerId === "openai" && (
                      <div className="mb-3 rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2 text-[11px]">
                        <label className="flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={usePromptRefine}
                            onChange={(e) => setUsePromptRefine(e.target.checked)}
                            className="h-3 w-3"
                            aria-label="toggle prompt refinement"
                          />
                          <span className="flex-1 text-[var(--color-fg)]">
                            Refine prompt via chat model before submit
                          </span>
                          {refining && (
                            <span className="text-[10px] text-[var(--color-accent)]">
                              refining…
                            </span>
                          )}
                        </label>
                        <p className="mt-1 text-[var(--color-fg-dim)]">
                          Rewrites your prompt as structured{" "}
                          <span className="font-mono">[image 1]</span> edit instructions following
                          gpt-image-2's prompting guide so the model doesn't conflate the source
                          canvas with the style references.
                        </p>
                        {refinement && refinement.rawAtRefine === prompt && (
                          <details className="mt-2 rounded border border-[var(--color-border)] bg-[var(--color-panel)] p-1.5">
                            <summary className="cursor-pointer text-[var(--color-fg-dim)]">
                              refined prompt ready · model={refinement.model}
                            </summary>
                            <pre className="mt-1 whitespace-pre-wrap break-words text-[11px] text-[var(--color-fg)]">
                              {refinement.refined}
                            </pre>
                          </details>
                        )}
                        {refineError && (
                          <p className="mt-1 text-[10px] text-red-400">
                            refine failed — falling back to raw prompt: {refineError}
                          </p>
                        )}
                      </div>
                    )}

                    {phase.kind === "applying" && (
                      <div className="mb-2 text-xs text-[var(--color-fg-dim)]">applying…</div>
                    )}

                    {visibleHistory.length > 0 && (
                      <div className="mt-4 flex min-h-0 shrink-0 flex-col">
                        <div className="mb-1 flex items-baseline justify-between uppercase tracking-widest text-[var(--color-fg-dim)]">
                          <span>
                            history · {visibleHistory.length}
                            {isFocusedMulti && history.length !== visibleHistory.length && (
                              <span className="ml-1 normal-case tracking-normal text-[10px] text-[var(--color-fg-dim)]">
                                (this region · {history.length} total)
                              </span>
                            )}
                          </span>
                          <span className="normal-case tracking-normal text-[10px]">
                            click to revisit · ☐ to compare
                          </span>
                        </div>
                        {comparisonIds.length > 0 && (
                          <div className="mb-1 flex items-center gap-1.5 text-[10px]">
                            <span className="text-[var(--color-fg-dim)]">
                              {comparisonIds.length}/2 selected
                            </span>
                            <button
                              type="button"
                              onClick={() => setComparisonOpen(true)}
                              disabled={comparisonRows.length < 1}
                              className="rounded border border-[var(--color-accent)] px-1.5 py-0.5 text-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              compare
                            </button>
                            <button
                              type="button"
                              onClick={() => setComparisonIds([])}
                              className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
                            >
                              clear
                            </button>
                          </div>
                        )}
                        <ul className="flex flex-col gap-1 overflow-y-auto pr-1">
                          {visibleHistory.map((row) => (
                            <HistoryRow
                              key={row.id}
                              row={row}
                              onRevisit={onRevisit}
                              selected={comparisonIds.includes(row.id)}
                              onToggleCompare={() => toggleComparison(row.id)}
                            />
                          ))}
                        </ul>
                      </div>
                    )}

                    {comparisonOpen && comparisonRows.length > 0 && (
                      <ComparisonModal
                        rows={comparisonRows}
                        onClose={() => setComparisonOpen(false)}
                      />
                    )}

                    <div className="mt-4 leading-relaxed text-[var(--color-fg-dim)]">
                      <div className="mb-1 uppercase tracking-widest">flow</div>
                      <ul className="list-inside list-disc space-y-1">
                        <li>
                          <span className="text-[var(--color-fg)]">decompose</span> refines the mask
                          first (optional)
                        </li>
                        <li>provider inpaints and returns a new texture</li>
                        <li>
                          <span className="text-[var(--color-fg)]">apply</span> composites it onto
                          the atlas page · live render reflects it next frame
                        </li>
                        <li>esc dismisses · result stays in the layer's overrides until reset</li>
                        {!puppetKey && (
                          <li className="text-yellow-400">
                            history is disabled until this puppet is saved to the library
                          </li>
                        )}
                      </ul>
                    </div>
                  </div>

                  {/* F.1: sticky actions footer. Always visible regardless
                of how long the scrollable content above gets. */}
                  <div className="flex flex-none flex-col gap-1.5 border-t border-[var(--color-border)] bg-[var(--color-bg)] p-3">
                    {/* G: in multi-region focus mode, the main button calls
                  the per-region helper so it spends one OpenAI call,
                  not N. Single-component / Gemini path runs the
                  legacy onSubmit. */}
                    <button
                      type="button"
                      onClick={() => {
                        if (isFocusedMulti && focusedRegionIdx !== null) {
                          void regenerateOneRegion(focusedRegionIdx);
                        } else {
                          void onSubmit();
                        }
                      }}
                      disabled={submitDisabled || refining}
                      className="rounded border border-[var(--color-accent)] px-3 py-1.5 text-sm text-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {focusedRegionState?.status === "running"
                        ? "generating this region…"
                        : phase.kind === "running"
                          ? "generating…"
                          : phase.kind === "submitting"
                            ? "submitting…"
                            : refining
                              ? "refining prompt…"
                              : isFocusedMulti
                                ? "generate this region"
                                : "generate"}
                    </button>
                    {phase.kind === "succeeded" && (
                      <>
                        <button
                          type="button"
                          onClick={onApply}
                          className="rounded border border-[var(--color-accent)] bg-[var(--color-accent)]/10 px-3 py-1.5 text-sm text-[var(--color-accent)]"
                          title="composite the result onto the atlas page"
                        >
                          apply to atlas
                        </button>
                        <button
                          type="button"
                          onClick={onReset}
                          className="rounded border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
                        >
                          reset · keep generating
                        </button>
                      </>
                    )}
                    {/* Revert just the focused region (multi-region only).
                    Pulls that region back to pristine atlas content
                    while keeping every other region's edits applied.
                    Atlas updates immediately. */}
                    {isFocusedMulti && (
                      <button
                        type="button"
                        onClick={() => {
                          void onRevertFocusedRegion();
                        }}
                        disabled={!existingTexture}
                        title={
                          existingTexture
                            ? "revert just this region back to its original atlas content"
                            : "no AI texture applied to this layer"
                        }
                        className="rounded border border-red-500/30 px-3 py-1 text-xs text-red-300/80 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        revert this region
                      </button>
                    )}
                    {/* F.3: revert applied texture. Only enabled when an
                  AI texture is currently on the layer. Destructive
                  (confirms first) — atlas falls back to its original
                  content. */}
                    <button
                      type="button"
                      onClick={() => {
                        void onRevertTexture();
                      }}
                      disabled={!existingTexture}
                      title={
                        existingTexture
                          ? "clear the applied AI texture and restore the original atlas content"
                          : "no AI texture applied to this layer"
                      }
                      className="rounded border border-red-500/40 px-3 py-1 text-xs text-red-300 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      revert layer · all regions
                    </button>
                  </div>
                </aside>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Compact history entry. Owns its blob URL lifecycle so the parent
 * doesn't have to track a list of URLs alongside the row list.
 *
 * Two affordances:
 *   - body click → revisit (fills the form with the row's prompt /
 *     provider / model and re-shows its result as if it just landed)
 *   - leading checkbox → toggle inclusion in the comparison set
 *     (capped at 2 by the parent)
 */
function HistoryRow({
  row,
  onRevisit,
  selected,
  onToggleCompare,
}: {
  row: AIJobRow;
  onRevisit: (row: AIJobRow) => void;
  selected: boolean;
  onToggleCompare: () => void;
}) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  useEffect(() => {
    const url = URL.createObjectURL(row.resultBlob);
    setThumbUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [row.resultBlob]);

  return (
    <li
      className={`flex items-stretch gap-1 rounded border p-1 ${
        selected
          ? "border-[var(--color-accent)] bg-[var(--color-accent)]/5"
          : "border-[var(--color-border)] hover:border-[var(--color-accent)]"
      }`}
    >
      <label className="flex shrink-0 cursor-pointer items-center px-1">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleCompare}
          className="h-3 w-3"
          aria-label={`include ${row.prompt} in comparison`}
        />
      </label>
      <button
        type="button"
        onClick={() => onRevisit(row)}
        className="flex flex-1 items-center gap-2 text-left text-xs"
      >
        {thumbUrl ? (
          // biome-ignore lint/performance/noImgElement: blob URL output
          <img
            src={thumbUrl}
            alt=""
            className="h-9 w-9 shrink-0 rounded border border-[var(--color-border)] bg-[var(--color-bg)] object-contain"
          />
        ) : (
          <span className="h-9 w-9 shrink-0 rounded border border-dashed border-[var(--color-border)]" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[10px] text-[var(--color-fg-dim)]">
            {row.providerId}
            {row.modelId ? ` · ${row.modelId.split("/").pop()}` : ""}
          </div>
          <div className="truncate text-[var(--color-fg)]">{row.prompt}</div>
          <div className="font-mono text-[10px] text-[var(--color-fg-dim)]">
            {formatRelative(row.createdAt)}
          </div>
        </div>
      </button>
    </li>
  );
}

/**
 * Side-by-side comparison of up to two `AIJobRow`s. Fills the same
 * full-screen overlay shell as the GeneratePanel itself but with two
 * result columns + their metadata (provider / model / prompt /
 * timestamp). Useful for "did the new ref / refined prompt actually
 * improve the result?" — Sprint 5.5's whole point.
 */
function ComparisonModal({ rows, onClose }: { rows: AIJobRow[]; onClose: () => void }) {
  const [urls, setUrls] = useState<(string | null)[]>([]);
  useEffect(() => {
    const made = rows.map((r) => URL.createObjectURL(r.resultBlob));
    setUrls(made);
    return () => {
      for (const u of made) URL.revokeObjectURL(u);
    };
  }, [rows]);

  // Esc to dismiss.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/80 p-4">
      <div className="flex h-full w-full max-w-6xl flex-col rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-4">
        <header className="mb-3 flex items-center justify-between text-sm">
          <span className="font-mono text-[var(--color-accent)]">compare · {rows.length} of 2</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
          >
            close (esc)
          </button>
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-hidden">
          {rows.map((row, i) => (
            <div
              key={row.id}
              className="flex min-h-0 flex-col rounded border border-[var(--color-border)] p-2"
            >
              <div className="mb-2 flex items-baseline justify-between text-[10px] text-[var(--color-fg-dim)]">
                <span className="font-mono">slot {String.fromCharCode(65 + i)}</span>
                <span>{formatRelative(row.createdAt)}</span>
              </div>
              <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[var(--color-panel)]">
                {urls[i] ? (
                  // biome-ignore lint/performance/noImgElement: blob URL preview
                  <img
                    src={urls[i] ?? undefined}
                    alt={`comparison slot ${i + 1}`}
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <span className="text-xs text-[var(--color-fg-dim)]">…</span>
                )}
              </div>
              <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-2 gap-y-1 text-[11px]">
                <dt className="text-[var(--color-fg-dim)]">provider</dt>
                <dd className="font-mono text-[var(--color-fg)]">
                  {row.providerId}
                  {row.modelId ? ` · ${row.modelId.split("/").pop()}` : ""}
                </dd>
                <dt className="text-[var(--color-fg-dim)]">prompt</dt>
                <dd className="break-words text-[var(--color-fg)]">{row.prompt}</dd>
                {row.negativePrompt && (
                  <>
                    <dt className="text-[var(--color-fg-dim)]">avoid</dt>
                    <dd className="break-words text-[var(--color-fg)]">{row.negativePrompt}</dd>
                  </>
                )}
                <dt className="text-[var(--color-fg-dim)]">size</dt>
                <dd className="font-mono text-[var(--color-fg-dim)]">
                  {(row.resultBlob.size / 1024).toFixed(0)} KB
                </dd>
              </dl>
            </div>
          ))}
          {rows.length === 1 && (
            <div className="flex min-h-0 items-center justify-center rounded border border-dashed border-[var(--color-border)] p-2 text-xs text-[var(--color-fg-dim)]">
              pick a second history row to fill slot B
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}
