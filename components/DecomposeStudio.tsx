"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrushCursor } from "@/components/decompose/BrushCursor";
import { HistoryPanel } from "@/components/decompose/HistoryPanel";
import { MarchingAnts } from "@/components/decompose/MarchingAnts";
import { OptionsBar } from "@/components/decompose/OptionsBar";
import { Toolbox } from "@/components/decompose/Toolbox";
import { WandActionBar } from "@/components/decompose/WandActionBar";
import type { AvatarAdapter } from "@/lib/adapters/AvatarAdapter";
import { submitSam } from "@/lib/ai/sam/client";
import type { SamCandidate, SamPoint } from "@/lib/ai/sam/types";
import { findAlphaComponents } from "@/lib/avatar/connectedComponents";
import {
  type Compositor,
  type CompositorInputs,
  createCompositor,
} from "@/lib/avatar/decompose/compositor";
import {
  runFlood,
  maskToCanvas as workerMaskToCanvas,
} from "@/lib/avatar/decompose/floodFillClient";
import { StrokeEngine } from "@/lib/avatar/decompose/strokeEngine";
import {
  type BrushOp,
  defaultWandOptions,
  type SelectionOp,
  type StudioMode,
  type ToolId,
  toolForShortcut,
  type WandOptions,
} from "@/lib/avatar/decompose/tools";
import { useCanvasViewport } from "@/lib/avatar/decompose/useCanvasViewport";
import { type CanvasKey, useHistory } from "@/lib/avatar/decompose/useHistory";
import {
  composeSelection,
  featherSelection,
  growSelection,
  invertSelection,
  selectionArea,
  shrinkSelection,
} from "@/lib/avatar/decompose/wandSelection";
import { ID_PREFIX, newId } from "@/lib/avatar/id";
import { extractCurrentLayerCanvas } from "@/lib/avatar/regionExtract";
import type { Layer } from "@/lib/avatar/types";
import { useRegionMasks } from "@/lib/avatar/useRegionMasks";
import type { RegionMaskEntry } from "@/lib/persistence/db";
import { useEditorStore } from "@/lib/store/editor";

type Props = {
  adapter: AvatarAdapter | null;
  layer: Layer;
  /** Stable puppet key — needed for E.2 region masks IDB persistence.
   *  `null` disables persistence (regions live only in memory). */
  puppetKey: string | null;
  /** Embedded mode (used by GeneratePanel's MASK tab). Drops the
   *  modal wrapper, header, fullscreen toggle, and mode toggle so the
   *  studio sits inline inside another surface. When set, only the
   *  "mask" studioMode is exposed — split / paint mode toggles are
   *  hidden because the embedded caller wants a single inpaint mask
   *  out and nothing else. */
  embedded?: boolean;
  /** Output callback used in place of the editor store's `setLayerMask`
   *  when set. The embedded surface (GeneratePanel) reads this blob as
   *  the AI's inpaint mask, which is a different concept from
   *  DecomposeStudio's regular hide-mask — same brush UX, different
   *  destination. Called with `null` when the user clears the mask. */
  onMaskCommit?: (blob: Blob | null) => void;
  /** Baseline mask blob to seed the brush canvas with. Used in embedded
   *  mode so the inpaint mask state survives GEN ↔ MASK tab toggles
   *  inside GeneratePanel. Ignored in standalone mode (which reads
   *  the store's hide-mask). Pass `null` to start blank. */
  maskBaseline?: Blob | null;
  /** Close request handler. Embedded mode skips the store's
   *  `setStudioLayer(null)` exit; the parent owns dismissal (e.g. by
   *  toggling back to its GEN tab). Standalone mode keeps the legacy
   *  store-based close path. */
  onClose?: () => void;
};

/**
 * Legacy brush sub-mode preserved for the existing SAM apply path.
 *
 * The new tool system (ToolId from `lib/avatar/decompose/tools`) is
 * the source of truth for what the user is doing — see `selectedTool`
 * + `brushOp` below. This local enum stays only because the SAM
 * effect at the bottom of the file keys off `mode === "auto"` to
 * clear point state when leaving auto sub-mode; rather than
 * rewriting that effect we derive the legacy value from the new
 * state on the fly via `legacyMode()`.
 */
type BrushMode = "paint" | "erase" | "auto";
/**
 * Top mode toggle (StudioMode imported from `lib/avatar/decompose/tools`):
 *   - "mask"  — single-mask paint/erase. Saves to
 *               `editorStore.layerMasks[layer.id]`.
 *   - "split" — multi-region painter. Each named region has its own
 *               binary mask; brush paints into the selected region.
 *               Saves to IDB (`regionMasks`).
 *   - "paint" — direct texture editing. Brush / Bucket / Wand-fill
 *               write coloured pixels onto a clone of the layer's
 *               current texture; eraser wipes pixels to transparent.
 *               Saves to `editorStore.layerTextureOverrides[layer.id]`
 *               so the rest of the editor / GeneratePanel sees the
 *               new texture as the layer's pristine source.
 */

const REGION_COLORS = ["#22c55e", "#f97316", "#ec4899", "#3b82f6", "#eab308", "#a855f7"];

/**
 * Modal overlay for refining a layer's atlas region into a clean mask.
 * v1 capabilities: alpha-threshold cutoff + brush paint/erase. The
 * "save" button writes a PNG blob to `editorStore.layerMasks[layer.id]`,
 * which downstream features (DecomposeStudio Pro / ControlNet input
 * generation) can pick up. No IDB persistence yet — masks evaporate
 * with the avatar.
 *
 * Display canvas dimensions = source dimensions (1:1) so brush strokes
 * map to source pixels exactly. CSS scales the canvas to fit the modal.
 */
