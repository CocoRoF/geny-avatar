"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Generate-flow mask editor.
 *
 * This is a SEPARATE concept from DecomposeStudio's mask. The two
 * collide if you let them share state:
 *
 *   - DecomposeStudio mask: destination-out HIDE tool. `alpha=255`
 *     means "erase this pixel from the final baked atlas".
 *   - Generate inpaint mask: edit-region selector. White (or
 *     `alpha=255`) means "regenerate THIS region with the prompt".
 *
 * They live in different tabs, in different stores, with different
 * brush semantics. Don't try to bridge them.
 *
 * Defaults: the entire component (every opaque pixel in the source)
 * is the edit zone. Useful when the user just wants to recolour /
 * restyle the whole layer. Painting subtracts from that — drag with
 * the eraser to PRESERVE pixels the AI shouldn't touch; drag with the
 * brush to expand the edit zone (e.g. paint into the transparent
 * outline area when the model should overwrite it).
 *
 * Output: a binary PNG blob in standard FLUX/SDXL inpainting
 * convention — RGB white = edit, RGB black = preserve, alpha always
 * 255. The blob is rebuilt and surfaced via `onChange` after every
 * stroke ends.
 */
export type GenerateMaskEditorProps = {
  /** Layer source canvas — drawn as the visual reference behind the
   *  mask. Mask dims always match the source. */
  sourceCanvas: HTMLCanvasElement | null;
  /** Current mask blob from the parent. Passing null resets to
   *  "entire source = edit zone" on mount. */
  value: Blob | null;
  /** Fires after every committed stroke (pointer up) with the latest
   *  mask blob. The parent persists it; this component does not. */
  onChange: (blob: Blob | null) => void;
};

type Tool = "paint" | "erase";

const DEFAULT_BRUSH_PX = 24;
const MIN_BRUSH_PX = 2;
const MAX_BRUSH_PX = 160;

