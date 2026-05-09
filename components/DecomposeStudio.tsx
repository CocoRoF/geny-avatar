"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AvatarAdapter } from "@/lib/adapters/AvatarAdapter";
import { submitSam } from "@/lib/ai/sam/client";
import type { SamCandidate, SamPoint } from "@/lib/ai/sam/types";
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
};

/**
 * Tool the brush canvas is currently using:
 *   - paint / erase: direct stroke into the selected canvas
 *   - auto: Sprint 6.2 SAM-driven mask. User accumulates click
 *           points (left = foreground, right = background), hits
 *           "compute mask" → /api/ai/sam returns 1–3 candidate
 *           masks → user picks one → it's union'd into the
 *           selected region's canvas. Available only inside
 *           "split" studio mode for now.
 */
type BrushMode = "paint" | "erase" | "auto";
/**
 * Top mode toggle:
 *   - "trim"  — classic single-mask paint/erase (existing behavior).
 *               Saves to `editorStore.layerMasks[layer.id]`.
 *   - "split" — Sprint E.2 multi-region painter. Each named region
 *               has its own binary mask; brush paints into the
 *               selected region. Saves to IDB (`regionMasks`).
 */
type StudioMode = "trim" | "split";

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
export function DecomposeStudio({ adapter, layer, puppetKey }: Props) {
  const close = useEditorStore((s) => s.setStudioLayer);
  const setMask = useEditorStore((s) => s.setLayerMask);
  const existingMask = useEditorStore((s) => s.layerMasks[layer.id] ?? null);
  const existingTexture = useEditorStore((s) => s.layerTextureOverrides[layer.id] ?? null);

  const sourceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  /** Path describing the layer's true footprint inside the bbox crop.
   *  When present, the brush is clipped to it so paint outside doesn't
   *  reach atlas neighbors that aren't part of this layer. */
  const clipPathRef = useRef<Path2D | null>(null);
  const paintingRef = useRef(false);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(0); // 0..255, 0 = no threshold mask
  const [brushSize, setBrushSize] = useState(20);
  const [mode, setMode] = useState<BrushMode>("paint");
  const [dirty, setDirty] = useState(false);

  // E.2: studio-level mode + multi-region state. Region canvases are
  // kept in a ref-keyed map alongside `regionEntries` (which holds
  // metadata: id, name, color). Painting in split mode writes into
  // the canvas for the currently-selected region; save bakes each
  // canvas to a PNG blob and persists the bundle to IDB.
  const [studioMode, setStudioMode] = useState<StudioMode>("trim");
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
    if (!adapter || !layer.texture) {
      setError("layer has no texture region");
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
        setError("region rect is empty / unrenderable");
        return;
      }
      sourceCanvasRef.current = extracted.canvas;
      clipPathRef.current = extracted.clip;

      // mask canvas: 0 alpha = unmasked (visible), 255 alpha = masked
      const mask = document.createElement("canvas");
      mask.width = extracted.canvas.width;
      mask.height = extracted.canvas.height;
      maskCanvasRef.current = mask;

      if (existingMask) {
        // restore previous mask if any
        const img = new Image();
        img.onload = () => {
          if (cancelled) return;
          const ctx = mask.getContext("2d");
          if (ctx) ctx.drawImage(img, 0, 0, mask.width, mask.height);
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
  }, [adapter, layer, existingMask, existingTexture]);

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

  // ----- redraw preview whenever something changes -----
  const redraw = useCallback(() => {
    const preview = previewRef.current;
    const source = sourceCanvasRef.current;
    const mask = maskCanvasRef.current;
    if (!preview || !source || !mask) return;
    if (preview.width !== source.width || preview.height !== source.height) {
      preview.width = source.width;
      preview.height = source.height;
    }
    const ctx = preview.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, preview.width, preview.height);

    if (studioMode === "split") {
      // Split mode: show source as-is, then overlay each region's
      // mask painted in its assigned color (semi-transparent so the
      // user can see what's underneath). The selected region gets a
      // stronger fill so it's clear which one a brush stroke will
      // land in.
      ctx.drawImage(source, 0, 0);
      for (const entry of regionEntries) {
        const rc = regionCanvasMap.current.get(entry.id);
        if (!rc) continue;
        ctx.save();
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = entry.id === selectedRegionId ? 0.55 : 0.3;
        // Tint the region's binary alpha mask with the region color.
        // Strategy: stamp a solid color rect, mask it with the region
        // canvas via destination-in, then composite onto preview.
        // We do this on a tmp canvas to keep preview's other layers
        // intact.
        const tmp = document.createElement("canvas");
        tmp.width = preview.width;
        tmp.height = preview.height;
        const tctx = tmp.getContext("2d");
        if (tctx) {
          tctx.fillStyle = entry.color;
          tctx.fillRect(0, 0, tmp.width, tmp.height);
          tctx.globalCompositeOperation = "destination-in";
          tctx.drawImage(rc, 0, 0);
          ctx.drawImage(tmp, 0, 0);
        }
        ctx.restore();
      }
      return;
    }

    // Trim mode (existing): source × (1 - effectiveMask), where
    // effectiveMask = max(thresholdMask, paintedMask).
    const srcCtx = source.getContext("2d");
    const maskCtx = mask.getContext("2d");
    if (!srcCtx || !maskCtx) return;
    const srcData = srcCtx.getImageData(0, 0, source.width, source.height);
    const maskData = maskCtx.getImageData(0, 0, mask.width, mask.height);

    for (let i = 0; i < srcData.data.length; i += 4) {
      const sa = srcData.data[i + 3];
      const ma = maskData.data[i + 3];
      // threshold cutoff: pixels below threshold treated as masked
      // Only count as masked when there's actual source alpha to mask.
      // Otherwise threshold > 0 would also mark pixels outside the
      // layer's footprint (already alpha=0 after clipping) as masked,
      // and `setLayerMasks` would erase atlas neighbors.
      const thresholded = sa > 0 && sa < threshold ? 255 : 0;
      const effective = Math.max(thresholded, ma);
      const out = (sa * (255 - effective)) / 255;
      srcData.data[i + 3] = out;
    }
    ctx.putImageData(srcData, 0, 0);
  }, [threshold, studioMode, regionEntries, selectedRegionId]);

  useEffect(() => {
    if (!ready) return;
    redraw();
  }, [ready, redraw]);

  // ----- pointer painting -----
  const paintAt = useCallback(
    (clientX: number, clientY: number) => {
      const preview = previewRef.current;
      if (!preview) return;
      const rect = preview.getBoundingClientRect();
      const sx = ((clientX - rect.left) / rect.width) * preview.width;
      const sy = ((clientY - rect.top) / rect.height) * preview.height;

      // Pick the target canvas: in split mode it's the selected region's
      // canvas; in trim mode it's the layer's single mask canvas.
      const target =
        studioMode === "split"
          ? ((selectedRegionId ? regionCanvasMap.current.get(selectedRegionId) : null) ?? null)
          : maskCanvasRef.current;
      if (!target) return;

      const tctx = target.getContext("2d");
      if (!tctx) return;
      tctx.save();
      // Clip to the layer's actual footprint so the brush can't paint
      // (or erase from) atlas neighbors that happen to fall in the bbox.
      if (clipPathRef.current) tctx.clip(clipPathRef.current);
      tctx.globalCompositeOperation = mode === "paint" ? "source-over" : "destination-out";
      tctx.fillStyle = "rgba(255, 255, 255, 1)";
      tctx.beginPath();
      tctx.arc(sx, sy, brushSize / 2, 0, Math.PI * 2);
      tctx.fill();
      tctx.restore();
      if (studioMode === "split") setSplitDirty(true);
      else setDirty(true);
      redraw();
    },
    [mode, brushSize, redraw, studioMode, selectedRegionId],
  );

  /** Sprint 6.2: convert a pointer event in auto mode into a SAM
   *  point and append. Left button = foreground (label 1), anything
   *  else = background (label 0). The point lives in source-pixel
   *  coords so the SAM route can index the source bitmap directly. */
  const recordSamPoint = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const preview = previewRef.current;
    if (!preview) return;
    const rect = preview.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * preview.width);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * preview.height);
    const label: 0 | 1 = e.button === 0 ? 1 : 0;
    setSamPoints((prev) => [...prev, { x, y, label }]);
    // Discard any stale candidate set so the user re-runs compute
    // after adjusting the points — otherwise old thumbnails imply
    // a result that no longer matches the current point set.
    setSamCandidates(null);
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      // In auto mode every click is a point — no drag-to-paint, no
      // pointer capture (so right-click context menu is suppressed
      // by the canvas's onContextMenu handler instead).
      if (studioMode === "split" && mode === "auto") {
        e.preventDefault();
        recordSamPoint(e);
        return;
      }
      paintingRef.current = true;
      (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
      paintAt(e.clientX, e.clientY);
    },
    [paintAt, recordSamPoint, studioMode, mode],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!paintingRef.current) return;
      paintAt(e.clientX, e.clientY);
    },
    [paintAt],
  );

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    paintingRef.current = false;
    (e.currentTarget as HTMLCanvasElement).releasePointerCapture?.(e.pointerId);
  }, []);

  // ----- save / clear / close -----
  const onSaveTrim = useCallback(async () => {
    const mask = maskCanvasRef.current;
    const source = sourceCanvasRef.current;
    if (!mask || !source) return;

    // Bake the threshold cutoff into the saved mask so callers don't
    // have to know about the slider.
    const baked = document.createElement("canvas");
    baked.width = mask.width;
    baked.height = mask.height;
    const ctx = baked.getContext("2d");
    if (!ctx) return;

    const srcCtx = source.getContext("2d");
    const maskCtx = mask.getContext("2d");
    if (!srcCtx || !maskCtx) return;
    const srcData = srcCtx.getImageData(0, 0, source.width, source.height);
    const maskData = maskCtx.getImageData(0, 0, mask.width, mask.height);
    const out = ctx.createImageData(baked.width, baked.height);
    for (let i = 0; i < srcData.data.length; i += 4) {
      const sa = srcData.data[i + 3];
      const ma = maskData.data[i + 3];
      // Only count as masked when there's actual source alpha to mask.
      // Otherwise threshold > 0 would also mark pixels outside the
      // layer's footprint (already alpha=0 after clipping) as masked,
      // and `setLayerMasks` would erase atlas neighbors.
      const thresholded = sa > 0 && sa < threshold ? 255 : 0;
      const effective = Math.max(thresholded, ma);
      out.data[i] = 0;
      out.data[i + 1] = 0;
      out.data[i + 2] = 0;
      out.data[i + 3] = effective;
    }
    ctx.putImageData(out, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) =>
      baked.toBlob((b) => resolve(b), "image/png"),
    );
    if (blob) setMask(layer.id, blob);
    close(null);
  }, [close, layer.id, setMask, threshold]);

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
      setSplitDirty(true);
    },
    [selectedRegionId],
  );

  const renameRegion = useCallback((id: string, name: string) => {
    setRegionEntries((prev) => prev.map((r) => (r.id === id ? { ...r, name } : r)));
    setSplitDirty(true);
  }, []);

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
   *  canvas via union (source-over). The candidate is a binary PNG
   *  at source dims; drawing it as-is over the region canvas adds
   *  any opaque pixels to the existing mask. After apply, clear the
   *  point set + candidates so the user can do another round of
   *  clicks for a separate area without leaving the auto sub-mode. */
  const applySamCandidate = useCallback(
    async (candidate: SamCandidate) => {
      if (!selectedRegionId) return;
      const target = regionCanvasMap.current.get(selectedRegionId);
      if (!target) return;
      // Decode the candidate blob into an image and draw it onto the
      // region canvas. SAM masks come back at source dims, so direct
      // drawImage at (0,0) is correct.
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
        tctx.globalCompositeOperation = "source-over";
        tctx.drawImage(img, 0, 0, target.width, target.height);
        tctx.restore();
        setSplitDirty(true);
        redraw();
      } catch (e) {
        setSamError(e instanceof Error ? e.message : String(e));
      } finally {
        URL.revokeObjectURL(url);
      }
      setSamPoints([]);
      setSamCandidates(null);
    },
    [selectedRegionId, redraw],
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

  const onSave = useCallback(async () => {
    if (studioMode === "split") await onSaveSplit();
    else await onSaveTrim();
  }, [studioMode, onSaveSplit, onSaveTrim]);

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
      redraw();
      return;
    }
    const mask = maskCanvasRef.current;
    if (!mask) return;
    const ctx = mask.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, mask.width, mask.height);
    setMask(layer.id, null);
    setDirty(true);
    redraw();
  }, [layer.id, setMask, redraw, studioMode, selectedRegionId]);

  // Esc to dismiss
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") close(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

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

  return (
    <div className="fixed inset-0 z-40 flex items-stretch bg-black/70 backdrop-blur-sm">
      <button
        type="button"
        aria-label="close"
        onClick={() => close(null)}
        className="absolute inset-0 cursor-default"
      />
      <div className="relative z-10 m-auto flex h-[90vh] w-[min(90vw,1100px)] flex-col rounded border border-[var(--color-border)] bg-[var(--color-bg)] shadow-2xl">
        <header className="flex shrink-0 items-center gap-3 border-b border-[var(--color-border)] px-4 py-2 text-xs">
          <span className="font-mono text-[var(--color-accent)]">decompose · v1</span>
          <span className="text-[var(--color-fg-dim)]">{layer.name}</span>
          {(studioMode === "trim" ? dirty : splitDirty) && (
            <span className="text-yellow-400">· unsaved</span>
          )}
          {/* Top mode toggle (E.2). Trim = single layer mask
              (existing); split = multi-region named masks for the
              GeneratePanel multi-region pipeline. */}
          <div className="ml-3 flex gap-0.5">
            <button
              type="button"
              onClick={() => setStudioMode("trim")}
              className={`rounded-l border px-2 py-0.5 ${
                studioMode === "trim"
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
                  : "border-[var(--color-border)] text-[var(--color-fg-dim)]"
              }`}
              title="single mask paint/erase (existing)"
            >
              trim
            </button>
            <button
              type="button"
              onClick={() => setStudioMode("split")}
              className={`rounded-r border px-2 py-0.5 ${
                studioMode === "split"
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
                  : "border-[var(--color-border)] text-[var(--color-fg-dim)]"
              }`}
              title="multi-region named masks (GeneratePanel uses these)"
            >
              split
            </button>
          </div>
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
          >
            save & close
          </button>
          <button
            type="button"
            onClick={() => close(null)}
            className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
            title="esc"
          >
            close
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[1fr_240px] overflow-hidden">
          <div
            className="flex min-h-0 min-w-0 items-center justify-center p-6"
            style={previewStyle}
          >
            {error ? (
              <div className="text-sm text-red-400">{error}</div>
            ) : !ready ? (
              <div className="text-sm text-[var(--color-fg-dim)]">loading region…</div>
            ) : (
              <div className="relative inline-flex max-h-full max-w-full">
                <canvas
                  ref={previewRef}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                  // Right-click in auto mode adds a background point —
                  // suppress the browser context menu so the click
                  // event bubbles cleanly to onPointerDown.
                  onContextMenu={(e) => {
                    if (studioMode === "split" && mode === "auto") e.preventDefault();
                  }}
                  className="max-h-full max-w-full cursor-crosshair touch-none border border-[var(--color-border)]"
                />
                {/* Sprint 6.2: SAM point overlay. Visible only in
                    split/auto mode while points are being collected.
                    Coordinates live in source pixel space; the SVG
                    viewBox lines them up with the canvas regardless
                    of CSS scale. */}
                {studioMode === "split" &&
                  mode === "auto" &&
                  samPoints.length > 0 &&
                  previewRef.current && (
                    <svg
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 h-full w-full"
                      viewBox={`0 0 ${previewRef.current.width} ${previewRef.current.height}`}
                      preserveAspectRatio="none"
                    >
                      {samPoints.map((p, i) => (
                        <circle
                          // biome-ignore lint/suspicious/noArrayIndexKey: points are append-only and order-stable
                          key={i}
                          cx={p.x}
                          cy={p.y}
                          r={Math.max(4, (previewRef.current?.width ?? 200) / 200)}
                          fill={p.label === 1 ? "#22c55e" : "#ef4444"}
                          stroke="#000"
                          strokeWidth={1}
                        />
                      ))}
                    </svg>
                  )}
              </div>
            )}
          </div>

          <aside className="flex min-h-0 flex-col overflow-y-auto border-l border-[var(--color-border)] p-4 text-xs">
            {studioMode === "trim" ? (
              <>
                <div className="mb-4">
                  <div className="mb-1 uppercase tracking-widest text-[var(--color-fg-dim)]">
                    alpha threshold
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={255}
                    value={threshold}
                    onChange={(e) => setThreshold(Number(e.target.value))}
                    className="w-full"
                  />
                  <div className="font-mono text-[var(--color-fg-dim)]">{threshold} / 255</div>
                  <p className="mt-1 leading-relaxed text-[var(--color-fg-dim)]">
                    pixels with alpha below this value are treated as masked. raise to wipe out
                    feathered atlas edges.
                  </p>
                </div>

                <div className="mb-4">
                  <div className="mb-1 uppercase tracking-widest text-[var(--color-fg-dim)]">
                    brush
                  </div>
                  <div className="mb-2 flex gap-1">
                    <button
                      type="button"
                      onClick={() => setMode("paint")}
                      className={`flex-1 rounded border px-2 py-1 ${
                        mode === "paint"
                          ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                          : "border-[var(--color-border)] text-[var(--color-fg-dim)]"
                      }`}
                    >
                      paint
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode("erase")}
                      className={`flex-1 rounded border px-2 py-1 ${
                        mode === "erase"
                          ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                          : "border-[var(--color-border)] text-[var(--color-fg-dim)]"
                      }`}
                    >
                      erase
                    </button>
                  </div>
                  <input
                    type="range"
                    min={2}
                    max={200}
                    value={brushSize}
                    onChange={(e) => setBrushSize(Number(e.target.value))}
                    className="w-full"
                  />
                  <div className="font-mono text-[var(--color-fg-dim)]">{brushSize}px</div>
                </div>

                <div className="mt-auto leading-relaxed text-[var(--color-fg-dim)]">
                  <div className="mb-1 uppercase tracking-widest">how</div>
                  <ul className="space-y-1 list-disc list-inside">
                    <li>drag to paint a mask area</li>
                    <li>switch to erase to undo brush strokes</li>
                    <li>save bakes mask + threshold into a single PNG</li>
                    <li>esc dismisses without saving</li>
                  </ul>
                </div>
              </>
            ) : (
              <>
                {/* Split-mode sidebar (E.2). Region list with name
                    inputs + color swatch + delete; brush controls
                    below. The selected region receives strokes. */}
                <div className="mb-3 flex items-center justify-between">
                  <div className="uppercase tracking-widest text-[var(--color-fg-dim)]">
                    regions ({regionEntries.length})
                  </div>
                  <button
                    type="button"
                    onClick={addRegion}
                    className="rounded border border-[var(--color-accent)] px-1.5 py-0.5 text-[var(--color-accent)]"
                    title="add a new region"
                  >
                    + add
                  </button>
                </div>

                {regionEntries.length === 0 ? (
                  <div className="mb-3 rounded border border-dashed border-[var(--color-border)] px-2 py-3 text-center text-[var(--color-fg-dim)]">
                    no regions yet — click "+ add" to create one, then paint where it lives on the
                    canvas.
                  </div>
                ) : (
                  <ul className="mb-3 flex flex-col gap-1.5">
                    {regionEntries.map((r) => {
                      const selected = r.id === selectedRegionId;
                      return (
                        <li key={r.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedRegionId(r.id)}
                            className={`flex w-full items-center gap-1.5 rounded border px-1.5 py-1 ${
                              selected ? "bg-[var(--color-accent)]/10" : "bg-transparent"
                            }`}
                            style={{ borderColor: r.color }}
                          >
                            <span
                              className="h-3 w-3 shrink-0 rounded-sm"
                              style={{ background: r.color }}
                            />
                            <input
                              type="text"
                              value={r.name}
                              onChange={(e) => renameRegion(r.id, e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              placeholder="name (e.g. torso)"
                              className="min-w-0 flex-1 bg-transparent text-[11px] text-[var(--color-fg)] placeholder:text-[var(--color-fg-dim)] focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeRegion(r.id);
                              }}
                              className="text-[var(--color-fg-dim)] hover:text-red-400"
                              title="delete region"
                            >
                              ✕
                            </button>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}

                <div className="mb-3">
                  <div className="mb-1 uppercase tracking-widest text-[var(--color-fg-dim)]">
                    tool
                  </div>
                  <div className="mb-2 grid grid-cols-3 gap-1">
                    <button
                      type="button"
                      onClick={() => setMode("paint")}
                      className={`rounded border px-2 py-1 ${
                        mode === "paint"
                          ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                          : "border-[var(--color-border)] text-[var(--color-fg-dim)]"
                      }`}
                    >
                      paint
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode("erase")}
                      className={`rounded border px-2 py-1 ${
                        mode === "erase"
                          ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                          : "border-[var(--color-border)] text-[var(--color-fg-dim)]"
                      }`}
                    >
                      erase
                    </button>
                    {/* Sprint 6.2: SAM-driven mask. Disabled when no
                        region is selected (the candidate has nowhere
                        to land). */}
                    <button
                      type="button"
                      onClick={() => setMode("auto")}
                      disabled={!selectedRegionId}
                      title={
                        selectedRegionId
                          ? "click foreground / right-click background, then compute"
                          : "select a region first"
                      }
                      className={`rounded border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40 ${
                        mode === "auto"
                          ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                          : "border-[var(--color-border)] text-[var(--color-fg-dim)]"
                      }`}
                    >
                      auto
                    </button>
                  </div>
                  {mode !== "auto" && (
                    <>
                      <input
                        type="range"
                        min={2}
                        max={200}
                        value={brushSize}
                        onChange={(e) => setBrushSize(Number(e.target.value))}
                        className="w-full"
                      />
                      <div className="font-mono text-[var(--color-fg-dim)]">{brushSize}px</div>
                    </>
                  )}
                </div>

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
                      points: {samPoints.length} (fg {samPoints.filter((p) => p.label === 1).length}{" "}
                      / bg {samPoints.filter((p) => p.label === 0).length})
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

                <div className="mt-auto leading-relaxed text-[var(--color-fg-dim)]">
                  <div className="mb-1 uppercase tracking-widest">how</div>
                  <ul className="space-y-1 list-disc list-inside">
                    <li>"+ add" to create a region, name it</li>
                    <li>click a region to select; brush strokes go into it</li>
                    <li>paint / erase + brush size apply to the selected region</li>
                    <li>
                      <span className="text-[var(--color-fg)]">auto</span>: left-click foreground /
                      right-click background, then compute → pick a candidate
                    </li>
                    <li>save persists the region masks to IDB — GeneratePanel uses these</li>
                  </ul>
                </div>
              </>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
