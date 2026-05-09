"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AvatarAdapter } from "@/lib/adapters/AvatarAdapter";
import {
  canvasToPngBlob,
  compositeProcessedComponents,
  fetchProviders,
  type ProviderAvailability,
  postprocessGeneratedBlob,
  prepareOpenAISourcesPerComponent,
  refinePrompt,
  submitGenerate,
} from "@/lib/ai/client";
import type { ProviderId } from "@/lib/ai/types";
import { extractCurrentLayerCanvas } from "@/lib/avatar/regionExtract";
import type { Layer } from "@/lib/avatar/types";
import { useReferences } from "@/lib/avatar/useReferences";
import { type AIJobRow, listAIJobsForLayer, saveAIJob } from "@/lib/persistence/db";
import { useEditorStore } from "@/lib/store/editor";

type Props = {
  adapter: AvatarAdapter | null;
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
export function GeneratePanel({ adapter, layer, puppetKey }: Props) {
  const close = useEditorStore((s) => s.setGenerateLayer);
  const existingMask = useEditorStore((s) => s.layerMasks[layer.id] ?? null);
  const existingTexture = useEditorStore((s) => s.layerTextureOverrides[layer.id] ?? null);
  const setLayerTextureOverride = useEditorStore((s) => s.setLayerTextureOverride);

  const sourceRef = useRef<HTMLCanvasElement | null>(null);
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
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [providers, setProviders] = useState<ProviderAvailability[] | null>(null);
  const [providerId, setProviderId] = useState<ProviderId>("gemini");
  const [modelId, setModelId] = useState<string>("");
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");

  /** Last submit's component count, surfaced in the structured submit
   *  log so the user can correlate result quality with how many
   *  per-island calls fired. Multi-component layers (e.g. torso +
   *  shoulder frill in one slot) split into N parallel OpenAI calls
   *  and N postprocesses are composited back into a single texture. */
  const lastComponentCountRef = useRef<number>(0);

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
      setError("layer has no texture region");
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
        setError("region rect is empty / unrenderable");
        return;
      }
      aiSourceCanvasRef.current = aiExtracted.canvas;

      const previewExtracted = await extractCurrentLayerCanvas(adapter, layer, {
        texture: existingTexture,
        mask: existingMask,
      });
      if (cancelled) return;
      previewSourceRef.current = previewExtracted?.canvas ?? aiExtracted.canvas;

      setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [adapter, layer, existingTexture, existingMask]);

  // ----- after-mount: paint preview onto the display canvas -----
  // Split from the extract effect because the display `<canvas>` is only
  // rendered when `ready === true`, so its ref isn't attached during the
  // same effect tick that flips ready. This effect runs after the next
  // render, when the canvas is actually in the DOM.
  useEffect(() => {
    if (!ready) return;
    const display = sourceRef.current;
    const preview = previewSourceRef.current;
    if (!display || !preview) return;
    display.width = preview.width;
    display.height = preview.height;
    display.getContext("2d")?.drawImage(preview, 0, 0);
  }, [ready]);

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

  // Esc closes (but not while running, to avoid losing in-flight job)
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      if (phase.kind === "running" || phase.kind === "submitting") return;
      close(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, phase.kind]);

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
  const comparisonRows = useMemo(
    () =>
      comparisonIds.map((id) => history.find((r) => r.id === id)).filter((r): r is AIJobRow => !!r),
    [comparisonIds, history],
  );
  // Drop selections that no longer exist (e.g. history was reloaded
  // and a row got pruned). Run after every history fetch.
  useEffect(() => {
    setComparisonIds((prev) => prev.filter((id) => history.some((r) => r.id === id)));
  }, [history]);

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
      const useMultiComponent = providerId === "openai";
      const components = useMultiComponent
        ? await prepareOpenAISourcesPerComponent(sourceCanvas)
        : null;
      if (components) {
        lastComponentCountRef.current = components.length;
        console.info(
          `[GeneratePanel] openai submit: sourceCanvas=${sourceCanvas.width}x${sourceCanvas.height}, ` +
            `components=${components.length}` +
            components
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
      let geminiSourceBlob: Blob | undefined;
      let geminiMaskBlob: Blob | undefined;
      if (!useMultiComponent) {
        geminiSourceBlob = await canvasToPngBlob(sourceCanvas);
        geminiMaskBlob = existingMask ?? undefined;
      }

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
          (components ? ` components=${components.length}` : ""),
      );
      console.info("layer:", {
        id: layer.id,
        name: layer.name,
        externalId: layer.externalId,
        textureId: layer.texture?.textureId,
        rect: layer.texture?.rect,
      });
      console.info("provider:", { id: providerId, model: modelId || "(provider default)" });
      if (components) {
        console.info(
          `source split into ${components.length} component(s) — one OpenAI call per component, results composited:`,
          components.map((c, i) => ({
            componentId: i,
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
      if (negativePrompt.trim()) console.info("negative prompt:", negativePrompt);
      console.info(
        "note: provider wraps the (refined) prompt in slot-mapping + preservation scaffolding. Check the [openai] server log for the full composed text actually sent to /v1/images/edits.",
      );
      console.groupEnd();

      let processed: Blob;

      if (components) {
        // Multi-component OpenAI path: fire N submits in parallel,
        // postprocess each into a source-canvas-sized canvas with only
        // that component's silhouette painted, then composite them all
        // into one final blob. Same prompt + same refs hit every call;
        // per-component prompt routing is A.3 territory.
        const componentBlobs = await Promise.all(
          components.map(async (comp, idx) => {
            const compSourceBlob = await canvasToPngBlob(comp.padded);
            const rawResult = await submitGenerate({
              providerId,
              prompt,
              refinedPrompt: refinedPromptForSubmit,
              negativePrompt: negativePrompt.trim() || undefined,
              modelId: modelId || undefined,
              sourceImage: compSourceBlob,
              referenceImages: activeRefBlobs.length > 0 ? activeRefBlobs : undefined,
            });
            console.info(
              `[GeneratePanel] component[${idx}] received ${rawResult.size}B — postprocessing`,
            );
            // Alpha-enforce against the component's binary mask (not
            // the full source) so any over-paint into other components'
            // bbox area gets zeroed before composite.
            return await postprocessGeneratedBlob({
              blob: rawResult,
              sourceCanvas: comp.componentMaskCanvas,
              openAIPadding: {
                paddingOffset: comp.paddingOffset,
                sourceBBox: comp.sourceBBox,
              },
            });
          }),
        );
        processed = await compositeProcessedComponents({
          componentBlobs,
          sourceCanvas,
        });
      } else {
        // Gemini path stays single-source / mask-aware.
        if (!geminiSourceBlob) throw new Error("gemini source not prepared");
        const rawResult = await submitGenerate({
          providerId,
          prompt,
          refinedPrompt: refinedPromptForSubmit,
          negativePrompt: negativePrompt.trim() || undefined,
          modelId: modelId || undefined,
          sourceImage: geminiSourceBlob,
          maskImage: geminiMaskBlob,
          referenceImages: activeRefBlobs.length > 0 ? activeRefBlobs : undefined,
        });
        // No tight-crop / sourceBBox for Gemini — it reads native dims.
        processed = await postprocessGeneratedBlob({
          blob: rawResult,
          sourceCanvas,
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
      // `puppetKey === null` happens for /poc/upload before autoSave
      // settles — we just skip persistence in that case.
      if (puppetKey) {
        try {
          await saveAIJob({
            puppetKey,
            layerExternalId: layer.externalId,
            providerId,
            modelId: modelId || undefined,
            prompt,
            negativePrompt: negativePrompt.trim() || undefined,
            resultBlob: processed,
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

  const submitDisabled =
    !ready ||
    !provider?.available ||
    phase.kind === "submitting" ||
    phase.kind === "running" ||
    phase.kind === "applying" ||
    !prompt.trim();

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
        onClick={() => close(null)}
        className="absolute inset-0 cursor-default"
      />
      <div className="relative z-10 m-auto flex h-[90vh] w-[min(92vw,1200px)] flex-col rounded border border-[var(--color-border)] bg-[var(--color-bg)] shadow-2xl">
        <header className="flex shrink-0 items-center gap-3 border-b border-[var(--color-border)] px-4 py-2 text-xs">
          <span className="font-mono text-[var(--color-accent)]">generate · v1</span>
          <span className="text-[var(--color-fg-dim)]">{layer.name}</span>
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
            onClick={() => close(null)}
            className="ml-auto rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
            title="esc"
          >
            close
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[1fr_1fr_320px] overflow-hidden">
          {/* source */}
          <div
            className="flex min-h-0 min-w-0 flex-col items-center justify-center gap-2 border-r border-[var(--color-border)] p-4"
            style={previewBg}
          >
            <div className="text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
              source
            </div>
            {error ? (
              <div className="text-sm text-red-400">{error}</div>
            ) : !ready ? (
              <div className="text-sm text-[var(--color-fg-dim)]">loading region…</div>
            ) : (
              <canvas
                ref={sourceRef}
                className="max-h-full max-w-full border border-[var(--color-border)]"
              />
            )}
          </div>

          {/* result */}
          <div
            className="flex min-h-0 min-w-0 flex-col items-center justify-center gap-2 p-4"
            style={previewBg}
          >
            <div className="text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
              result
            </div>
            {phase.kind === "idle" && (
              <div className="text-sm text-[var(--color-fg-dim)]">generate to see output</div>
            )}
            {phase.kind === "submitting" && (
              <div className="text-sm text-[var(--color-fg-dim)]">submitting…</div>
            )}
            {phase.kind === "running" && (
              <div className="flex flex-col items-center gap-1 text-sm text-[var(--color-fg-dim)]">
                <span>generating · provider call in flight</span>
                <span className="text-xs">Gemini ~5–15s · OpenAI ~10–30s · don't dismiss</span>
              </div>
            )}
            {phase.kind === "failed" && (
              <div className="max-w-md text-sm text-red-400">
                <div className="mb-2 font-medium">failed</div>
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
          </div>

          <aside className="flex min-h-0 flex-col border-l border-[var(--color-border)] p-4 text-xs">
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

            <div className="mb-3">
              <div className="mb-1 uppercase tracking-widest text-[var(--color-fg-dim)]">
                prompt
              </div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="describe the new texture — e.g. 'red plaid skirt, soft cotton fabric'"
                className="h-28 w-full resize-none rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-dim)] focus:border-[var(--color-accent)] focus:outline-none"
              />
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
                placeholder="things to avoid"
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
                    {references.length} reference image{references.length === 1 ? "" : "s"} stored,
                    but {provider.displayName} doesn't accept multi-image input — they'll be ignored
                    for this generation.
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
                    <span className="text-[10px] text-[var(--color-accent)]">refining…</span>
                  )}
                </label>
                <p className="mt-1 text-[var(--color-fg-dim)]">
                  Rewrites your prompt as structured <span className="font-mono">[image 1]</span>{" "}
                  edit instructions following gpt-image-2's prompting guide so the model doesn't
                  conflate the source canvas with the style references.
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

            <button
              type="button"
              onClick={onSubmit}
              disabled={submitDisabled || refining}
              className="rounded border border-[var(--color-accent)] px-3 py-1.5 text-sm text-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {phase.kind === "running"
                ? "generating…"
                : phase.kind === "submitting"
                  ? "submitting…"
                  : refining
                    ? "refining prompt…"
                    : "generate"}
            </button>
            {phase.kind === "succeeded" && (
              <div className="mt-2 flex flex-col gap-1">
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
              </div>
            )}
            {phase.kind === "applying" && (
              <div className="mt-2 text-xs text-[var(--color-fg-dim)]">applying…</div>
            )}

            {history.length > 0 && (
              <div className="mt-4 flex min-h-0 shrink-0 flex-col">
                <div className="mb-1 flex items-baseline justify-between uppercase tracking-widest text-[var(--color-fg-dim)]">
                  <span>history · {history.length}</span>
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
                  {history.map((row) => (
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
              <ComparisonModal rows={comparisonRows} onClose={() => setComparisonOpen(false)} />
            )}

            <div className="mt-auto leading-relaxed text-[var(--color-fg-dim)]">
              <div className="mb-1 uppercase tracking-widest">flow</div>
              <ul className="list-inside list-disc space-y-1">
                <li>
                  <span className="text-[var(--color-fg)]">decompose</span> refines the mask first
                  (optional)
                </li>
                <li>provider inpaints and returns a new texture</li>
                <li>
                  <span className="text-[var(--color-fg)]">apply</span> composites it onto the atlas
                  page · live render reflects it next frame
                </li>
                <li>esc dismisses · result stays in the layer's overrides until reset</li>
                {!puppetKey && (
                  <li className="text-yellow-400">
                    history is disabled until this puppet is saved to the library
                  </li>
                )}
              </ul>
            </div>
          </aside>
        </div>
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