export function GenerateMaskEditor({ sourceCanvas, value, onChange }: GenerateMaskEditorProps) {
  /** Display canvas the user looks at. Source under, mask overlay on top. */
  const displayRef = useRef<HTMLCanvasElement | null>(null);
  /** Off-screen full-resolution mask canvas — RGB white = edit, RGB black
   *  = preserve. Single source of truth for the mask state. */
  const maskRef = useRef<HTMLCanvasElement | null>(null);

  const [tool, setTool] = useState<Tool>("paint");
  const [brushPx, setBrushPx] = useState<number>(DEFAULT_BRUSH_PX);
  /** Force redraw counter — bumped after stroke commits to refresh
   *  the display canvas without recreating refs. */
  const [renderTick, setRenderTick] = useState(0);

  /** Allocate / sync the offscreen mask canvas whenever the source
   *  changes. Initial fill = whole source silhouette = edit zone. */
  useEffect(() => {
    if (!sourceCanvas) return;
    const w = sourceCanvas.width;
    const h = sourceCanvas.height;
    if (w <= 0 || h <= 0) return;

    const mask = document.createElement("canvas");
    mask.width = w;
    mask.height = h;
    const mctx = mask.getContext("2d", { willReadFrequently: true });
    if (!mctx) return;

    if (value) {
      // Caller passed an existing mask blob — load it.
      const img = new Image();
      img.onload = () => {
        mctx.drawImage(img, 0, 0, w, h);
        maskRef.current = mask;
        setRenderTick((t) => t + 1);
      };
      img.onerror = () => {
        // Fall back to alpha-derive on load failure.
        seedFromSourceAlpha(mctx, sourceCanvas);
        maskRef.current = mask;
        setRenderTick((t) => t + 1);
      };
      img.src = URL.createObjectURL(value);
    } else {
      seedFromSourceAlpha(mctx, sourceCanvas);
      maskRef.current = mask;
      setRenderTick((t) => t + 1);
    }
    // Source / value identity drives this effect; brush state shouldn't.
  }, [sourceCanvas, value]);

  /** Paint a brush dab into the offscreen mask canvas. RGB-encoded:
   *  paint = white(255), erase = black(0). Alpha always 255. */
  const drawDab = useCallback(
    (x: number, y: number) => {
      const mask = maskRef.current;
      if (!mask) return;
      const ctx = mask.getContext("2d");
      if (!ctx) return;
      const colour = tool === "paint" ? "rgba(255,255,255,1)" : "rgba(0,0,0,1)";
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.arc(x, y, brushPx / 2, 0, Math.PI * 2);
      ctx.fill();
    },
    [tool, brushPx],
  );

  /** Connect a stroke segment so fast drags don't leave gaps. */
  const drawSegment = useCallback(
    (x0: number, y0: number, x1: number, y1: number) => {
      const mask = maskRef.current;
      if (!mask) return;
      const ctx = mask.getContext("2d");
      if (!ctx) return;
      ctx.strokeStyle = tool === "paint" ? "rgba(255,255,255,1)" : "rgba(0,0,0,1)";
      ctx.lineWidth = brushPx;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    },
    [tool, brushPx],
  );

  /** Map a pointer event from the displayed canvas back to mask-canvas
   *  coordinates. The display canvas is sized by CSS to fit the modal;
   *  the mask is at native source dims. */
  function eventToMaskCoords(e: React.PointerEvent<HTMLCanvasElement>): {
    x: number;
    y: number;
  } | null {
    const display = displayRef.current;
    const mask = maskRef.current;
    if (!display || !mask) return null;
    const rect = display.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const x = ((e.clientX - rect.left) / rect.width) * mask.width;
    const y = ((e.clientY - rect.top) / rect.height) * mask.height;
    return { x, y };
  }

  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const drawingRef = useRef<boolean>(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: eventToMaskCoords reads refs only
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (e.button !== 0) return;
      const p = eventToMaskCoords(e);
      if (!p) return;
      drawingRef.current = true;
      lastPointRef.current = p;
      (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
      drawDab(p.x, p.y);
      setRenderTick((t) => t + 1);
    },
    [drawDab],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: eventToMaskCoords reads refs only
  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawingRef.current) return;
      const p = eventToMaskCoords(e);
      if (!p) return;
      const last = lastPointRef.current;
      if (last) drawSegment(last.x, last.y, p.x, p.y);
      else drawDab(p.x, p.y);
      lastPointRef.current = p;
      setRenderTick((t) => t + 1);
    },
    [drawDab, drawSegment],
  );

  const commit = useCallback(() => {
    drawingRef.current = false;
    lastPointRef.current = null;
    const mask = maskRef.current;
    if (!mask) return;
    mask.toBlob((b) => onChange(b ?? null), "image/png");
  }, [onChange]);

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      try {
        (e.currentTarget as HTMLCanvasElement).releasePointerCapture(e.pointerId);
      } catch {
        // releasePointerCapture throws when capture wasn't set; ignore.
      }
      if (drawingRef.current) commit();
    },
    [commit],
  );

  /** Redraw the display canvas after any mask edit. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: redraw must fire on tick bump
  useEffect(() => {
    const display = displayRef.current;
    const mask = maskRef.current;
    if (!display || !mask || !sourceCanvas) return;
    const w = mask.width;
    const h = mask.height;
    display.width = w;
    display.height = h;
    const ctx = display.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    // Source as faint background so the user sees what they're masking.
    ctx.globalAlpha = 0.35;
    ctx.drawImage(sourceCanvas, 0, 0);
    ctx.globalAlpha = 1;
    // Mask overlay — multiply blend so white pixels brighten the
    // source (highlighting "edit here") and black pixels darken it.
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 0.55;
    ctx.drawImage(mask, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }, [renderTick, sourceCanvas]);

  const fillAll = useCallback(() => {
    const mask = maskRef.current;
    const src = sourceCanvas;
    if (!mask || !src) return;
    const mctx = mask.getContext("2d");
    if (!mctx) return;
    seedFromSourceAlpha(mctx, src);
    setRenderTick((t) => t + 1);
    commit();
  }, [sourceCanvas, commit]);

  const clearAll = useCallback(() => {
    const mask = maskRef.current;
    if (!mask) return;
    const ctx = mask.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "rgba(0,0,0,1)";
    ctx.fillRect(0, 0, mask.width, mask.height);
    setRenderTick((t) => t + 1);
    commit();
  }, [commit]);

  const invertAll = useCallback(() => {
    const mask = maskRef.current;
    if (!mask) return;
    const ctx = mask.getContext("2d");
    if (!ctx) return;
    const w = mask.width;
    const h = mask.height;
    const data = ctx.getImageData(0, 0, w, h);
    for (let i = 0; i < data.data.length; i += 4) {
      data.data[i] = 255 - data.data[i];
      data.data[i + 1] = 255 - data.data[i + 1];
      data.data[i + 2] = 255 - data.data[i + 2];
    }
    ctx.putImageData(data, 0, 0);
    setRenderTick((t) => t + 1);
    commit();
  }, [commit]);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-3 py-2 text-xs">
        <span className="font-mono text-[var(--color-fg-dim)]">mask brush</span>
        <div className="flex gap-1">
          <ToolButton active={tool === "paint"} onClick={() => setTool("paint")}>
            paint (edit zone)
          </ToolButton>
          <ToolButton active={tool === "erase"} onClick={() => setTool("erase")}>
            erase (preserve)
          </ToolButton>
        </div>
        <label className="flex items-center gap-2">
          <span className="text-[var(--color-fg-dim)]">size</span>
          <input
            type="range"
            min={MIN_BRUSH_PX}
            max={MAX_BRUSH_PX}
            value={brushPx}
            onChange={(e) => setBrushPx(Number(e.target.value))}
            className="w-32"
          />
          <span className="w-8 text-right font-mono text-[var(--color-fg-dim)]">{brushPx}</span>
        </label>
        <div className="flex gap-1">
          <ToolButton onClick={fillAll}>fill all (whole component)</ToolButton>
          <ToolButton onClick={clearAll}>clear</ToolButton>
          <ToolButton onClick={invertAll}>invert</ToolButton>
        </div>
        <span className="ml-auto text-[var(--color-fg-dim)]">
          white = AI redraws · black = AI leaves alone
        </span>
      </div>

      <div className="flex flex-1 items-center justify-center overflow-hidden p-4">
        {sourceCanvas ? (
          <canvas
            ref={displayRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={onPointerUp}
            className="max-h-full max-w-full cursor-crosshair border border-[var(--color-border)]"
            style={{ touchAction: "none" }}
          />
        ) : (
          <span className="text-sm text-[var(--color-fg-dim)]">source not ready</span>
        )}
      </div>
    </div>
  );
}

function ToolButton({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded border px-2 py-1 font-mono text-[11px] transition",
        active
          ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-[var(--color-accent)]"
          : "border-[var(--color-border)] text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

/**
 * Seed the mask from the source canvas's alpha channel — every opaque
 * source pixel becomes a white mask pixel ("AI redraws this"), every
 * transparent pixel stays black ("AI leaves this alone, it's outside
 * the layer footprint").
 */
function seedFromSourceAlpha(ctx: CanvasRenderingContext2D, sourceCanvas: HTMLCanvasElement): void {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  // Black fill first — anything outside the source silhouette stays
  // black so we don't ask the AI to paint into the void.
  ctx.fillStyle = "rgba(0,0,0,1)";
  ctx.fillRect(0, 0, w, h);

  const srcCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
  if (!srcCtx) return;
  const srcData = srcCtx.getImageData(0, 0, w, h);
  const out = ctx.createImageData(w, h);
  for (let i = 0; i < srcData.data.length; i += 4) {
    const v = srcData.data[i + 3] >= 1 ? 255 : 0;
    out.data[i] = v;
    out.data[i + 1] = v;
    out.data[i + 2] = v;
    out.data[i + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
}