export function DecomposeStudio({
  adapter,
  layer,
  puppetKey,
  embedded = false,
  onMaskCommit,
  onClose,
  maskBaseline,
}: Props) {
  const close = useEditorStore((s) => s.setStudioLayer);
  const setMask = useEditorStore((s) => s.setLayerMask);
  const setLayerTextureOverride = useEditorStore((s) => s.setLayerTextureOverride);
  const existingMaskFromStore = useEditorStore((s) => s.layerMasks[layer.id] ?? null);
  // Embedded callers (GeneratePanel MASK tab) supply their own
  // baseline so the inpaint-mask state survives a tab toggle and
  // doesn't accidentally pick up the layer's hide-mask from the
  // editor store — different concepts, opposite semantics.
  const existingMask = embedded ? (maskBaseline ?? null) : existingMaskFromStore;
  const existingTexture = useEditorStore((s) => s.layerTextureOverrides[layer.id] ?? null);

  const sourceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  /** Paint mode's working texture canvas. Cloned from the source on
   *  first entry into paint mode; brush / bucket / wand-fill write
   *  coloured pixels into it. On save, this is what becomes the new
   *  layer texture override. */
  const paintCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  /** State-tracked mirror of `previewRef.current`. Some child
   *  components (BrushCursor) need to know when the preview canvas
   *  actually mounts so they can attach pointer listeners; a
   *  RefObject's stable identity won't trigger their useEffect, but
   *  state changes will. The callback ref below keeps both in sync. */
  const [previewEl, setPreviewEl] = useState<HTMLCanvasElement | null>(null);
  const setPreviewRef = useCallback((el: HTMLCanvasElement | null) => {
    previewRef.current = el;
    setPreviewEl(el);
  }, []);
  /** Source canvas dimensions exposed to children that need them
   *  for scaling math. Bumped when the layer changes. */
  const [sourceDim, setSourceDim] = useState<{ width: number; height: number } | null>(null);
  /** Wrapper that the CSS zoom/pan transform is applied to. Pan +
   *  wheel zoom listeners attach here so the user can scroll past
   *  the canvas's edge to pan into empty space without losing the
   *  drag. */
  const canvasWrapperRef = useRef<HTMLDivElement | null>(null);
  /** Path describing the layer's true footprint inside the bbox crop.
   *  When present, the brush is clipped to it so paint outside doesn't
   *  reach atlas neighbors that aren't part of this layer. */
  const clipPathRef = useRef<Path2D | null>(null);
  const paintingRef = useRef(false);
  /** Ref to the latest pointer position in source-pixel space. The
   *  brush cursor overlay reads this every frame to redraw the
   *  outline circle without forcing a React re-render. */
  const pointerPosRef = useRef<{ x: number; y: number } | null>(null);

  // ── Viewport (zoom + pan) ─────────────────────────────────────────
  const viewport = useCanvasViewport({ containerRef: canvasWrapperRef });

  /** GPU-aware compositor. Created lazily after the preview canvas
   *  mounts (so it can claim the WebGL2 context). The studio just
   *  pushes inputs + calls invalidate(); rAF coalescing inside the
   *  compositor keeps render cost bounded regardless of how many
   *  pointer / state-change events arrive per frame. */
  const compositorRef = useRef<Compositor | null>(null);
  /** Brush stroke pipeline — handles stamp interpolation, pressure,
   *  sub-pixel positioning. One engine for the panel's lifetime;
   *  beginStroke / addSample / endStroke cycle per pointer drag. */
  const strokeEngineRef = useRef<StrokeEngine | null>(null);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(0); // 0..255, 0 = no threshold mask
  const [brushSize, setBrushSize] = useState(20);
  const [brushHardness, setBrushHardness] = useState(80); // 0..100; 100=hard, 0=soft
  const [bucketTolerance, setBucketTolerance] = useState(32); // 0..128 — bucket only
  /** Magic wand options — Photoshop-class panel (tolerance, sample
   *  mode, sample size, contiguous, anti-alias). The studio holds
   *  this here so wand clicks pick up the latest settings; the
   *  OptionsBar mutates the object via onWand. */
  const [wandOpts, setWandOpts] = useState<WandOptions>(defaultWandOptions);
  /** Pen tablet pressure dynamics. Toggles in the OptionsBar; the
   *  stroke engine reads them every beginStroke(). */
  const [pressureSize, setPressureSize] = useState(false);
  const [pressureOpacity, setPressureOpacity] = useState(false);
  /** Opt-in 2× mask resolution. When enabled, the mask + paint
   *  canvases are allocated at double source dim so brush strokes
   *  stay sub-pixel-crisp at deep zoom. Memory cost is ~ 4×; off by
   *  default. Only meaningful in trim mode (paint already paints in
   *  source pixels which downstream consumers expect). */
  const [highDpiMask, setHighDpiMask] = useState(false);
  /** New tool system. The default tool is "brush" (B) so the user
   *  lands ready to paint, matching the previous default. */
  const [selectedTool, setSelectedTool] = useState<ToolId>("brush");
  /** Brush / Eraser / Bucket all share this op. Brush + Bucket
   *  default to "add"; Eraser overrides to "remove" via the
   *  effective-op derivation in paintAt(). The OptionsBar still
   *  exposes the toggle so the user can swap a brush into reveal
   *  mode without leaving the brush tool. */
  const [brushOp, setBrushOp] = useState<BrushOp>("add");
  /** Magic wand selection state. The selection is a same-dim
   *  bitmap (0xff inside, 0x00 outside) the user can preview as a
   *  marquee outline + apply to the active mask via the OptionsBar
   *  / inline panel. Cleared when the user hits Esc, switches
   *  layers, or applies the selection. */
  const [wandSelection, setWandSelection] = useState<HTMLCanvasElement | null>(null);
  const [wandSelectionArea, setWandSelectionArea] = useState(0);
  /** Foreground colour for paint-mode strokes / fills. Updated by
   *  the OptionsBar colour picker and by the Eyedropper tool. */
  const [foregroundColor, setForegroundColor] = useState("#ffffff");
  /** Dirty flag for paint mode — distinct from `dirty` (trim) and
   *  `splitDirty` (split) so the unsaved-changes warning is precise. */
  const [paintDirty, setPaintDirty] = useState(false);
  /** Map selectedTool back to the legacy paint/erase/auto enum the
   *  SAM bookkeeping effect keys off. Stays in sync automatically
   *  whenever the tool changes. */
  const mode = useMemo<BrushMode>(() => {
    if (selectedTool === "sam") return "auto";
    if (selectedTool === "eraser") return "erase";
    return "paint";
  }, [selectedTool]);
  /** Compatibility shim for legacy call sites that still call
   *  `setMode("paint" | "erase" | "auto")`. Routes the legacy mode
   *  back onto the new (selectedTool, brushOp) pair so the existing
   *  sidebar buttons keep working until they're swapped out for
   *  the new Toolbox + OptionsBar UI. */
  const setMode = useCallback((next: BrushMode) => {
    if (next === "auto") setSelectedTool("sam");
    else if (next === "erase") setSelectedTool("eraser");
    else setSelectedTool("brush");
  }, []);
  /** Effective brush op — Eraser is permanently "remove"; other
   *  tools follow the explicit toggle. Bucket uses the same. */
  const effectiveBrushOp = useCallback(
    (tool: ToolId = selectedTool): BrushOp => (tool === "eraser" ? "remove" : brushOp),
    [selectedTool, brushOp],
  );
  const [dirty, setDirty] = useState(false);

  // E.2: studio-level mode + multi-region state. Region canvases are
  // kept in a ref-keyed map alongside `regionEntries` (which holds
  // metadata: id, name, color). Painting in split mode writes into
  // the canvas for the currently-selected region; save bakes each
  // canvas to a PNG blob and persists the bundle to IDB.
  const [studioMode, setStudioMode] = useState<StudioMode>("mask");
  // Embedded callers only want the single-mask brush surface. The
  // mode toggle UI is hidden in that path, but this guard catches any
  // accidental setStudioMode call (future shortcut, hot reload state
  // bleed, etc.) so the inpaint flow can never end up in split/paint
  // mode by mistake.
  useEffect(() => {
    if (embedded && studioMode !== "mask") setStudioMode("mask");
  }, [embedded, studioMode]);
  const {
    regions: persistedRegions,
    save: saveRegions,
    clear: clearRegions,
  } = useRegionMasks(puppetKey, layer.externalId);
  const [regionEntries, setRegionEntries] = useState<{ id: string; name: string; color: string }[]>(
    [],
  );
  const regionCanvasMap = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [splitDirty, setSplitDirty] = useState(false);
  /** Region "solo" focus. When set to a region id, only that region's
   *  mask is rendered on the canvas (others are hidden) and the brush
   *  is locked to it — paint strokes can never accidentally land on
   *  other regions. The selected region keeps its independent
   *  pointer; toggling solo doesn't change which region the next
   *  brush stroke targets. Null = normal multi-region overlay. */
  const [focusRegionId, setFocusRegionId] = useState<string | null>(null);

  // Sprint 6.2: SAM auto-mask state. Points accumulate while the
  // brush is in "auto" mode; "compute mask" sends them to the SAM
  // route and stashes the candidate masks. The user clicks a
  // candidate to union it into the currently-selected region's
  // canvas, then optionally refines with paint/erase. Empty until
  // a brush click in auto mode lands a point.
  const [samPoints, setSamPoints] = useState<SamPoint[]>([]);
  const [samCandidates, setSamCandidates] = useState<SamCandidate[] | null>(null);
  const [samRunning, setSamRunning] = useState(false);
  const [samError, setSamError] = useState<string | null>(null);
  /** Sprint 6.3: how a SAM candidate (or any compose-time mask op)
   *  combines with the existing region canvas at apply time:
   *    - add       — source-over (union; default)
   *    - intersect — destination-in (keep only the overlap)
   *    - subtract  — destination-out (remove the candidate area)
   *  Brush paint/erase already cover add/subtract on per-stroke
   *  basis; this affordance is for SAM-driven composition where
   *  the user gets a whole-region candidate at once. */
  const [samComposeOp, setSamComposeOp] = useState<"add" | "intersect" | "subtract">("add");
  /** Sprint 6.5: fullscreen toggle. The default modal cap of
   *  90vh × min(90vw, 1100px) is fine for small layers but
   *  cramped when the source canvas is 4k+ — split-mode regions
   *  list also eats into the canvas area. Fullscreen mode
   *  switches the modal box to the full viewport so the canvas
   *  gets every pixel CSS can give it. */
  const [fullscreen, setFullscreen] = useState(false);
  /** Source canvas aspect ratio (W/H), captured once the source
   *  bitmap is ready. The canvas wrapper uses this as a CSS
   *  `aspect-ratio` so the modal layout cannot stretch the
   *  rendered texture along one axis when both `max-w-full` and
   *  `max-h-full` would otherwise activate together. Without an
   *  explicit ratio the browser splits each dim independently and
   *  the drawn bitmap squashes — the symptom the user reported
   *  in fullscreen / wide modal: a circle becomes an ellipse. */
  const [sourceAspect, setSourceAspect] = useState<number | undefined>(undefined);
  /** Flag: the user has explicitly entered split mode at least once
   *  this session. We use it to fire `autoDetectRegions` exactly
   *  once per panel mount when there are no persisted regions —
   *  surfacing the auto-detect baseline immediately rather than
   *  forcing a click. Re-entering split mode after manual edits
   *  doesn't reset the regions; only the very first entry seeds
   *  them. */
  const splitAutoSeededRef = useRef(false);

  // ----- load source + initial mask -----
  // Source = base layer + texture override (if any). The mask layer is
  // loaded into its own canvas so the user can paint additional strokes
  // on top of the gen-applied source. Triple-stacked workflow works:
  // a previously applied gen shows up as the source, the previous mask
  // shows up as red painted strokes, and new strokes compose with both.
  useEffect(() => {
    setReady(false);
    setError(null);
    setDirty(false);
    setSourceDim(null);
    if (!adapter || !layer.texture) {
      setError("이 레이어에는 텍스처 영역이 없습니다");
      return;
    }

    let cancelled = false;
    void (async () => {
      const extracted = await extractCurrentLayerCanvas(adapter, layer, {
        texture: existingTexture,
        // Mask is loaded separately into the brush canvas (see below)
        // so the user can edit it. Don't pre-apply to the source.
      });
      if (cancelled) return;
      if (!extracted) {
        setError("영역이 비어있거나 렌더링할 수 없습니다");
        return;
      }
      sourceCanvasRef.current = extracted.canvas;
      clipPathRef.current = extracted.clip;
      // Lock the canvas wrapper to the layer's actual aspect ratio
      // so the modal layout can never stretch the texture (see
      // sourceAspect doc).
      if (extracted.canvas.width > 0 && extracted.canvas.height > 0) {
        setSourceAspect(extracted.canvas.width / extracted.canvas.height);
        setSourceDim({ width: extracted.canvas.width, height: extracted.canvas.height });
      }

      // mask canvas: 0 alpha = unmasked (visible), 255 alpha = masked.
      // Allocated at 2× source dim when "HD edge" is on so strokes
      // stay sub-pixel-crisp at deep zoom. The clip path lives in
      // source coords so the stroke engine scales coords up before
      // stamping — see clipPathRef wiring below.
      const maskScale = highDpiMask ? 2 : 1;
      const mask = document.createElement("canvas");
      mask.width = extracted.canvas.width * maskScale;
      mask.height = extracted.canvas.height * maskScale;
      maskCanvasRef.current = mask;

      // Paint canvas: starts as a clone of the source so brush
      // strokes paint over the existing texture. Reuses the
      // already-extracted source bitmap (which already includes
      // any prior `existingTexture` override).
      const paint = document.createElement("canvas");
      paint.width = extracted.canvas.width;
      paint.height = extracted.canvas.height;
      const paintCtx = paint.getContext("2d");
      if (paintCtx) paintCtx.drawImage(extracted.canvas, 0, 0);
      paintCanvasRef.current = paint;
      setPaintDirty(false);

      if (existingMask) {
        // restore previous mask if any
        const img = new Image();
        img.onload = () => {
          if (cancelled) return;
          const ctx = mask.getContext("2d");
          if (ctx) {
            ctx.drawImage(img, 0, 0, mask.width, mask.height);
            // **Convention round-trip**: when the saved mask uses the
            // inpaint convention (RGB white = edit, alpha=255 everywhere),
            // a naive drawImage leaves alpha=255 over the whole canvas
            // and the mask UI shows the entire frame as masked. Decompose's
            // brush canvas keeps the mask in the alpha channel, so we
            // re-encode: read luma, write to alpha, clear RGB. The
            // standalone hide-mask convention (RGB black + variable
            // alpha) is left as-is by detecting `embedded` from the
            // caller — the same prop that triggered the inpaint encoding
            // on save.
            if (embedded) {
              const w = mask.width;
              const h = mask.height;
              const data = ctx.getImageData(0, 0, w, h);
              const px = data.data;
              for (let i = 0; i < px.length; i += 4) {
                const luma = (px[i] + px[i + 1] + px[i + 2]) / 3;
                px[i] = 0;
                px[i + 1] = 0;
                px[i + 2] = 0;
                px[i + 3] = luma >= 128 ? 255 : 0;
              }
              ctx.putImageData(data, 0, 0);
            }
          }
          setReady(true);
        };
        img.onerror = () => {
          if (!cancelled) setReady(true);
        };
        img.src = URL.createObjectURL(existingMask);
      } else {
        setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [adapter, layer, existingMask, existingTexture, highDpiMask, embedded]);

  // ----- E.2: hydrate region canvases from persisted IDB blobs -----
  // Runs once `ready` flips and persistedRegions arrives. Each
  // region's PNG blob is decoded into a same-dim canvas stored in
  // regionCanvasMap; the entries metadata mirrors what's on disk.
  useEffect(() => {
    if (!ready) return;
    const source = sourceCanvasRef.current;
    if (!source) return;
    let cancelled = false;
    (async () => {
      const newMap = new Map<string, HTMLCanvasElement>();
      for (const r of persistedRegions) {
        const c = document.createElement("canvas");
        c.width = source.width;
        c.height = source.height;
        const cctx = c.getContext("2d");
        if (cctx) {
          try {
            const url = URL.createObjectURL(r.maskBlob);
            const img = await new Promise<HTMLImageElement>((resolve, reject) => {
              const i = new Image();
              i.onload = () => resolve(i);
              i.onerror = () => reject(new Error("image load failed"));
              i.src = url;
            });
            URL.revokeObjectURL(url);
            cctx.drawImage(img, 0, 0, c.width, c.height);
          } catch {
            // ignore — region keeps its empty canvas
          }
        }
        newMap.set(r.id, c);
      }
      if (cancelled) return;
      regionCanvasMap.current = newMap;
      setRegionEntries(persistedRegions.map((r) => ({ id: r.id, name: r.name, color: r.color })));
      // Default-select the first region on initial hydration only;
      // setSelectedRegionId via a functional update keeps this effect
      // free of `selectedRegionId` in its deps without dropping the
      // "don't override user's pick" guard.
      setSelectedRegionId((cur) => cur ?? persistedRegions[0]?.id ?? null);
      setSplitDirty(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, persistedRegions]);

  // ── Compositor lifecycle ──────────────────────────────────────────
  //
  // The compositor is created the first time the preview canvas
  // mounts. Subsequent renders flow through `compositor.setInputs +
  // invalidate()` which the compositor itself rAF-coalesces.
  //
  // Inputs are pushed via a single `pushInputs` helper kept stable
  // across renders so every callback below has one well-named door
  // into the renderer — avoids "did I forget to call invalidate?"
  // landmines.
  const pushInputs = useCallback((patch: Partial<CompositorInputs>) => {
    const c = compositorRef.current;
    if (!c) return;
    c.setInputs(patch);
    c.invalidate();
  }, []);

  /** Tell the compositor what the studio's current inputs are.
   *  Calls `setInputs` with a fresh snapshot (assembled from the
   *  refs / state below) and schedules a render. Used after any
   *  mutation that the compositor can't see (e.g. brush strokes
   *  writing into the mask canvas don't fire a React re-render). */
  const invalidatePreview = useCallback(
    (dirty?: { mask?: boolean; paint?: boolean; regions?: boolean; source?: boolean }) => {
      const c = compositorRef.current;
      if (!c) return;
      c.setInputs({
        source: sourceCanvasRef.current,
        mask: maskCanvasRef.current,
        paint: paintCanvasRef.current,
        regions: regionEntries
          .map((e) => {
            const canvas = regionCanvasMap.current.get(e.id);
            return canvas ? { id: e.id, color: e.color, canvas } : null;
          })
          .filter((r): r is { id: string; color: string; canvas: HTMLCanvasElement } => r !== null),
        studioMode,
        threshold,
        focusRegionId,
        selectedRegionId,
      });
      // Tell the compositor exactly which canvas's pixels changed
      // since last render, so it can skip uploading the others. When
      // the caller doesn't pass a hint we mark the active mode's
      // working canvas — safe default for "something inside the
      // canvas got mutated."
      const hint = dirty ?? defaultDirtyForMode(studioMode);
      if (hint.source) c.markDirty("source");
      if (hint.mask) c.markDirty("mask");
      if (hint.paint) c.markDirty("paint");
      if (hint.regions) c.markDirty("regions");
      c.invalidate();
    },
    [regionEntries, studioMode, threshold, focusRegionId, selectedRegionId],
  );

  // Set up the compositor + ResizeObserver for the preview canvas.
  // Resize the preview backing so it matches the layout dim *× DPR*
  // — the compositor handles up-scaling internally.
  //
  // NOTE: we no longer cache the canvas bounding rect. ResizeObserver
  // fires on *layout* changes, but the viewport zoom + pan applies a
  // CSS transform on the wrapper which doesn't change layout —
  // a cached rect goes stale during zoom/pan and pointer coords land
  // in the wrong place. Browsers cache getBoundingClientRect()
  // internally when no layout invalidation has happened (which is
  // the case during a brush stroke — only canvas content changes),
  // so calling it on every pointermove is essentially free.
  useEffect(() => {
    const preview = previewRef.current;
    if (!preview || !ready) return;
    if (!compositorRef.current) {
      compositorRef.current = createCompositor(preview);
    }
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const rect = entry.contentRect;
        // Resize the compositor's backing to the layout size × DPR
        // so the up-scaled trim composite stays sharp at deep zoom
        // without falling back to a blurry bilinear stretch.
        const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
        const density = fullscreen ? Math.max(2, dpr) : dpr;
        compositorRef.current?.resize(rect.width * density, rect.height * density);
        compositorRef.current?.invalidate();
      }
    });
    ro.observe(preview);
    return () => ro.disconnect();
  }, [ready, fullscreen]);

  // Push inputs into the compositor whenever React-tracked state
  // changes. Brush strokes don't go through here — they mutate the
  // mask/paint/region canvas in place and call invalidatePreview()
  // directly so the round-trip stays tight.
  useEffect(() => {
    if (!ready) return;
    invalidatePreview();
  }, [ready, invalidatePreview]);

  // Dispose the compositor on unmount.
  useEffect(() => {
    return () => {
      compositorRef.current?.dispose();
      compositorRef.current = null;
    };
  }, []);

  // Threshold changes → mark the compositor's threshold-mask cache
  // dirty so the next render re-bakes it. (The compositor batches the
  // bake on the rAF, not per slider tick — keeps drag-the-slider
  // responsive.)
  // biome-ignore lint/correctness/useExhaustiveDependencies: threshold is the only trigger; compositor + refs are stable
  useEffect(() => {
    compositorRef.current?.invalidateThreshold();
    compositorRef.current?.invalidate();
  }, [threshold]);

  // ----- dirty flag dispatch -----
  /** Set the right dirty flag based on the current studio mode.
   *  Defined before the paint / bucket / wand callbacks that use it
   *  to keep the dep arrays correct. */
  const markDirty = useCallback(() => {
    if (studioMode === "split") setSplitDirty(true);
    else if (studioMode === "paint") setPaintDirty(true);
    else setDirty(true);
  }, [studioMode]);

  // ── History stack (Photoshop-style undo / redo) ────────────────
  //
  // Tracks the mask + paint canvas across discrete user actions
  // (one stroke = one entry, regardless of dab count). Split mode
  // doesn't go through the stack yet — region canvases come and go,
  // which would need extra bookkeeping; mask + paint is what the
  // current panel scope covers.
  const history = useHistory();

  /** Snapshot whichever canvas the current studio mode would write
   *  into. Returns null in modes we don't track (split). The
   *  resulting map plugs straight into history.commit.
   *
   *  Snapshots use canvas-to-canvas drawImage instead of
   *  getImageData → ImageData. Reading pixels off the live canvas
   *  with getImageData triggers Chrome's willReadFrequently
   *  heuristic, which demotes the canvas from GPU-backed to CPU-
   *  backed storage after a handful of reads. That demotion is what
   *  caused the "edit gets laggy after a few strokes" symptom: brush
   *  stamps lose GPU acceleration AND the compositor's texImage2D
   *  becomes a CPU→GPU upload instead of a GPU-to-GPU blit. drawImage
   *  stays on the GPU end-to-end, so the live canvas keeps its
   *  accelerated backing no matter how many snapshots we take. */
  const captureModeChanges = useCallback((): Map<CanvasKey, HTMLCanvasElement> | null => {
    const changes = new Map<CanvasKey, HTMLCanvasElement>();
    if (studioMode === "mask" && maskCanvasRef.current) {
      changes.set("mask", cloneCanvas(maskCanvasRef.current));
      return changes;
    }
    if (studioMode === "paint" && paintCanvasRef.current) {
      changes.set("paint", cloneCanvas(paintCanvasRef.current));
      return changes;
    }
    return null;
  }, [studioMode]);

  /** Append a history entry labelled with the action's name. Called
   *  AFTER any canvas-modifying action completes. */
  const commitHistoryAction = useCallback(
    (label: string) => {
      const changes = captureModeChanges();
      if (!changes || changes.size === 0) return;
      history.commit(label, changes);
    },
    [captureModeChanges, history.commit],
  );

  /** Restore the canvases from a history snapshot map. Called from
   *  undo / redo / goto handlers. drawImage with composite="copy"
   *  fully replaces the target pixels (handles the opaque-to-
   *  transparent transition correctly without an explicit clear). */
  const applyHistorySnapshot = useCallback(
    (snapshots: ReadonlyMap<CanvasKey, HTMLCanvasElement> | null) => {
      if (!snapshots) return;
      for (const [key, snap] of snapshots) {
        let target: HTMLCanvasElement | null = null;
        if (key === "mask") target = maskCanvasRef.current;
        else if (key === "paint") target = paintCanvasRef.current;
        // region:* keys are reserved for split-mode history (not
        // wired yet; intentionally ignored if they ever appear).
        if (!target) continue;
        const ctx = target.getContext("2d");
        if (!ctx) continue;
        ctx.save();
        ctx.globalCompositeOperation = "copy";
        ctx.drawImage(snap, 0, 0, target.width, target.height);
        ctx.restore();
      }
      markDirty();
      invalidatePreview();
    },
    [invalidatePreview, markDirty],
  );

  const onUndo = useCallback(() => {
    applyHistorySnapshot(history.undo());
  }, [applyHistorySnapshot, history.undo]);

  const onRedo = useCallback(() => {
    applyHistorySnapshot(history.redo());
  }, [applyHistorySnapshot, history.redo]);

  const onHistoryGoto = useCallback(
    (index: number) => {
      applyHistorySnapshot(history.goto(index));
    },
    [applyHistorySnapshot, history.goto],
  );

  // Capture baseline whenever the editor (re)becomes ready: layer
  // load / HD-edge toggle / existingMask/Texture change all trigger
  // this. The pre-edit state is the natural anchor for "undo all
  // the way back to the open state". Canvas-to-canvas clones (no
  // getImageData) keep the live mask/paint canvases GPU-backed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: history.setBaseline is stable
  useEffect(() => {
    if (!ready) return;
    const baseline = new Map<CanvasKey, HTMLCanvasElement>();
    const mask = maskCanvasRef.current;
    if (mask) baseline.set("mask", cloneCanvas(mask));
    const paint = paintCanvasRef.current;
    if (paint) baseline.set("paint", cloneCanvas(paint));
    history.setBaseline(baseline);
  }, [ready]);

  // ----- target-canvas selector + brush stroke -----
  /** Pick the canvas the active tool's stroke / fill should land on.
   *    trim  → the single layer mask
   *    split → the focused region (solo) or the selected region
   *    paint → the working texture canvas
   *  Focus override is enforced for split mode so a stroke in solo
   *  can never bleed onto a different region's canvas. */
  const activeTargetCanvas = useCallback((): HTMLCanvasElement | null => {
    if (studioMode === "split") {
      const id = focusRegionId ?? selectedRegionId;
      return (id ? regionCanvasMap.current.get(id) : null) ?? null;
    }
    if (studioMode === "paint") return paintCanvasRef.current;
    return maskCanvasRef.current;
  }, [studioMode, selectedRegionId, focusRegionId]);

  // compositeForOp is hoisted to module scope (see bottom of file) so
  // React lint rules treat it as a stable, dep-free reference. The
  // alternative — declaring it inline — forces every paint callback
  // that uses it to include it in their dep array even though the
  // function never closes over component state.

  /**
   * Single brush dab at (sx, sy) in source-pixel space. Stroke
   * colour and composite mode depend on the studio mode:
   *
   *   trim / split  — strokes are opaque white into the mask, with
   *                   composite=source-over for "add" or
   *                   destination-out for "remove" (eraser).
   *   paint         — strokes use the foreground colour for "add"
   *                   (Brush) and destination-out (clear pixels to
   *                   transparent) for "remove" (Eraser). Bucket /
   *                   Wand-fill share the same path.
   *
   * Hardness % defines the inner solid radius as a fraction of the
   * brush radius. The remaining annulus blends to alpha 0 via a
   * radial gradient — same on both modes.
   */
  const applyBrushDab = useCallback(
    (target: HTMLCanvasElement, sx: number, sy: number, op: BrushOp) => {
      const tctx = target.getContext("2d");
      if (!tctx) return;
      const radius = Math.max(0.5, brushSize / 2);
      tctx.save();
      if (clipPathRef.current) tctx.clip(clipPathRef.current);
      tctx.globalCompositeOperation = compositeForOp(op);
      // Pick the dab colour. In paint mode "add" is the foreground
      // colour; the "remove" eraser uses destination-out so the
      // gradient just needs alpha-modulated white.
      const fillRGB =
        studioMode === "paint" && op === "add"
          ? hexToRgb(foregroundColor)
          : { r: 255, g: 255, b: 255 };
      if (brushHardness >= 100) {
        tctx.fillStyle = `rgba(${fillRGB.r}, ${fillRGB.g}, ${fillRGB.b}, 1)`;
      } else {
        const inner = radius * (brushHardness / 100);
        const grad = tctx.createRadialGradient(sx, sy, inner, sx, sy, radius);
        grad.addColorStop(0, `rgba(${fillRGB.r},${fillRGB.g},${fillRGB.b},1)`);
        grad.addColorStop(1, `rgba(${fillRGB.r},${fillRGB.g},${fillRGB.b},0)`);
        tctx.fillStyle = grad;
      }
      tctx.beginPath();
      tctx.arc(sx, sy, radius, 0, Math.PI * 2);
      tctx.fill();
      tctx.restore();
    },
    [brushSize, brushHardness, studioMode, foregroundColor],
  );

  // ── Pointer → source-pixel conversion (hot path) ─────────────────
  //
  // Reads getBoundingClientRect() directly every call. We tried
  // caching this via ResizeObserver, but RO only fires on *layout*
  // changes and the viewport zoom + pan uses a CSS transform on the
  // wrapper (no layout change) — so cached rects went stale during
  // zoom/pan and click coords landed in the wrong source pixel.
  // Modern browsers cache getBoundingClientRect() internally as long
  // as no layout invalidation has happened, which is the case during
  // a brush stroke (only canvas content changes), so direct calls
  // are essentially free here.
  const clientToSrc = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
    const preview = previewRef.current;
    const source = sourceCanvasRef.current;
    if (!preview || !source) return { x: 0, y: 0 };
    const rect = preview.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
    return {
      x: ((clientX - rect.left) / rect.width) * source.width,
      y: ((clientY - rect.top) / rect.height) * source.height,
    };
  }, []);

  // ── Stroke engine plumbing ───────────────────────────────────────
  //
  // The engine is created lazily on first stroke. setConfig before
  // every beginStroke pushes the latest brush params; mid-stroke
  // shortcut tweaks (e.g. `[` / `]`) only take effect on the next
  // stroke, matching Photoshop.
  const beginBrushStroke = useCallback(
    (clientX: number, clientY: number) => {
      const target = activeTargetCanvas();
      const source = sourceCanvasRef.current;
      if (!target || !source) return;
      if (!strokeEngineRef.current) strokeEngineRef.current = new StrokeEngine();
      // Coord + size scale between source-pixel space and the
      // target canvas. Mask may be 2× source (HD edge); paint and
      // region canvases stay at source dim. The brush engine works
      // in target-pixel coords so dabs land at the right scale on
      // an HD mask without doing the math in the engine.
      const scale = target.width / source.width || 1;
      const op = effectiveBrushOp();
      const colour =
        studioMode === "paint" && op === "add"
          ? hexToRgb(foregroundColor)
          : { r: 255, g: 255, b: 255 };
      // Clip path was built in source coords. Apply the matrix so
      // the strokeEngine's per-dab clip is in target coords too.
      const scaledClip = clipPathRef.current ? scalePath(clipPathRef.current, scale) : null;
      strokeEngineRef.current.setConfig({
        size: brushSize * scale,
        hardness: brushHardness,
        op,
        color: colour,
        pressureSize,
        pressureOpacity,
        spacing: 0.25,
      });
      strokeEngineRef.current.beginStroke(target, scaledClip);
      const src = clientToSrc(clientX, clientY);
      strokeEngineRef.current.addSample({ x: src.x * scale, y: src.y * scale, pressure: 0.5 });
      markDirty();
      invalidatePreview();
    },
    [
      activeTargetCanvas,
      brushHardness,
      brushSize,
      clientToSrc,
      effectiveBrushOp,
      foregroundColor,
      invalidatePreview,
      markDirty,
      pressureOpacity,
      pressureSize,
      studioMode,
    ],
  );

  /** Feed pointermove (or coalesced sub-events) into the stroke
   *  engine. The engine does all the per-sample work — interpolation,
   *  pressure, dab stamping — so this callback stays trivial. */
  const continueBrushStroke = useCallback(
    (ev: PointerEvent | React.PointerEvent<HTMLCanvasElement>) => {
      const engine = strokeEngineRef.current;
      if (!engine) return;
      // Engine works in target-pixel coords (see beginBrushStroke).
      // The scale was baked into the engine's config at stroke
      // start — we re-derive it here to convert each sample.
      const target = activeTargetCanvas();
      const source = sourceCanvasRef.current;
      if (!target || !source) return;
      const scale = target.width / source.width || 1;
      const src = clientToSrc(ev.clientX, ev.clientY);
      engine.addSample({
        x: src.x * scale,
        y: src.y * scale,
        pressure: ev.pressure || 0.5,
      });
    },
    [activeTargetCanvas, clientToSrc],
  );

  // ── Bucket fill (worker-backed) ─────────────────────────────────
  //
  // Same shape as the old bucketAt but the BFS runs off-thread now,
  // so a huge connected region click doesn't freeze the UI.
  const bucketAt = useCallback(
    async (clientX: number, clientY: number) => {
      const source = sourceCanvasRef.current;
      if (!source) return;
      const target = activeTargetCanvas();
      if (!target) return;
      const { x, y } = clientToSrc(clientX, clientY);
      const result = await runFlood({
        source,
        seedX: x,
        seedY: y,
        tolerance: bucketTolerance,
        sampleMode: "alpha",
        sampleSize: 1,
        contiguous: true,
        antiAlias: false,
        ownerKey: "bucket",
      });
      if (result.aborted || result.area === 0) return;
      const fillCanvas = workerMaskToCanvas(result);
      const tctx = target.getContext("2d");
      if (!tctx) return;
      // Scale the source-built fill canvas to whatever dim the target
      // is — handles the HD-edge case where target is 2× source.
      const source2 = sourceCanvasRef.current;
      const targetScale = source2 ? target.width / source2.width : 1;
      tctx.save();
      if (clipPathRef.current) tctx.clip(scalePath(clipPathRef.current, targetScale));
      const op = effectiveBrushOp("bucket");
      tctx.globalCompositeOperation = compositeForOp(op);
      const draw =
        studioMode === "paint" && op === "add"
          ? tintCanvas(fillCanvas, foregroundColor)
          : fillCanvas;
      tctx.drawImage(draw, 0, 0, target.width, target.height);
      tctx.restore();
      markDirty();
      invalidatePreview();
      commitHistoryAction(op === "add" ? "Bucket fill" : "Bucket erase");
    },
    [
      activeTargetCanvas,
      bucketTolerance,
      clientToSrc,
      commitHistoryAction,
      effectiveBrushOp,
      foregroundColor,
      invalidatePreview,
      markDirty,
      studioMode,
    ],
  );

  // ── Magic wand (worker-backed + full options) ───────────────────
  //
  // The wand was alpha-only single-pixel BFS. It's now a Photoshop-
  // grade selection tool with sample mode (alpha/luminance/RGB),
  // sample size, contiguous toggle, and anti-alias. The worker does
  // the BFS so big clicks no longer freeze the UI.
  const wandAt = useCallback(
    async (clientX: number, clientY: number, op: SelectionOp) => {
      const source = sourceCanvasRef.current;
      if (!source) return;
      const { x, y } = clientToSrc(clientX, clientY);
      const result = await runFlood({
        source,
        seedX: x,
        seedY: y,
        tolerance: wandOpts.tolerance,
        sampleMode: wandOpts.sampleMode,
        sampleSize: wandOpts.sampleSize,
        contiguous: wandOpts.contiguous,
        antiAlias: wandOpts.antiAlias,
        ownerKey: "wand",
      });
      if (result.aborted) return;
      if (result.area === 0 && op === "replace") {
        setWandSelection(null);
        setWandSelectionArea(0);
        return;
      }
      const incoming = workerMaskToCanvas(result);
      if (op === "replace" || !wandSelection) {
        setWandSelection(incoming);
        setWandSelectionArea(result.area);
        return;
      }
      // Compose into the existing selection.
      const merged = document.createElement("canvas");
      merged.width = source.width;
      merged.height = source.height;
      const mctx = merged.getContext("2d");
      if (!mctx) return;
      mctx.drawImage(wandSelection, 0, 0);
      composeSelection(
        merged,
        incoming,
        op === "add" ? "add" : op === "subtract" ? "subtract" : "intersect",
      );
      setWandSelection(merged);
      setWandSelectionArea(selectionArea(merged));
    },
    [
      clientToSrc,
      wandOpts.tolerance,
      wandOpts.sampleMode,
      wandOpts.sampleSize,
      wandOpts.contiguous,
      wandOpts.antiAlias,
      wandSelection,
    ],
  );

  /** Apply the wand selection to the active canvas with the given
   *  brush op. In paint mode "add" tints the selection with the
   *  foreground colour; trim / split keep it white-into-mask. */
  const applyWandSelection = useCallback(
    (op: BrushOp, clearAfter: boolean) => {
      if (!wandSelection) return;
      const target = activeTargetCanvas();
      if (!target) return;
      const tctx = target.getContext("2d");
      if (!tctx) return;
      // Same HD-edge scaling as bucket — selection bitmap was built
      // at source dim, target may be 2× when HD edge is on.
      const source = sourceCanvasRef.current;
      const scale = source ? target.width / source.width : 1;
      tctx.save();
      if (clipPathRef.current) tctx.clip(scalePath(clipPathRef.current, scale));
      tctx.globalCompositeOperation = compositeForOp(op);
      const draw =
        studioMode === "paint" && op === "add"
          ? tintCanvas(wandSelection, foregroundColor)
          : wandSelection;
      tctx.drawImage(draw, 0, 0, target.width, target.height);
      tctx.restore();
      if (clearAfter) {
        setWandSelection(null);
        setWandSelectionArea(0);
      }
      markDirty();
      invalidatePreview();
      commitHistoryAction(op === "add" ? "Selection apply" : "Selection erase");
    },
    [
      activeTargetCanvas,
      commitHistoryAction,
      invalidatePreview,
      studioMode,
      wandSelection,
      foregroundColor,
      markDirty,
    ],
  );

  // ── Selection refine ops (Photoshop "Refine Selection") ─────────
  const onSelectionInvert = useCallback(() => {
    const source = sourceCanvasRef.current;
    if (!wandSelection || !source) return;
    const inverted = invertSelection(wandSelection, source);
    setWandSelection(inverted);
    setWandSelectionArea(selectionArea(inverted));
  }, [wandSelection]);

  const onSelectionGrow = useCallback(() => {
    if (!wandSelection) return;
    const grown = growSelection(wandSelection, 1);
    setWandSelection(grown);
    setWandSelectionArea(selectionArea(grown));
  }, [wandSelection]);

  const onSelectionShrink = useCallback(() => {
    if (!wandSelection) return;
    const shrunk = shrinkSelection(wandSelection, 1);
    setWandSelection(shrunk);
    setWandSelectionArea(selectionArea(shrunk));
  }, [wandSelection]);

  const onSelectionFeather = useCallback(() => {
    if (!wandSelection) return;
    const feathered = featherSelection(wandSelection, 2);
    setWandSelection(feathered);
    // Feather doesn't change the binary count materially; the
    // readout was a px count of "selected" pixels and feathered
    // pixels are still selected, so we keep the existing area.
  }, [wandSelection]);

  /** Promote the current wand selection to a brand-new named region.
   *  Split mode only; the region gets the next colour in the palette
   *  and lands selected so the user can immediately keep painting
   *  into it. */
  const onSelectionSaveAsRegion = useCallback(() => {
    if (!wandSelection) return;
    const source = sourceCanvasRef.current;
    if (!source) return;
    const idx = regionEntries.length;
    const id = newId(ID_PREFIX.regionMask);
    const color = REGION_COLORS[idx % REGION_COLORS.length];
    const c = document.createElement("canvas");
    c.width = source.width;
    c.height = source.height;
    const cctx = c.getContext("2d");
    if (cctx) cctx.drawImage(wandSelection, 0, 0);
    regionCanvasMap.current.set(id, c);
    setRegionEntries((prev) => [...prev, { id, name: `region ${idx + 1}`, color }]);
    setSelectedRegionId(id);
    setSplitDirty(true);
    setWandSelection(null);
    setWandSelectionArea(0);
  }, [wandSelection, regionEntries.length]);

  /** Sprint 6.2: convert a pointer event in auto mode into a SAM
   *  point and append. Left button = foreground (label 1), anything
   *  else = background (label 0). The point lives in source-pixel
   *  coords so the SAM route can index the source bitmap directly. */
  const recordSamPoint = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const preview = previewRef.current;
    const source = sourceCanvasRef.current;
    if (!preview || !source) return;
    const rect = preview.getBoundingClientRect();
    // Source-pixel-space coords; preview backing may be 2× in
    // fullscreen but SAM works against the source bitmap.
    const x = Math.round(((e.clientX - rect.left) / rect.width) * source.width);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * source.height);
    const label: 0 | 1 = e.button === 0 ? 1 : 0;
    setSamPoints((prev) => [...prev, { x, y, label }]);
    // Discard any stale candidate set so the user re-runs compute
    // after adjusting the points — otherwise old thumbnails imply
    // a result that no longer matches the current point set.
    setSamCandidates(null);
  }, []);

  /** Tool-aware pointer dispatch. The selectedTool decides what the
   *  click does. Space-held overrides any tool to Hand for
   *  temporary panning, matching Photoshop. Right-click drag also
   *  pans (regardless of tool) — except in SAM mode where right-
   *  click adds a background point. */
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      // Right-click pan (button 2). Always pans except when SAM is
      // active — SAM uses right-click for background points and we
      // don't want to break that pre-existing workflow.
      const isRightClick = e.button === 2;
      if (isRightClick && selectedTool !== "sam") {
        e.preventDefault();
        (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
        viewport.onPanPointerDown(e.nativeEvent);
        return;
      }

      // Hand override (Space-drag pan).
      if (viewport.spaceHeld || selectedTool === "hand") {
        e.preventDefault();
        (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
        viewport.onPanPointerDown(e.nativeEvent);
        return;
      }

      switch (selectedTool) {
        case "move":
          // Move tool is a no-op on click; viewport gestures still
          // work via wheel + space.
          return;
        case "zoom": {
          // Click = zoom in around point; Alt+click = zoom out.
          const factor = e.altKey ? 1 / 1.5 : 1.5;
          viewport.zoomAtClient(factor, e.clientX, e.clientY);
          return;
        }
        case "eyedropper": {
          // Sample the pixel under the cursor + set as foreground.
          // Reads from the paint canvas in paint mode (so the user
          // can pick a colour they just laid down) and from the
          // source elsewhere.
          const preview = previewRef.current;
          const source = sourceCanvasRef.current;
          if (!preview || !source) return;
          const { x, y } = clientToSrc(e.clientX, e.clientY);
          const sample =
            studioMode === "paint" && paintCanvasRef.current
              ? samplePixelHex(paintCanvasRef.current, x, y)
              : samplePixelHex(source, x, y);
          if (sample) setForegroundColor(sample);
          return;
        }
        case "bucket":
          e.preventDefault();
          bucketAt(e.clientX, e.clientY);
          return;
        case "wand": {
          e.preventDefault();
          const op: SelectionOp =
            e.shiftKey && e.altKey
              ? "intersect"
              : e.shiftKey
                ? "add"
                : e.altKey
                  ? "subtract"
                  : "replace";
          wandAt(e.clientX, e.clientY, op);
          return;
        }
        case "sam":
          // Legacy SAM path — every click is a point.
          if (studioMode === "split") {
            e.preventDefault();
            recordSamPoint(e);
          }
          return;
        case "brush":
        case "eraser":
          paintingRef.current = true;
          (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
          beginBrushStroke(e.clientX, e.clientY);
          return;
      }
    },
    [
      beginBrushStroke,
      bucketAt,
      clientToSrc,
      recordSamPoint,
      selectedTool,
      studioMode,
      viewport.spaceHeld,
      viewport.zoomAtClient,
      viewport.onPanPointerDown,
      viewport,
      wandAt,
    ],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      // Track pointer in source-pixel space for the brush cursor +
      // status readouts. Cheap — no React state involved.
      const preview = previewRef.current;
      const source = sourceCanvasRef.current;
      if (preview && source) {
        const { x, y } = clientToSrc(e.clientX, e.clientY);
        pointerPosRef.current = { x, y };
      }
      // Hand-tool / Space drag.
      if (viewport.isPanning) {
        viewport.onPanPointerMove(e.nativeEvent);
        return;
      }
      if (!paintingRef.current) return;
      // Pull every coalesced sub-event the browser stashed since the
      // last move — at 120 Hz pen + 60 Hz frame this is the difference
      // between 60 dabs and 240 dabs along the same path. Feed each
      // into the stroke engine so stamp interpolation lays down a
      // continuous trail instead of a dotted skip.
      const coalesced =
        typeof e.nativeEvent.getCoalescedEvents === "function"
          ? (e.nativeEvent as PointerEvent).getCoalescedEvents()
          : [];
      if (coalesced.length === 0) {
        continueBrushStroke(e);
      } else {
        for (const sub of coalesced) continueBrushStroke(sub);
      }
      // One invalidate per pointermove tick — the compositor rAF-
      // batches multiple invalidates into a single render.
      invalidatePreview();
    },
    [
      clientToSrc,
      continueBrushStroke,
      invalidatePreview,
      viewport.isPanning,
      viewport.onPanPointerMove,
      viewport,
    ],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (viewport.isPanning) {
        viewport.onPanPointerUp(e.nativeEvent);
        (e.currentTarget as HTMLCanvasElement).releasePointerCapture?.(e.pointerId);
        return;
      }
      const wasPainting = paintingRef.current;
      if (wasPainting) {
        // End the stroke cleanly so the engine resets its
        // interpolation state for the next drag.
        strokeEngineRef.current?.endStroke();
      }
      paintingRef.current = false;
      (e.currentTarget as HTMLCanvasElement).releasePointerCapture?.(e.pointerId);
      // Commit one history entry per completed stroke. Labels match
      // the tool that drew so the History panel reads naturally.
      if (wasPainting && (selectedTool === "brush" || selectedTool === "eraser")) {
        commitHistoryAction(selectedTool === "eraser" ? "Eraser stroke" : "Brush stroke");
      }
    },
    [commitHistoryAction, selectedTool, viewport.isPanning, viewport.onPanPointerUp, viewport],
  );

  // ── Wheel routing ──────────────────────────────────────────────────
  //
  // Photoshop-style:
  //
  //   plain wheel       → zoom canvas around the cursor
  //   Ctrl/Cmd + wheel  → resize the active brush (brush + eraser only)
  //   Alt + wheel       → adjust brush hardness (brush + eraser only)
  //
  // The browser's default Ctrl+Wheel page-zoom shortcut would otherwise
  // hijack the same chord and nuke the editor layout, so we always
  // preventDefault inside the canvas wrapper. `{ passive: false }` is
  // required for preventDefault to take effect on wheel listeners in
  // modern browsers — React's synthetic onWheel can't promise it, hence
  // the manual addEventListener via this ref-effect.
  useEffect(() => {
    const wrapper = canvasWrapperRef.current;
    if (!wrapper) return;
    const handler = (e: WheelEvent) => {
      // Let scroll-y inputs (range sliders, etc.) inside the wrapper
      // keep their native wheel behaviour. None exist today but it's
      // a cheap guard.
      const target = e.target as HTMLElement | null;
      if (target && target.tagName === "INPUT") return;

      // Block every browser-level wheel shortcut inside the canvas —
      // Ctrl+Wheel for page zoom is the offender we actually care
      // about, but Alt+Wheel and friends are also fair game.
      e.preventDefault();
      e.stopPropagation();

      const mod = e.ctrlKey || e.metaKey;
      const isBrush = selectedTool === "brush" || selectedTool === "eraser";

      // Ctrl/Cmd + Wheel → brush size. Exponential factor matches the
      // viewport's zoom feel so muscle memory transfers; tiny brushes
      // get a 1-px-minimum step so int rounding can't stall the
      // shrink at single digits.
      if (mod && isBrush) {
        const factor = Math.exp(-e.deltaY * 0.0015);
        setBrushSize((s) => {
          const next = Math.round(s * factor);
          const stepped = next === s ? s + (e.deltaY > 0 ? -1 : 1) : next;
          return Math.max(1, Math.min(400, stepped));
        });
        return;
      }

      // Alt + Wheel → brush hardness, ±5 per tick. Linear because the
      // 0..100 range is short enough that exponential feels twitchy.
      if (e.altKey && isBrush) {
        const delta = e.deltaY > 0 ? -5 : 5;
        setBrushHardness((h) => Math.max(0, Math.min(100, h + delta)));
        return;
      }

      // Plain wheel → canvas zoom around the cursor. viewport.onWheel
      // also calls preventDefault internally; harmless duplicate.
      viewport.onWheel(e);
    };
    wrapper.addEventListener("wheel", handler, { passive: false });
    return () => wrapper.removeEventListener("wheel", handler);
  }, [viewport.onWheel, viewport, selectedTool]);

  // ----- save / clear / close -----
  const onSaveMask = useCallback(async () => {
    const mask = maskCanvasRef.current;
    const source = sourceCanvasRef.current;
    if (!mask || !source) return;

    // Downsample the mask back to source dim before baking — the
    // mask may be 2× source when HD edge is on. Downstream consumers
    // (Geny export bake, atlas-neighbor protection) expect source-
    // dim masks. The bilinear shrink preserves the AA edge HD mode
    // was buying us in the first place.
    const sourceDimMask =
      mask.width === source.width && mask.height === source.height
        ? mask
        : (() => {
            const tmp = document.createElement("canvas");
            tmp.width = source.width;
            tmp.height = source.height;
            const tctx = tmp.getContext("2d");
            if (tctx) {
              if ("imageSmoothingQuality" in tctx) tctx.imageSmoothingQuality = "high";
              tctx.drawImage(mask, 0, 0, source.width, source.height);
            }
            return tmp;
          })();

    // Bake the threshold cutoff into the saved mask so callers don't
    // have to know about the slider.
    const baked = document.createElement("canvas");
    baked.width = source.width;
    baked.height = source.height;
    const ctx = baked.getContext("2d");
    if (!ctx) return;

    const srcCtx = source.getContext("2d");
    const maskCtx = sourceDimMask.getContext("2d");
    if (!srcCtx || !maskCtx) return;
    const srcData = srcCtx.getImageData(0, 0, source.width, source.height);
    const maskData = maskCtx.getImageData(0, 0, source.width, source.height);
    const out = ctx.createImageData(baked.width, baked.height);
    // **Output convention split**:
    //   Standalone (hide-mask, store): RGB black + variable alpha.
    //     `setLayerOverrides` reads the alpha channel as "erase this
    //     pixel from the baked atlas".
    //   Embedded (inpaint-mask, AI provider): RGB white = regenerate,
    //     RGB black = preserve, alpha always 255. Standard FLUX/SDXL
    //     inpaint convention; the alpha-based output the standalone
    //     path produces would read as "all black = preserve" through a
    //     luma-aware inpainter and the model would skip the edit
    //     entirely.
    const inpaintConvention = !!onMaskCommit;
    for (let i = 0; i < srcData.data.length; i += 4) {
      const sa = srcData.data[i + 3];
      const ma = maskData.data[i + 3];
      // Only count as masked when there's actual source alpha to mask.
      // Otherwise threshold > 0 would also mark pixels outside the
      // layer's footprint (already alpha=0 after clipping) as masked,
      // and `setLayerMasks` would erase atlas neighbors.
      const thresholded = sa > 0 && sa < threshold ? 255 : 0;
      const effective = Math.max(thresholded, ma);
      if (inpaintConvention) {
        const v = effective >= 128 ? 255 : 0;
        out.data[i] = v;
        out.data[i + 1] = v;
        out.data[i + 2] = v;
        out.data[i + 3] = 255;
      } else {
        out.data[i] = 0;
        out.data[i + 1] = 0;
        out.data[i + 2] = 0;
        out.data[i + 3] = effective;
      }
    }
    ctx.putImageData(out, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) =>
      baked.toBlob((b) => resolve(b), "image/png"),
    );
    if (onMaskCommit) {
      // Embedded mode (GeneratePanel MASK tab) — route to caller's
      // inpaint-mask channel instead of the store. The two destinations
      // are distinct concepts (hide vs edit zone) and must not share
      // state. The blob above was already encoded in the inpaint
      // convention via `inpaintConvention` branch.
      onMaskCommit(blob);
    } else if (blob) {
      setMask(layer.id, blob);
    }
    if (onClose) onClose();
    else close(null);
  }, [close, layer.id, setMask, threshold, onMaskCommit, onClose]);

  // ----- E.2: split-mode actions -----
  const addRegion = useCallback(() => {
    const source = sourceCanvasRef.current;
    if (!source) return;
    const idx = regionEntries.length;
    const id = newId(ID_PREFIX.regionMask);
    const color = REGION_COLORS[idx % REGION_COLORS.length];
    const c = document.createElement("canvas");
    c.width = source.width;
    c.height = source.height;
    regionCanvasMap.current.set(id, c);
    setRegionEntries((prev) => [...prev, { id, name: "", color }]);
    setSelectedRegionId(id);
    setSplitDirty(true);
  }, [regionEntries.length]);

  const removeRegion = useCallback(
    (id: string) => {
      regionCanvasMap.current.delete(id);
      setRegionEntries((prev) => prev.filter((r) => r.id !== id));
      if (selectedRegionId === id) {
        setSelectedRegionId(null);
      }
      // Drop focus when its region disappears, otherwise the canvas
      // would render nothing in split mode.
      setFocusRegionId((cur) => (cur === id ? null : cur));
      setSplitDirty(true);
    },
    [selectedRegionId],
  );

  const renameRegion = useCallback((id: string, name: string) => {
    setRegionEntries((prev) => prev.map((r) => (r.id === id ? { ...r, name } : r)));
    setSplitDirty(true);
  }, []);

  /** Sprint 6.4: bootstrap regions from the layer's connected
   *  silhouette components. Runs `findAlphaComponents` on the
   *  upright source canvas — same detector GeneratePanel uses for
   *  multi-region auto-detect — and seeds one region entry per
   *  island. The user can then refine each with paint/erase/SAM.
   *
   *  When regions already exist we ask before clobbering: replace
   *  wipes the existing list (and their painted progress); add
   *  appends the components as new regions next to the existing
   *  ones. Cancel does nothing. */
  const autoDetectRegions = useCallback(
    (opts?: { silent?: boolean }) => {
      const source = sourceCanvasRef.current;
      if (!source) return;
      const detected = findAlphaComponents(source);
      if (detected.length === 0) {
        setSamError(null);
        // Soft signal — there's no SAM error here. Re-use the dirty
        // flag-free toast pattern with window.alert which is rare in
        // this codebase but acceptable for "nothing to do". The
        // auto-seed effect calls this with `silent` to skip the
        // popup when there's no component to detect (the empty
        // regions list itself is feedback enough).
        if (!opts?.silent && typeof window !== "undefined") {
          window.alert("이 레이어에서 silhouette 컴포넌트를 검출하지 못했습니다");
        }
        return;
      }
      let action: "replace" | "add" = "replace";
      if (regionEntries.length > 0 && typeof window !== "undefined") {
        const ok = window.confirm(
          `기존 region ${regionEntries.length}개를 자동 검출된 component ${detected.length}개로 교체하시겠습니까?\n` +
            `확인 = 교체 · 취소 = 기존 region 뒤에 추가`,
        );
        action = ok ? "replace" : "add";
      }
      if (action === "replace") {
        regionCanvasMap.current.clear();
      }
      const startIdx = action === "replace" ? 0 : regionEntries.length;
      const newEntries: { id: string; name: string; color: string }[] = [];
      detected.forEach((comp, i) => {
        const id = newId(ID_PREFIX.regionMask);
        const color = REGION_COLORS[(startIdx + i) % REGION_COLORS.length];
        // Seed each region's canvas with the component's binary mask
        // (white inside the component, transparent outside) at full
        // source dim — same shape as a paint stroke would build.
        const c = document.createElement("canvas");
        c.width = source.width;
        c.height = source.height;
        const cctx = c.getContext("2d");
        if (cctx) cctx.drawImage(comp.maskCanvas, 0, 0);
        regionCanvasMap.current.set(id, c);
        newEntries.push({
          id,
          name: detected.length === 1 ? "" : `region ${startIdx + i + 1}`,
          color,
        });
      });
      setRegionEntries((prev) => (action === "replace" ? newEntries : [...prev, ...newEntries]));
      setSelectedRegionId(newEntries[0]?.id ?? null);
      setSplitDirty(true);
    },
    [regionEntries.length],
  );

  /** Bulk delete every region. Confirms first because painted /
   *  SAM-applied content is unrecoverable. */
  const clearAllRegions = useCallback(() => {
    if (regionEntries.length === 0) return;
    if (typeof window !== "undefined") {
      const ok = window.confirm(
        `region ${regionEntries.length}개를 모두 삭제하시겠습니까? paint 한 stroke 와 SAM mask 가 모두 사라집니다.`,
      );
      if (!ok) return;
    }
    regionCanvasMap.current.clear();
    setRegionEntries([]);
    setSelectedRegionId(null);
    setFocusRegionId(null);
    setSplitDirty(true);
  }, [regionEntries.length]);

  /** First-entry auto-seed: when the user flips into split mode for
   *  the first time this panel session, AND no persisted regions
   *  hydrated, AND no manual region was added in trim mode by mistake
   *  — kick off `autoDetectRegions` once so the user lands on a
   *  populated state instead of an empty list. The user's earlier
   *  manual painting (if any) and any IDB-hydrated regions both
   *  short-circuit this. */
  useEffect(() => {
    if (!ready) return;
    if (studioMode !== "split") return;
    if (splitAutoSeededRef.current) return;
    if (regionEntries.length > 0) return;
    if (persistedRegions.length > 0) return;
    splitAutoSeededRef.current = true;
    autoDetectRegions({ silent: true });
  }, [ready, studioMode, regionEntries.length, persistedRegions.length, autoDetectRegions]);

  // ----- Sprint 6.2: SAM auto-mask actions -----

  /** Submit the current fg/bg point set to /api/ai/sam and stash the
   *  candidate masks for the user to pick from. The source bitmap is
   *  the layer's upright canvas, encoded as PNG — same source the
   *  brush is painting on, so click coords map 1:1 to mask coords. */
  const computeSamMasks = useCallback(async () => {
    const source = sourceCanvasRef.current;
    if (!source) return;
    if (samPoints.length === 0) return;
    if (!samPoints.some((p) => p.label === 1)) {
      setSamError("at least one foreground point (left-click) needed before compute");
      return;
    }
    setSamRunning(true);
    setSamError(null);
    setSamCandidates(null);
    try {
      const blob = await new Promise<Blob | null>((resolve) =>
        source.toBlob((b) => resolve(b), "image/png"),
      );
      if (!blob) {
        setSamError("failed to encode source canvas");
        return;
      }
      const result = await submitSam({ imageBlob: blob, points: samPoints });
      setSamCandidates(result.candidates);
    } catch (e) {
      setSamError(e instanceof Error ? e.message : String(e));
    } finally {
      setSamRunning(false);
    }
  }, [samPoints]);

  /** Apply one candidate mask to the currently-selected region's
   *  canvas using the active boolean op (Sprint 6.3). The candidate
   *  is a binary PNG at source dims:
   *    - add       → source-over (the candidate's opaque pixels
   *                  become part of the region)
   *    - intersect → destination-in (region keeps only pixels also
   *                  present in the candidate)
   *    - subtract  → destination-out (candidate's opaque pixels are
   *                  removed from the region)
   *  After apply, clear the point set + candidates so the user can
   *  start another cycle without leaving auto sub-mode. */
  const applySamCandidate = useCallback(
    async (candidate: SamCandidate) => {
      if (!selectedRegionId) return;
      const target = regionCanvasMap.current.get(selectedRegionId);
      if (!target) return;
      const url = URL.createObjectURL(candidate.maskBlob);
      try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const i = new Image();
          i.onload = () => resolve(i);
          i.onerror = () => reject(new Error("candidate image load failed"));
          i.src = url;
        });
        const tctx = target.getContext("2d");
        if (!tctx) return;
        tctx.save();
        if (clipPathRef.current) tctx.clip(clipPathRef.current);
        const operation: GlobalCompositeOperation =
          samComposeOp === "intersect"
            ? "destination-in"
            : samComposeOp === "subtract"
              ? "destination-out"
              : "source-over";
        tctx.globalCompositeOperation = operation;
        tctx.drawImage(img, 0, 0, target.width, target.height);
        tctx.restore();
        setSplitDirty(true);
        invalidatePreview();
      } catch (e) {
        setSamError(e instanceof Error ? e.message : String(e));
      } finally {
        URL.revokeObjectURL(url);
      }
      setSamPoints([]);
      setSamCandidates(null);
    },
    [selectedRegionId, invalidatePreview, samComposeOp],
  );

  /** Drop accumulated points + candidates without applying. Useful
   *  when the user wants to start over on a new spot. */
  const resetSamPoints = useCallback(() => {
    setSamPoints([]);
    setSamCandidates(null);
    setSamError(null);
  }, []);

  // Switching the brush sub-mode out of "auto" should clear the
  // pending click state — they're only meaningful while the user is
  // actively pointing at SAM targets. Likewise switching regions or
  // leaving split mode entirely.
  // biome-ignore lint/correctness/useExhaustiveDependencies: setters are stable
  useEffect(() => {
    if (mode !== "auto" || studioMode !== "split") {
      setSamPoints([]);
      setSamCandidates(null);
      setSamError(null);
      setSamRunning(false);
    }
  }, [mode, studioMode, selectedRegionId]);

  const onSaveSplit = useCallback(async () => {
    // Bake every region canvas to a binary PNG and persist together.
    const baked: RegionMaskEntry[] = [];
    for (const entry of regionEntries) {
      const c = regionCanvasMap.current.get(entry.id);
      if (!c) continue;
      const blob = await new Promise<Blob | null>((resolve) =>
        c.toBlob((b) => resolve(b), "image/png"),
      );
      if (!blob) continue;
      baked.push({
        id: entry.id,
        name: entry.name,
        color: entry.color,
        maskBlob: blob,
      });
    }
    if (baked.length === 0 && persistedRegions.length > 0) {
      // User wiped every region — clear the IDB row.
      await clearRegions();
    } else {
      await saveRegions(baked);
    }
    setSplitDirty(false);
    close(null);
  }, [regionEntries, persistedRegions.length, saveRegions, clearRegions, close]);

  /** Bake the paint canvas into a PNG and store as the layer
   *  texture override. Downstream features (Live2D / Spine
   *  rendering, Geny export bake) pick this up as the new "source"
   *  for the layer, so paint changes are visible everywhere the
   *  layer is rendered. */
  const onSavePaint = useCallback(async () => {
    const paint = paintCanvasRef.current;
    if (!paint) return;
    const blob = await new Promise<Blob | null>((resolve) =>
      paint.toBlob((b) => resolve(b), "image/png"),
    );
    if (blob) setLayerTextureOverride(layer.id, blob);
    setPaintDirty(false);
    close(null);
  }, [close, layer.id, setLayerTextureOverride]);

  const onSave = useCallback(async () => {
    if (studioMode === "split") await onSaveSplit();
    else if (studioMode === "paint") await onSavePaint();
    else await onSaveMask();
  }, [studioMode, onSaveSplit, onSavePaint, onSaveMask]);

  const onClear = useCallback(() => {
    if (studioMode === "split") {
      // Wipe the currently-selected region's canvas; if no region
      // selected, no-op so accidental clicks don't nuke regions.
      if (!selectedRegionId) return;
      const c = regionCanvasMap.current.get(selectedRegionId);
      if (!c) return;
      const cctx = c.getContext("2d");
      cctx?.clearRect(0, 0, c.width, c.height);
      setSplitDirty(true);
      invalidatePreview();
      return;
    }
    if (studioMode === "paint") {
      // Reset the paint canvas back to the source bitmap so the user
      // can start over without losing the underlying texture.
      const paint = paintCanvasRef.current;
      const source = sourceCanvasRef.current;
      if (!paint || !source) return;
      const pctx = paint.getContext("2d");
      if (!pctx) return;
      pctx.clearRect(0, 0, paint.width, paint.height);
      pctx.drawImage(source, 0, 0);
      setPaintDirty(true);
      invalidatePreview();
      commitHistoryAction("Reset paint");
      return;
    }
    const mask = maskCanvasRef.current;
    if (!mask) return;
    const ctx = mask.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, mask.width, mask.height);
    if (onMaskCommit) onMaskCommit(null);
    else setMask(layer.id, null);
    setDirty(true);
    invalidatePreview();
    commitHistoryAction("Clear mask");
  }, [
    commitHistoryAction,
    layer.id,
    setMask,
    invalidatePreview,
    studioMode,
    selectedRegionId,
    onMaskCommit,
  ]);

  /** Dismiss with a confirm prompt when there are unsaved changes.
   *  Used by every dismiss path: header "close" button, the
   *  fullscreen overlay backdrop, and the Esc shortcut. The user
   *  was previously losing painted strokes / region edits on a
   *  stray esc / outside click — the confirm makes the destructive
   *  intent explicit. Save & close is still one click away in the
   *  header for the non-discard path. */
  const requestClose = useCallback(() => {
    const isDirty =
      studioMode === "mask" ? dirty : studioMode === "split" ? splitDirty : paintDirty;
    if (!isDirty) {
      close(null);
      return;
    }
    if (typeof window === "undefined") {
      close(null);
      return;
    }
    const ok = window.confirm(
      "저장되지 않은 변경사항이 있습니다 — paint stroke, region, SAM mask 가 아직 저장되지 않았습니다.\n\n" +
        "확인 = 변경사항 버리고 닫기\n" +
        "취소 = 계속 편집 ('save & close' 로 저장 후 닫기)",
    );
    if (ok) close(null);
  }, [studioMode, dirty, splitDirty, paintDirty, close]);

  // ── Keyboard shortcuts (Photoshop-style) ──────────────────────────
  // Esc dismisses through requestClose. All other shortcuts go
  // through one handler so they share the input-focus guard.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      // Don't hijack typing inside an input / textarea / region name
      // field. The guard mirrors the global `useEditorShortcuts` hook.
      const target = ev.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
      }
      if (ev.key === "Escape") {
        // Esc cascades: clear wand selection → release region focus →
        // close studio. Each step is independent so the user can
        // mash Esc to "back out" through the editing state stack.
        if (wandSelection) {
          setWandSelection(null);
          setWandSelectionArea(0);
          return;
        }
        if (focusRegionId) {
          setFocusRegionId(null);
          return;
        }
        requestClose();
        return;
      }
      // Wand-selection refine + apply shortcuts. Active only when a
      // selection exists; otherwise the keys fall through to the
      // regular handler chain (e.g. Enter is harmless).
      if (wandSelection) {
        if (ev.key === "Enter") {
          ev.preventDefault();
          applyWandSelection(ev.shiftKey ? "remove" : "add", true);
          return;
        }
        if (ev.shiftKey && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
          const k = ev.key.toLowerCase();
          if (k === "i") {
            ev.preventDefault();
            onSelectionInvert();
            return;
          }
          if (k === "g") {
            ev.preventDefault();
            onSelectionGrow();
            return;
          }
          if (k === "s") {
            ev.preventDefault();
            onSelectionShrink();
            return;
          }
          if (k === "f") {
            ev.preventDefault();
            onSelectionFeather();
            return;
          }
          if (k === "r" && studioMode === "split") {
            ev.preventDefault();
            onSelectionSaveAsRegion();
            return;
          }
        }
      }
      // Tool shortcuts. Single-letter Photoshop bindings.
      if (!ev.metaKey && !ev.ctrlKey && !ev.altKey) {
        const tool = toolForShortcut(ev.key);
        if (tool) {
          // SAM is split-only.
          if (tool === "sam" && studioMode !== "split") return;
          ev.preventDefault();
          setSelectedTool(tool);
          return;
        }
        // Brush size: [ shrinks, ] grows. Roughly 10% steps with a
        // 1px floor so tiny brushes stay tweakable.
        if (ev.key === "[") {
          ev.preventDefault();
          setBrushSize((s) => Math.max(1, Math.round(s * 0.85)));
          return;
        }
        if (ev.key === "]") {
          ev.preventDefault();
          setBrushSize((s) => Math.min(400, Math.max(s + 1, Math.round(s * 1.15))));
          return;
        }
        // X is the universal swap key. In brush / eraser it flips to
        // the opposite tool (Photoshop B↔E pattern); for bucket it
        // still toggles the add/remove mode since bucket keeps that
        // toggle in its options bar.
        if (ev.key === "x" || ev.key === "X") {
          ev.preventDefault();
          if (selectedTool === "brush") setSelectedTool("eraser");
          else if (selectedTool === "eraser") setSelectedTool("brush");
          else setBrushOp((op) => (op === "add" ? "remove" : "add"));
          return;
        }
        // + / - zoom (without modifier — Photoshop also accepts
        // these without Ctrl).
        if (ev.key === "+" || ev.key === "=") {
          ev.preventDefault();
          viewport.zoomIn();
          return;
        }
        if (ev.key === "-" || ev.key === "_") {
          ev.preventDefault();
          viewport.zoomOut();
          return;
        }
      }
      // Cmd/Ctrl modifiers.
      if (ev.metaKey || ev.ctrlKey) {
        if (ev.key === "0") {
          ev.preventDefault();
          viewport.fit();
          return;
        }
        if (ev.key === "1") {
          ev.preventDefault();
          viewport.actualSize();
          return;
        }
        // Undo / Redo (Photoshop bindings: Ctrl+Z back, Ctrl+Shift+Z
        // forward). `z` may arrive as either case depending on shift
        // state — match toLowerCase for robustness.
        if (ev.key.toLowerCase() === "z") {
          ev.preventDefault();
          if (ev.shiftKey) onRedo();
          else onUndo();
          return;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    requestClose,
    selectedTool,
    studioMode,
    viewport,
    wandSelection,
    focusRegionId,
    applyWandSelection,
    onSelectionInvert,
    onSelectionGrow,
    onSelectionShrink,
    onSelectionFeather,
    onSelectionSaveAsRegion,
    onUndo,
    onRedo,
  ]);

  const previewStyle = useMemo<React.CSSProperties>(
    () => ({
      backgroundImage:
        "linear-gradient(45deg, #1a1d22 25%, transparent 25%), linear-gradient(-45deg, #1a1d22 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #1a1d22 75%), linear-gradient(-45deg, transparent 75%, #1a1d22 75%)",
      backgroundSize: "16px 16px",
      backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
      backgroundColor: "#0e1115",
    }),
    [],
  );

  // Embedded mode (GeneratePanel MASK tab) drops the modal chrome —
  // it lives inside another modal that already owns the dismiss
  // affordance. Standalone mode keeps the original fixed-inset
  // overlay + click-to-dismiss backdrop.
  //
  // The wrapper is built as JSX (NOT a component defined inside this
  // function). Defining `function Wrapper({children})` here would
  // give React a fresh component type on every render, which makes
  // every child — canvases, refs, effects — unmount + remount.
  // That ping-ponged through `setPreviewRef` → `setPreviewEl` →
  // re-render → unmount → mount → setState until React tripped its
  // "Maximum update depth exceeded" guard. JSX inline keeps the
  // DOM tree stable across renders.
  const inner = (
    <>
      <header className="flex shrink-0 items-center gap-3 border-b border-[var(--color-border)] px-4 py-2 text-xs">
        <span className="font-mono text-[var(--color-accent)]">
          {embedded ? "inpaint mask · v1" : "decompose · v1"}
        </span>
        <span className="text-[var(--color-fg-dim)]">{layer.name}</span>
        {embedded && (
          <span
            className="rounded border border-[var(--color-accent)]/40 px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-accent)]/80"
            title="이 탭에서 그리는 마스크는 fal.ai flux-inpainting 의 edit zone 입력으로 전송됩니다 (RGB white = AI 가 다시 그림, RGB black = 보존). Edit MASK 의 hide-mask 와 별개 채널."
          >
            edit zone
          </span>
        )}
        {(studioMode === "mask" ? dirty : studioMode === "split" ? splitDirty : paintDirty) && (
          <span className="text-yellow-400">· unsaved</span>
        )}
        {/* Focus chip — only visible in split mode while a region is
              soloed. Click to release focus from anywhere in the
              header. */}
        {studioMode === "split" && focusRegionId && (
          <button
            type="button"
            onClick={() => setFocusRegionId(null)}
            title="포커스 해제 — 모든 region 다시 표시 (Esc 도 가능)"
            className="ml-1 rounded border border-[var(--color-accent)] bg-[var(--color-accent)]/10 px-2 py-0.5 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/20"
          >
            ◉ Focus: {regionEntries.find((r) => r.id === focusRegionId)?.name || "region"} ✕
          </button>
        )}
        {/* Top mode toggle (E.2). Trim = single layer mask
              (existing); split = multi-region named masks for the
              GeneratePanel multi-region pipeline. Hidden in embedded
              mode (GeneratePanel MASK tab) — split/paint outputs
              wouldn't reach the inpaint state and would only confuse
              the user. */}
        {!embedded && (
          <div className="ml-3 flex gap-0.5">
            <button
              type="button"
              onClick={() => setStudioMode("mask")}
              className={`rounded-l border px-2 py-0.5 ${
                studioMode === "mask"
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
                  : "border-[var(--color-border)] text-[var(--color-fg-dim)]"
              }`}
              title="단일 마스크로 픽셀 숨기기 / 복원"
            >
              Mask
            </button>
            <button
              type="button"
              onClick={() => setStudioMode("split")}
              className={`border px-2 py-0.5 ${
                studioMode === "split"
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
                  : "border-[var(--color-border)] text-[var(--color-fg-dim)]"
              }`}
              title="여러 region 별 named 마스크 — GeneratePanel 이 사용"
            >
              Split
            </button>
            <button
              type="button"
              onClick={() => setStudioMode("paint")}
              className={`rounded-r border px-2 py-0.5 ${
                studioMode === "paint"
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
                  : "border-[var(--color-border)] text-[var(--color-fg-dim)]"
              }`}
              title="실제 텍스처 픽셀에 색을 칠하거나 지우기"
            >
              Paint
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={onClear}
          className="ml-auto rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
          title={studioMode === "split" ? "clear selected region" : "clear mask"}
        >
          {studioMode === "split" ? "clear region" : "clear mask"}
        </button>
        <button
          type="button"
          onClick={onSave}
          className="rounded border border-[var(--color-accent)] px-2 py-0.5 text-[var(--color-accent)]"
          title={embedded ? "save mask → return to GEN tab" : "save & close"}
        >
          {embedded ? "save → GEN" : "save & close"}
        </button>
        {/* Sprint 6.5: fullscreen toggle for big-canvas work. Hidden
              in embedded mode — the parent modal already controls
              size and there's no place to "expand" into. */}
        {!embedded && (
          <button
            type="button"
            onClick={() => setFullscreen((v) => !v)}
            className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
            title={fullscreen ? "shrink to modal" : "expand to fullscreen"}
          >
            {fullscreen ? "shrink" : "fullscreen"}
          </button>
        )}
        {/* Standalone has its own "close" button. Embedded skips it —
              the parent (GeneratePanel) header owns the close
              affordance via the GEN/MASK tab toggle. */}
        {!embedded && (
          <button
            type="button"
            onClick={requestClose}
            className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
            title="esc"
          >
            close
          </button>
        )}
      </header>

      {/* Body: left toolbox · top options bar · canvas · right
            sidebar (regions + SAM only). Photoshop-style layout. */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Toolbox
          selectedTool={selectedTool}
          onSelectTool={setSelectedTool}
          studioMode={studioMode}
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <OptionsBar
            selectedTool={selectedTool}
            studioMode={studioMode}
            brushSize={brushSize}
            onBrushSize={setBrushSize}
            brushOp={brushOp}
            onBrushOp={setBrushOp}
            brushHardness={brushHardness}
            onBrushHardness={setBrushHardness}
            tolerance={bucketTolerance}
            onTolerance={setBucketTolerance}
            wand={wandOpts}
            onWand={setWandOpts}
            pressureSize={pressureSize}
            pressureOpacity={pressureOpacity}
            onPressureSize={setPressureSize}
            onPressureOpacity={setPressureOpacity}
            highDpiMask={highDpiMask}
            onHighDpiMask={setHighDpiMask}
            threshold={threshold}
            onThreshold={setThreshold}
            zoom={viewport.zoom}
            onZoomIn={viewport.zoomIn}
            onZoomOut={viewport.zoomOut}
            onFit={viewport.fit}
            onActualSize={viewport.actualSize}
            foregroundColor={foregroundColor}
            onForegroundColor={setForegroundColor}
          />

          <div className="grid min-h-0 flex-1 grid-cols-[1fr_320px] overflow-hidden">
            <div
              ref={canvasWrapperRef}
              className="relative flex min-h-0 min-w-0 items-center justify-center overflow-hidden"
              style={previewStyle}
            >
              {error ? (
                <div className="text-sm text-red-400">{error}</div>
              ) : !ready ? (
                <div className="text-sm text-[var(--color-fg-dim)]">loading region…</div>
              ) : (
                // The aspect wrapper locks the rendered texture's
                // ratio (set from source dim). The transform
                // wrapper sits inside it and applies viewport
                // zoom/pan — keeping aspect on the outer node
                // means CSS still drives the fit-to-screen base
                // size, and zoom is purely multiplicative.
                <div
                  className="relative will-change-transform"
                  style={{
                    ...(sourceAspect
                      ? {
                          aspectRatio: `${sourceAspect}`,
                          height: "min(100%, 95vh)",
                          width: "auto",
                          maxWidth: "100%",
                        }
                      : undefined),
                    transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`,
                    transformOrigin: "center center",
                  }}
                >
                  <canvas
                    ref={setPreviewRef}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                    onContextMenu={(e) => {
                      // Always suppress the browser context menu —
                      // right-click on the canvas is reserved for
                      // panning (or SAM background points / Wand
                      // selection modifiers). The user can still
                      // right-click outside the canvas wrapper if
                      // they want the OS menu.
                      e.preventDefault();
                    }}
                    className={`block h-full w-full touch-none border border-[var(--color-border)] ${cursorClassForTool(selectedTool, viewport.spaceHeld, viewport.isPanning)}`}
                    style={
                      // Hide the OS cursor when a brush-like tool is
                      // active — the BrushCursor overlay replaces
                      // it. Other tools fall through to the class
                      // cursor (crosshair / grab / etc.).
                      isSizedBrushTool(selectedTool) && !viewport.spaceHeld
                        ? { cursor: "none" }
                        : undefined
                    }
                  />
                  {/* SAM point overlay (split/auto mode only). */}
                  {studioMode === "split" &&
                    mode === "auto" &&
                    samPoints.length > 0 &&
                    sourceCanvasRef.current && (
                      <svg
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 h-full w-full"
                        viewBox={`0 0 ${sourceCanvasRef.current.width} ${sourceCanvasRef.current.height}`}
                        preserveAspectRatio="none"
                      >
                        {samPoints.map((p, i) => (
                          <circle
                            // biome-ignore lint/suspicious/noArrayIndexKey: points are append-only and order-stable
                            key={i}
                            cx={p.x}
                            cy={p.y}
                            r={Math.max(4, (sourceCanvasRef.current?.width ?? 200) / 200)}
                            fill={p.label === 1 ? "#22c55e" : "#ef4444"}
                            stroke="#000"
                            strokeWidth={1}
                          />
                        ))}
                      </svg>
                    )}
                  {/* Marching-ants outline — animated boundary
                        contour of the current wand selection. Sits
                        inside the zoom/pan transform wrapper so
                        ants scale + translate with the canvas. */}
                  {wandSelection && sourceCanvasRef.current && (
                    <MarchingAnts
                      selection={wandSelection}
                      sourceWidth={sourceCanvasRef.current.width}
                      sourceHeight={sourceCanvasRef.current.height}
                    />
                  )}
                </div>
              )}
              {/* Brush cursor overlay — fixed-position circle that
                    follows the pointer. Sized to match the actual
                    stroke at the current zoom. Listeners attach
                    reliably because the canvas element is passed via
                    state (callback-ref pattern), not a stable ref. */}
              <BrushCursor
                canvas={previewEl}
                brushSize={brushSize}
                sourceWidth={sourceDim?.width ?? 0}
                enabled={isSizedBrushTool(selectedTool) && !viewport.spaceHeld}
              />
              {/* Floating wand action bar — visible whenever a
                    selection exists. Above the canvas so the user
                    doesn't have to glance at the sidebar for the
                    common Apply / Refine ops. */}
              {wandSelection && (
                <WandActionBar
                  area={wandSelectionArea}
                  studioMode={studioMode}
                  onApplyAdd={() => applyWandSelection("add", true)}
                  onApplyRemove={() => applyWandSelection("remove", true)}
                  onInvert={onSelectionInvert}
                  onGrow={onSelectionGrow}
                  onShrink={onSelectionShrink}
                  onFeather={onSelectionFeather}
                  onSaveAsRegion={studioMode === "split" ? onSelectionSaveAsRegion : undefined}
                  onDeselect={() => {
                    setWandSelection(null);
                    setWandSelectionArea(0);
                  }}
                />
              )}
            </div>

            <aside className="flex min-h-0 flex-col overflow-y-auto border-l border-[var(--color-border)] p-4 text-xs">
              {/* The wand selection's action bar lives above the
                    canvas now (see WandActionBar in the canvas
                    wrapper above) — no sidebar duplicate. */}
              {studioMode === "mask" ? (
                <>
                  <HistoryPanel
                    entries={history.entries}
                    pointer={history.pointer}
                    canUndo={history.canUndo}
                    canRedo={history.canRedo}
                    onGoto={onHistoryGoto}
                    onUndo={onUndo}
                    onRedo={onRedo}
                  />
                  {embedded ? <InpaintMaskHelp /> : <MaskHelp />}
                </>
              ) : studioMode === "paint" ? (
                <>
                  <HistoryPanel
                    entries={history.entries}
                    pointer={history.pointer}
                    canUndo={history.canUndo}
                    canRedo={history.canRedo}
                    onGoto={onHistoryGoto}
                    onUndo={onUndo}
                    onRedo={onRedo}
                  />
                  <PaintHelp />
                </>
              ) : (
                <>
                  {/* Split-mode sidebar (E.2). Region list with name
                    inputs + color swatch + delete; brush controls
                    below. The selected region receives strokes. */}
                  <div className="mb-3 flex items-center justify-between gap-1">
                    <div className="uppercase tracking-widest text-[var(--color-fg-dim)]">
                      regions ({regionEntries.length})
                    </div>
                    <div className="flex flex-wrap gap-1 justify-end">
                      {/* Sprint 6.4: seed regions from connected
                        silhouette components. Useful first step on
                        any multi-island layer — lets the user start
                        from auto-detect and refine instead of
                        painting from scratch. Auto-fires once on
                        first split-mode entry (no click needed). */}
                      <button
                        type="button"
                        onClick={() => autoDetectRegions()}
                        className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[var(--color-fg-dim)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                        title="re-detect regions from connected silhouettes"
                      >
                        auto-detect
                      </button>
                      <button
                        type="button"
                        onClick={addRegion}
                        className="rounded border border-[var(--color-accent)] px-1.5 py-0.5 text-[var(--color-accent)]"
                        title="add a new region"
                      >
                        + add
                      </button>
                      {regionEntries.length > 0 && (
                        <button
                          type="button"
                          onClick={clearAllRegions}
                          className="rounded border border-red-500/40 px-1.5 py-0.5 text-red-300 hover:bg-red-500/10"
                          title={`delete all ${regionEntries.length} region${regionEntries.length === 1 ? "" : "s"}`}
                        >
                          clear all
                        </button>
                      )}
                    </div>
                  </div>

                  {regionEntries.length === 0 ? (
                    <div className="mb-3 rounded border border-dashed border-[var(--color-border)] px-2 py-3 text-center text-[var(--color-fg-dim)]">
                      no regions yet — click{" "}
                      <span className="text-[var(--color-fg)]">auto-detect</span> to seed from
                      silhouette components, or{" "}
                      <span className="text-[var(--color-fg)]">+ add</span> to start from blank.
                    </div>
                  ) : (
                    <ul className="mb-3 flex flex-col gap-1.5">
                      {regionEntries.map((r) => {
                        const selected = r.id === selectedRegionId;
                        return (
                          <li key={r.id}>
                            {/* G/6.x: row was a <button> nesting another
                              <button> (the delete ✕) which is invalid
                              HTML and triggered a Next.js hydration
                              error. Restructured as a flex row of
                              siblings: a select-tile button, an
                              inline name input, and a delete button —
                              all coplanar so neither nests the other. */}
                            <div
                              className={`flex w-full items-stretch rounded border ${
                                selected ? "bg-[var(--color-accent)]/10" : "bg-transparent"
                              }`}
                              style={{ borderColor: r.color }}
                            >
                              <button
                                type="button"
                                onClick={() => setSelectedRegionId(r.id)}
                                title={selected ? "selected region" : "select this region"}
                                className="flex shrink-0 items-center gap-1.5 rounded-l px-1.5 hover:bg-[var(--color-accent)]/5"
                              >
                                <span
                                  className="h-3 w-3 shrink-0 rounded-sm"
                                  style={{ background: r.color }}
                                />
                                {selected && (
                                  <span className="text-[10px] text-[var(--color-accent)]">●</span>
                                )}
                              </button>
                              {/* Focus / solo toggle — when on, this
                                region renders alone on the canvas
                                AND brush strokes are locked to it. */}
                              <button
                                type="button"
                                onClick={() =>
                                  setFocusRegionId((cur) => (cur === r.id ? null : r.id))
                                }
                                title={
                                  focusRegionId === r.id
                                    ? "포커스 해제 — 모든 region 다시 표시"
                                    : "이 region 만 표시 + 편집 (다른 region 보호)"
                                }
                                className={`flex shrink-0 items-center justify-center px-1.5 text-[10px] ${
                                  focusRegionId === r.id
                                    ? "bg-[var(--color-accent)]/15 text-[var(--color-accent)]"
                                    : "text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
                                }`}
                              >
                                {focusRegionId === r.id ? "◉" : "○"}
                              </button>
                              <input
                                type="text"
                                value={r.name}
                                onChange={(e) => renameRegion(r.id, e.target.value)}
                                onFocus={() => setSelectedRegionId(r.id)}
                                placeholder="name (e.g. torso)"
                                className="min-w-0 flex-1 bg-transparent px-1 py-1 text-[11px] text-[var(--color-fg)] placeholder:text-[var(--color-fg-dim)] focus:outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  if (typeof window !== "undefined") {
                                    const ok = window.confirm(
                                      `region${r.name ? ` "${r.name}"` : ""} 을 삭제하시겠습니까? 이 region 의 paint stroke / SAM mask 가 사라집니다.`,
                                    );
                                    if (!ok) return;
                                  }
                                  removeRegion(r.id);
                                }}
                                className="flex shrink-0 items-center justify-center rounded-r px-2 text-[var(--color-fg-dim)] hover:bg-red-500/15 hover:text-red-300"
                                title={`delete region${r.name ? ` "${r.name}"` : ""}`}
                              >
                                ✕
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {/* Tool / brush size moved to the left Toolbox + top
                    OptionsBar respectively. The right sidebar in
                    split mode now focuses on region management +
                    SAM panel + the HOW guide. */}

                  {/* Sprint 6.2: SAM auto-mask panel. Visible while the
                    user is in auto sub-mode. Click points list, the
                    compute button, candidate thumbnails to apply. */}
                  {mode === "auto" && (
                    <div className="mb-3 rounded border border-[var(--color-border)] p-2">
                      <div className="mb-1 flex items-baseline justify-between text-[var(--color-fg)]">
                        <span>auto-mask · SAM</span>
                        <span className="text-[10px] text-[var(--color-fg-dim)]">
                          L = fg · R = bg
                        </span>
                      </div>
                      <div className="mb-2 text-[10px] text-[var(--color-fg-dim)]">
                        points: {samPoints.length} (fg{" "}
                        {samPoints.filter((p) => p.label === 1).length} / bg{" "}
                        {samPoints.filter((p) => p.label === 0).length})
                      </div>
                      {/* Sprint 6.3: composition mode for candidate
                        apply. add = union (default), intersect =
                        keep only overlap, subtract = remove. */}
                      <div className="mb-2 grid grid-cols-3 gap-1 text-[10px]">
                        {(["add", "intersect", "subtract"] as const).map((op) => (
                          <button
                            type="button"
                            key={op}
                            onClick={() => setSamComposeOp(op)}
                            title={
                              op === "add"
                                ? "candidate's opaque pixels join the region"
                                : op === "intersect"
                                  ? "region keeps only pixels also in the candidate"
                                  : "candidate's pixels are removed from the region"
                            }
                            className={`rounded border px-1.5 py-0.5 ${
                              samComposeOp === op
                                ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                                : "border-[var(--color-border)] text-[var(--color-fg-dim)]"
                            }`}
                          >
                            {op}
                          </button>
                        ))}
                      </div>
                      <div className="mb-2 flex gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            void computeSamMasks();
                          }}
                          disabled={
                            samRunning ||
                            samPoints.length === 0 ||
                            !samPoints.some((p) => p.label === 1)
                          }
                          className="flex-1 rounded border border-[var(--color-accent)] px-2 py-1 text-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {samRunning ? "computing…" : "compute mask"}
                        </button>
                        <button
                          type="button"
                          onClick={resetSamPoints}
                          disabled={samPoints.length === 0 && samCandidates === null}
                          className="rounded border border-[var(--color-border)] px-2 py-1 text-[var(--color-fg-dim)] disabled:cursor-not-allowed disabled:opacity-40 hover:text-[var(--color-fg)]"
                        >
                          reset
                        </button>
                      </div>
                      {samError && (
                        <div className="mb-2 rounded border border-red-500/30 bg-red-500/10 px-1.5 py-1 text-[10px] leading-relaxed text-red-300">
                          {samError}
                        </div>
                      )}
                      {samCandidates && samCandidates.length > 0 && (
                        <div className="grid grid-cols-3 gap-1.5">
                          {samCandidates.map((c, i) => (
                            <button
                              type="button"
                              // biome-ignore lint/suspicious/noArrayIndexKey: candidates array is order-stable per compute call
                              key={i}
                              onClick={() => {
                                void applySamCandidate(c);
                              }}
                              title="apply to selected region"
                              className="overflow-hidden rounded border border-[var(--color-border)] hover:border-[var(--color-accent)]"
                            >
                              {/* biome-ignore lint/performance/noImgElement: blob URL preview */}
                              <img
                                src={URL.createObjectURL(c.maskBlob)}
                                alt={`candidate ${i + 1}`}
                                className="block h-auto w-full"
                              />
                            </button>
                          ))}
                        </div>
                      )}
                      {samCandidates && samCandidates.length === 0 && (
                        <div className="text-[10px] text-[var(--color-fg-dim)]">
                          SAM returned no usable masks
                        </div>
                      )}
                    </div>
                  )}

                  <ShortcutsHelp />
                  <SplitHelp />
                </>
              )}
            </aside>
          </div>
        </div>
      </div>
    </>
  );

  return embedded ? (
    <div className="flex h-full min-h-0 w-full flex-col">{inner}</div>
  ) : (
    <div className="fixed inset-0 z-40 flex items-stretch bg-black/70 backdrop-blur-sm">
      <button
        type="button"
        aria-label="close"
        onClick={requestClose}
        className="absolute inset-0 cursor-default"
      />
      <div
        className={`relative z-10 m-auto flex flex-col border border-[var(--color-border)] bg-[var(--color-bg)] shadow-2xl ${
          fullscreen ? "h-screen w-screen rounded-none" : "h-[95vh] w-[min(96vw,1800px)] rounded"
        }`}
      >
        {inner}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Helpers + small render-only sub-components.
// ────────────────────────────────────────────────────────────────────

/** Map a Brush/Bucket op to the canvas composite operation. "add"
 *  paints opaque white into the mask; "remove" erases. Module-level
 *  so React's exhaustive-deps lint doesn't demand the inner callbacks
 *  thread it through their dep arrays. */
function compositeForOp(op: BrushOp): GlobalCompositeOperation {
  return op === "add" ? "source-over" : "destination-out";
}

/** Clone a canvas via drawImage. Used for history snapshots — the
 *  alternative (getImageData → ImageData) triggers Chrome's
 *  willReadFrequently demotion path, which then forces the live
 *  canvas off GPU acceleration. drawImage stays GPU-to-GPU. */
function cloneCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = source.width;
  out.height = source.height;
  const ctx = out.getContext("2d");
  if (ctx) ctx.drawImage(source, 0, 0);
  return out;
}

/** Map a studio mode to the canvas that "owns" pixel mutation in
 *  that mode. Used as the default dirty hint for invalidatePreview
 *  when a caller doesn't specify one — saves passing redundant
 *  `{ mask: true }` everywhere a mask-mode stroke ends. */
function defaultDirtyForMode(mode: StudioMode): {
  source?: boolean;
  mask?: boolean;
  paint?: boolean;
  regions?: boolean;
} {
  if (mode === "mask") return { mask: true };
  if (mode === "paint") return { paint: true };
  return { regions: true };
}

/** Return a Path2D that's the input path transformed by a uniform
 *  scale factor. Used to lift the source-coord clip path onto an HD
 *  mask target (mask may be 2× source dim). Path2D.addPath supports
 *  a DOMMatrixInit second argument on every browser the editor
 *  targets — falls through to a clone on the off chance it doesn't. */
function scalePath(path: Path2D, scale: number): Path2D {
  if (scale === 1) return path;
  const next = new Path2D();
  try {
    next.addPath(path, new DOMMatrix().scaleSelf(scale, scale));
    return next;
  } catch {
    return path;
  }
}

/** Parse "#rrggbb" or "rgb(...)" into an {r,g,b} triple. Falls back
 *  to white on a parse failure so paint strokes still produce a
 *  visible mark. */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  if (!hex) return { r: 255, g: 255, b: 255 };
  let h = hex.trim();
  if (h.startsWith("#")) h = h.slice(1);
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  if (h.length !== 6) return { r: 255, g: 255, b: 255 };
  const n = Number.parseInt(h, 16);
  if (!Number.isFinite(n)) return { r: 255, g: 255, b: 255 };
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

/** Recolour an opaque-white-on-transparent mask canvas with the
 *  given hex colour while preserving its alpha shape. Used by the
 *  paint-mode bucket / wand-fill so flood-fill output picks up the
 *  user's foreground colour. */
function tintCanvas(maskCanvas: HTMLCanvasElement, hex: string): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = maskCanvas.width;
  out.height = maskCanvas.height;
  const ctx = out.getContext("2d");
  if (!ctx) return maskCanvas;
  ctx.drawImage(maskCanvas, 0, 0);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = hex;
  ctx.fillRect(0, 0, out.width, out.height);
  return out;
}

/** Read the RGB at a source-pixel coordinate. Used by the
 *  Eyedropper tool to pick a colour off the current canvas. The
 *  source bitmap is whatever's "behind" the active stroke target —
 *  in paint mode that's the paintCanvas (the user's working
 *  texture), elsewhere it's the original layer source. */
function samplePixelHex(canvas: HTMLCanvasElement, sx: number, sy: number): string | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const x = Math.max(0, Math.min(canvas.width - 1, Math.floor(sx)));
  const y = Math.max(0, Math.min(canvas.height - 1, Math.floor(sy)));
  const data = ctx.getImageData(x, y, 1, 1).data;
  // Skip fully-transparent pixels — they'd resolve to "#000000"
  // which is a misleading sample.
  if (data[3] === 0) return null;
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(data[0])}${toHex(data[1])}${toHex(data[2])}`;
}

/** Whether the active tool wants the brush-size ring overlay. Only
 *  brush + eraser have a meaningful "size" to telegraph; bucket and
 *  wand are single-click tools whose effective radius is the
 *  click-pixel + tolerance/connectivity rules, not a brush size.
 *  Rendering a brush ring around them was a UX trap — the ring
 *  implied paint behaviour and obscured the actual cursor. */
function isSizedBrushTool(tool: ToolId): boolean {
  return tool === "brush" || tool === "eraser";
}

/** Tailwind class for the canvas's CSS cursor when the BrushCursor
 *  overlay is NOT rendered. For brush + eraser the inline style
 *  separately hides the OS cursor (cursor: none) and the overlay
 *  takes over; every other tool falls through to a meaningful OS
 *  cursor here. */
function cursorClassForTool(tool: ToolId, spaceHeld: boolean, isPanning: boolean): string {
  if (spaceHeld || tool === "hand") {
    return isPanning ? "cursor-grabbing" : "cursor-grab";
  }
  if (tool === "zoom") return "cursor-zoom-in";
  if (tool === "move") return "cursor-default";
  if (tool === "sam") return "cursor-crosshair";
  if (tool === "eyedropper") return "cursor-crosshair";
  if (tool === "bucket") return "cursor-crosshair";
  if (tool === "wand") return "cursor-crosshair";
  // brush / eraser — overlay handles the visual.
  return "cursor-crosshair";
}

/** Shortcut cheat-sheet — same in both studio modes since the
 *  Photoshop bindings work universally. Compact two-column grid. */
function ShortcutsHelp() {
  const rows: [string, string][] = [
    ["B / E", "Brush / Eraser"],
    ["G", "Bucket fill"],
    ["W", "Magic wand"],
    ["I", "Eyedropper"],
    ["Z / H", "Zoom / Hand"],
    ["[ / ]", "Brush size −/+"],
    ["Ctrl+Wheel", "Brush size (over canvas)"],
    ["Alt+Wheel", "Brush hardness (over canvas)"],
    ["Wheel", "Zoom canvas"],
    ["X", "Swap brush ↔ eraser / bucket mode"],
    ["Space", "Pan (hold)"],
    ["RMB-drag", "Pan (any tool)"],
    ["⌘0 / ⌘1", "Fit / 100%"],
    ["Esc", "Deselect / close"],
  ];
  return (
    <div className="mb-3 rounded border border-[var(--color-border)] p-2 text-[10px] leading-relaxed text-[var(--color-fg-dim)]">
      <div className="mb-1 uppercase tracking-widest text-[var(--color-fg)]">Shortcuts</div>
      <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <span className="font-mono text-[var(--color-accent)]">{k}</span>
            <span>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MaskHelp() {
  return (
    <div className="mt-auto leading-relaxed text-[var(--color-fg-dim)]">
      <div className="mb-1 uppercase tracking-widest">How (Mask)</div>
      <ul className="space-y-1 list-disc list-inside">
        <li>마스크가 칠해진 픽셀이 최종 출력에서 숨겨집니다</li>
        <li>
          <span className="text-[var(--color-fg)]">B</span> 브러시로 마스크 추가(픽셀 숨김),{" "}
          <span className="text-[var(--color-fg)]">E</span> 지우개로 마스크 제거(픽셀 복원).{" "}
          <span className="text-[var(--color-fg)]">X</span> 로 B ↔ E 빠른 전환
        </li>
        <li>
          <span className="text-[var(--color-fg)]">G</span> 버킷으로 연결된 영역 한 번에 채움
          (Hide/Reveal 모드 토글 가능)
        </li>
        <li>
          <span className="text-[var(--color-fg)]">W</span> 매직 셀렉터로 영역 선택 후 일괄 적용
        </li>
        <li>상단 Alpha 슬라이더로 feathered edge 제거</li>
        <li>save 시 마스크 + threshold 모두 PNG 로 baked</li>
      </ul>
    </div>
  );
}

/**
 * Embedded (GeneratePanel MASK tab) help panel. Inpaint convention,
 * not the hide convention — same brush UX, opposite meaning. The
 * MaskHelp text above stays unchanged for the standalone editor.
 */
function InpaintMaskHelp() {
  return (
    <div className="mt-auto leading-relaxed text-[var(--color-fg-dim)]">
      <div className="mb-1 uppercase tracking-widest">How (Inpaint Mask)</div>
      <ul className="space-y-1 list-disc list-inside">
        <li>
          마스크가 칠해진 영역만 AI 가 다시 그립니다 (white = regenerate). 칠하지 않은 영역은 원본
          그대로 보존.
        </li>
        <li>
          <span className="text-[var(--color-fg)]">B</span> 브러시 = edit zone 확장,{" "}
          <span className="text-[var(--color-fg)]">E</span> 지우개 = preserve 영역으로 되돌림.{" "}
          <span className="text-[var(--color-fg)]">X</span> 로 빠른 전환
        </li>
        <li>
          <span className="text-[var(--color-fg)]">G</span> 버킷 /{" "}
          <span className="text-[var(--color-fg)]">W</span> 매직 셀렉터로 컴포넌트 일부를 한 번에
          선택 → AI 재생성 영역으로 지정
        </li>
        <li>
          마스크가 비어 있으면 source 알파 전체를 자동 edit zone 으로 사용 (= 컴포넌트 전체 재생성)
        </li>
        <li>
          <span className="text-[var(--color-fg)]">save → GEN</span> 버튼: 마스크를 inpaint 채널
          (RGB white-on-black) 로 baked → GEN 탭으로 돌아옴
        </li>
        <li>Edit MASK 의 hide-mask 와 완전히 별개 — 상호 영향 없음</li>
      </ul>
    </div>
  );
}

function PaintHelp() {
  return (
    <div className="mt-auto leading-relaxed text-[var(--color-fg-dim)]">
      <div className="mb-1 uppercase tracking-widest">How (Paint)</div>
      <ul className="list-disc list-inside space-y-1">
        <li>실제 텍스처에 색을 칠합니다 — 마스크가 아니라 픽셀 자체를 변경</li>
        <li>
          <span className="text-[var(--color-fg)]">B</span> 브러시(전경색),{" "}
          <span className="text-[var(--color-fg)]">E</span> 지우개(투명),{" "}
          <span className="text-[var(--color-fg)]">G</span> 버킷,{" "}
          <span className="text-[var(--color-fg)]">W</span> 매직 셀렉터
        </li>
        <li>
          <span className="text-[var(--color-fg)]">I</span> 스포이드 — 클릭한 픽셀 색을 전경색으로
        </li>
        <li>
          상단 컬러 스와치 클릭 → 색상 선택. <span className="text-[var(--color-fg)]">X</span> 로
          paint ↔ erase 토글
        </li>
        <li>save 시 layer texture override 로 저장 — 모든 렌더 경로가 새 텍스처를 사용</li>
      </ul>
    </div>
  );
}

function SplitHelp() {
  return (
    <div className="mt-auto leading-relaxed text-[var(--color-fg-dim)]">
      <div className="mb-1 uppercase tracking-widest">How (Split)</div>
      <ul className="space-y-1 list-disc list-inside">
        <li>region 클릭 → 선택. 브러시 / 버킷 / 매직 wand 모두 선택된 region 에 작용</li>
        <li>
          <span className="text-[var(--color-fg)]">B</span> 추가,{" "}
          <span className="text-[var(--color-fg)]">E</span> 제거,{" "}
          <span className="text-[var(--color-fg)]">X</span> 로 모드 전환
        </li>
        <li>
          <span className="text-[var(--color-fg)]">S</span> = SAM (AI 자동 마스크) — 점 클릭 후
          compute
        </li>
        <li>save 시 region 마스크 IDB 에 저장 — Geny / GeneratePanel 이 사용</li>
      </ul>
    </div>
  );
}
