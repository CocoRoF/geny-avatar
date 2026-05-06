"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AvatarAdapter } from "@/lib/adapters/AvatarAdapter";
import { extractRegionCanvas } from "@/lib/avatar/regionExtract";
import type { Layer } from "@/lib/avatar/types";
import { useEditorStore } from "@/lib/store/editor";

type Props = {
  adapter: AvatarAdapter | null;
  layer: Layer;
};

type Mode = "paint" | "erase";

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
export function DecomposeStudio({ adapter, layer }: Props) {
  const close = useEditorStore((s) => s.setStudioLayer);
  const setMask = useEditorStore((s) => s.setLayerMask);
  const existingMask = useEditorStore((s) => s.layerMasks[layer.id] ?? null);

  const sourceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const paintingRef = useRef(false);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(0); // 0..255, 0 = no threshold mask
  const [brushSize, setBrushSize] = useState(20);
  const [mode, setMode] = useState<Mode>("paint");
  const [dirty, setDirty] = useState(false);

  // ----- load source + initial mask -----
  useEffect(() => {
    setReady(false);
    setError(null);
    setDirty(false);
    if (!adapter || !layer.texture) {
      setError("layer has no texture region");
      return;
    }
    const src = adapter.getTextureSource(layer.texture.textureId);
    if (!src) {
      setError("texture page bitmap not available on this adapter");
      return;
    }
    const sourceCanvas = extractRegionCanvas(
      src,
      layer.texture.rect,
      layer.texture.rotated ?? false,
    );
    if (!sourceCanvas) {
      setError("region rect is empty / unrenderable");
      return;
    }
    sourceCanvasRef.current = sourceCanvas;

    // mask canvas: 0 alpha = unmasked (visible), 255 alpha = masked
    const mask = document.createElement("canvas");
    mask.width = sourceCanvas.width;
    mask.height = sourceCanvas.height;
    maskCanvasRef.current = mask;

    if (existingMask) {
      // restore previous mask if any
      const img = new Image();
      img.onload = () => {
        const ctx = mask.getContext("2d");
        if (ctx) ctx.drawImage(img, 0, 0, mask.width, mask.height);
        setReady(true);
      };
      img.onerror = () => setReady(true);
      img.src = URL.createObjectURL(existingMask);
    } else {
      setReady(true);
    }
  }, [adapter, layer, existingMask]);

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

    // Compose: source × (1 - effectiveMask), where effectiveMask =
    // max(thresholdMask, paintedMask). We do it on imageData for accuracy.
    const srcCtx = source.getContext("2d");
    const maskCtx = mask.getContext("2d");
    if (!srcCtx || !maskCtx) return;
    const srcData = srcCtx.getImageData(0, 0, source.width, source.height);
    const maskData = maskCtx.getImageData(0, 0, mask.width, mask.height);

    for (let i = 0; i < srcData.data.length; i += 4) {
      const sa = srcData.data[i + 3];
      const ma = maskData.data[i + 3];
      // threshold cutoff: pixels below threshold treated as masked
      const thresholded = sa < threshold ? 255 : 0;
      const effective = Math.max(thresholded, ma);
      const out = (sa * (255 - effective)) / 255;
      srcData.data[i + 3] = out;
    }
    ctx.putImageData(srcData, 0, 0);
  }, [threshold]);

  useEffect(() => {
    if (!ready) return;
    redraw();
  }, [ready, redraw]);

  // ----- pointer painting -----
  const paintAt = useCallback(
    (clientX: number, clientY: number) => {
      const preview = previewRef.current;
      const mask = maskCanvasRef.current;
      if (!preview || !mask) return;
      const rect = preview.getBoundingClientRect();
      const sx = ((clientX - rect.left) / rect.width) * preview.width;
      const sy = ((clientY - rect.top) / rect.height) * preview.height;

      const maskCtx = mask.getContext("2d");
      if (!maskCtx) return;
      maskCtx.globalCompositeOperation = mode === "paint" ? "source-over" : "destination-out";
      maskCtx.fillStyle = "rgba(255, 80, 80, 1)";
      maskCtx.beginPath();
      maskCtx.arc(sx, sy, brushSize / 2, 0, Math.PI * 2);
      maskCtx.fill();
      maskCtx.globalCompositeOperation = "source-over";
      setDirty(true);
      redraw();
    },
    [mode, brushSize, redraw],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      paintingRef.current = true;
      (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
      paintAt(e.clientX, e.clientY);
    },
    [paintAt],
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
  const onSave = useCallback(async () => {
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
      const thresholded = sa < threshold ? 255 : 0;
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

  const onClear = useCallback(() => {
    const mask = maskCanvasRef.current;
    if (!mask) return;
    const ctx = mask.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, mask.width, mask.height);
    setMask(layer.id, null);
    setDirty(true);
    redraw();
  }, [layer.id, setMask, redraw]);

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
          {dirty && <span className="text-yellow-400">· unsaved</span>}
          <button
            type="button"
            onClick={onClear}
            className="ml-auto rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
          >
            clear mask
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
              <canvas
                ref={previewRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                className="max-h-full max-w-full cursor-crosshair touch-none border border-[var(--color-border)]"
              />
            )}
          </div>

          <aside className="flex min-h-0 flex-col border-l border-[var(--color-border)] p-4 text-xs">
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
              <div className="mb-1 uppercase tracking-widest text-[var(--color-fg-dim)]">brush</div>
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
          </aside>
        </div>
      </div>
    </div>
  );
}
