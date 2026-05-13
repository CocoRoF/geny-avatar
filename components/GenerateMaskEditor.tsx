"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BrushCursor } from "@/components/decompose/BrushCursor";
import { useCanvasViewport } from "@/lib/avatar/decompose/useCanvasViewport";

/**
 * Generate-flow mask editor — full-featured.
 *
 * Separate concept from DecomposeStudio's mask:
 *   - DecomposeStudio mask: destination-out HIDE tool (alpha=255 = "erase").
 *   - Generate inpaint mask: edit-region selector (white = "regenerate this").
 *
 * Built on the same reusable primitives DecomposeStudio uses
 * (`useCanvasViewport`, `BrushCursor`) so the brush, zoom, and pan
 * feel identical between the two surfaces. Photoshop-style:
 *   - B / E shortcuts toggle paint vs erase.
 *   - [ / ] adjust brush size.
 *   - Mouse wheel zooms around the cursor.
 *   - Space (hold) pans.
 *   - Middle mouse button drag pans.
 *   - Ctrl+0 fits to screen, Ctrl+1 returns to 100%.
 *   - Ctrl+Z undo, Ctrl+Shift+Z redo (30-step history).
 *
 * Output: a binary PNG blob — RGB white = edit, RGB black = preserve,
 * alpha always 255 (FLUX/SDXL convention; alpha-readers and luma-
 * readers both get the same answer).
 */
export type GenerateMaskEditorProps = {
  sourceCanvas: HTMLCanvasElement | null;
  value: Blob | null;
  onChange: (blob: Blob | null) => void;
};

type Tool = "paint" | "erase";

const DEFAULT_BRUSH_PX = 24;
const MIN_BRUSH_PX = 2;
const MAX_BRUSH_PX = 256;
const HISTORY_MAX = 30;
const BRUSH_STEP = 4;

export function GenerateMaskEditor({ sourceCanvas, value, onChange }: GenerateMaskEditorProps) {
  /** Outer container that owns the viewport transform + wheel/key events. */
  const containerRef = useRef<HTMLDivElement | null>(null);
  /** Wrapper that gets `transform: translate(panX,panY) scale(zoom)`. */
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  /** Display canvas the user looks at — source under, mask overlay on top. */
  const [displayEl, setDisplayEl] = useState<HTMLCanvasElement | null>(null);
  /** Off-screen full-resolution mask canvas — RGB white = edit, RGB black
   *  = preserve. Single source of truth. */
  const maskRef = useRef<HTMLCanvasElement | null>(null);

  const [tool, setTool] = useState<Tool>("paint");
  const [brushPx, setBrushPx] = useState<number>(DEFAULT_BRUSH_PX);
  const [renderTick, setRenderTick] = useState(0);

  /** Snapshot history. Each entry is a canvas — pointer index walks
   *  backward (Ctrl+Z) and forward (Ctrl+Shift+Z). pointer = -1 means
   *  baseline (entries[-1] reads as initial seed). */
  const historyRef = useRef<HTMLCanvasElement[]>([]);
  const historyPointerRef = useRef<number>(-1);
  const [historyDepth, setHistoryDepth] = useState({ undo: 0, redo: 0 });

  const viewport = useCanvasViewport({ containerRef });

  /** Seed the offscreen mask canvas from source alpha (whole component
   *  = edit zone), or load a passed-in blob. */
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
      const img = new Image();
      img.onload = () => {
        mctx.drawImage(img, 0, 0, w, h);
        maskRef.current = mask;
        historyRef.current = [];
        historyPointerRef.current = -1;
        setHistoryDepth({ undo: 0, redo: 0 });
        setRenderTick((t) => t + 1);
      };
      img.onerror = () => {
        seedFromSourceAlpha(mctx, sourceCanvas);
        maskRef.current = mask;
        historyRef.current = [];
        historyPointerRef.current = -1;
        setHistoryDepth({ undo: 0, redo: 0 });
        setRenderTick((t) => t + 1);
      };
      img.src = URL.createObjectURL(value);
    } else {
      seedFromSourceAlpha(mctx, sourceCanvas);
      maskRef.current = mask;
      historyRef.current = [];
      historyPointerRef.current = -1;
      setHistoryDepth({ undo: 0, redo: 0 });
      setRenderTick((t) => t + 1);
    }
  }, [sourceCanvas, value]);

  /** Push a snapshot of the current mask state into history. Called
   *  after each commit (stroke end, fill-all, clear, invert). */
  const pushHistory = useCallback(() => {
    const mask = maskRef.current;
    if (!mask) return;
    // Trim any redo branch — new edit invalidates the future stack.
    const pointer = historyPointerRef.current;
    if (pointer < historyRef.current.length - 1) {
      historyRef.current = historyRef.current.slice(0, pointer + 1);
    }
    const snap = document.createElement("canvas");
    snap.width = mask.width;
    snap.height = mask.height;
    const sctx = snap.getContext("2d");
    if (!sctx) return;
    sctx.drawImage(mask, 0, 0);
    historyRef.current.push(snap);
    // Cap the stack — drop the oldest entry when full. Pointer still
    // points to the latest entry afterwards.
    if (historyRef.current.length > HISTORY_MAX) {
      historyRef.current.shift();
    }
    historyPointerRef.current = historyRef.current.length - 1;
    setHistoryDepth({
      undo: historyPointerRef.current + 1,
      redo: historyRef.current.length - 1 - historyPointerRef.current,
    });
  }, []);

  const restoreFromHistory = useCallback(
    (targetPointer: number) => {
      const mask = maskRef.current;
      if (!mask) return;
      const ctx = mask.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, mask.width, mask.height);
      if (targetPointer >= 0 && historyRef.current[targetPointer]) {
        ctx.drawImage(historyRef.current[targetPointer], 0, 0);
      } else {
        // Pre-history = seed from source alpha (initial state).
        if (sourceCanvas) seedFromSourceAlpha(ctx, sourceCanvas);
      }
      historyPointerRef.current = targetPointer;
      setHistoryDepth({
        undo: targetPointer + 1,
        redo: historyRef.current.length - 1 - targetPointer,
      });
      setRenderTick((t) => t + 1);
      // Commit the restored state outward so the parent's mask state
      // stays in sync with what the user sees.
      mask.toBlob((b) => onChange(b ?? null), "image/png");
    },
    [sourceCanvas, onChange],
  );

  const undo = useCallback(() => {
    restoreFromHistory(historyPointerRef.current - 1);
  }, [restoreFromHistory]);
  const redo = useCallback(() => {
    if (historyPointerRef.current >= historyRef.current.length - 1) return;
    restoreFromHistory(historyPointerRef.current + 1);
  }, [restoreFromHistory]);

  const drawDab = useCallback(
    (x: number, y: number) => {
      const mask = maskRef.current;
      if (!mask) return;
      const ctx = mask.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = tool === "paint" ? "rgba(255,255,255,1)" : "rgba(0,0,0,1)";
      ctx.beginPath();
      ctx.arc(x, y, brushPx / 2, 0, Math.PI * 2);
      ctx.fill();
    },
    [tool, brushPx],
  );

  const drawSegment = useCallback(
    (x0: number, y0: number, x1: number, y1: number) => {
      const mask = maskRef.current;
      if (!mask) return;
      const ctx = mask.getContext("2d");
      if (!ctx) return;
      ctx.strokeStyle = tool === "paint" ? "rgba(255,255,255,1)" : "rgba(0,0,0,1)";
      ctx.lineWidth = brushPx;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    },
    [tool, brushPx],
  );

  /** Map a client-space pointer event to mask-canvas pixel coords.
   *  Uses the DISPLAY canvas's bounding rect so the viewport's CSS
   *  transform (zoom + pan) is automatically baked into the
   *  conversion — that's the whole point of measuring the live
   *  client rect rather than tracking transform state manually. */
  const eventToMaskCoords = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const mask = maskRef.current;
      if (!displayEl || !mask) return null;
      const rect = displayEl.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      const x = ((clientX - rect.left) / rect.width) * mask.width;
      const y = ((clientY - rect.top) / rect.height) * mask.height;
      return { x, y };
    },
    [displayEl],
  );

  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      // Pan takes priority — space-held or middle button.
      if (viewport.spaceHeld || e.button === 1) {
        viewport.onPanPointerDown(e.nativeEvent);
        return;
      }
      if (e.button !== 0) return;
      const p = eventToMaskCoords(e.clientX, e.clientY);
      if (!p) return;
      drawingRef.current = true;
      lastPointRef.current = p;
      (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
      drawDab(p.x, p.y);
      setRenderTick((t) => t + 1);
    },
    [viewport, eventToMaskCoords, drawDab],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (viewport.isPanning) {
        viewport.onPanPointerMove(e.nativeEvent);
        return;
      }
      if (!drawingRef.current) return;
      const p = eventToMaskCoords(e.clientX, e.clientY);
      if (!p) return;
      const last = lastPointRef.current;
      if (last) drawSegment(last.x, last.y, p.x, p.y);
      else drawDab(p.x, p.y);
      lastPointRef.current = p;
      setRenderTick((t) => t + 1);
    },
    [viewport, eventToMaskCoords, drawDab, drawSegment],
  );

  const commitStroke = useCallback(() => {
    drawingRef.current = false;
    lastPointRef.current = null;
    const mask = maskRef.current;
    if (!mask) return;
    pushHistory();
    mask.toBlob((b) => onChange(b ?? null), "image/png");
  }, [onChange, pushHistory]);

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (viewport.isPanning) {
        viewport.onPanPointerUp(e.nativeEvent);
        return;
      }
      try {
        (e.currentTarget as HTMLCanvasElement).releasePointerCapture(e.pointerId);
      } catch {
        // releasePointerCapture throws if capture wasn't set; ignore.
      }
      if (drawingRef.current) commitStroke();
    },
    [viewport, commitStroke],
  );

  /** Wheel zoom — wired to the viewport hook. Mounted on the
   *  container with non-passive listener so we can preventDefault to
   *  block page scroll. */
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      viewport.onWheel(e);
    };
    node.addEventListener("wheel", handler, { passive: false });
    return () => node.removeEventListener("wheel", handler);
  }, [viewport]);

  /** Redraw the display canvas after any mask edit. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: redraw fires on tick bump
  useEffect(() => {
    const display = displayEl;
    const mask = maskRef.current;
    if (!display || !mask || !sourceCanvas) return;
    const w = mask.width;
    const h = mask.height;
    display.width = w;
    display.height = h;
    const ctx = display.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    // 1. Source at full opacity — show real layer colours.
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(sourceCanvas, 0, 0);
    // 2. Mask via multiply — white passes through, black darkens.
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = 0.85;
    ctx.drawImage(mask, 0, 0);
    // 3. Re-enforce source alpha so the silhouette outline stays
    //    transparent (mask is opaque everywhere).
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(sourceCanvas, 0, 0);
    ctx.globalCompositeOperation = "source-over";
  }, [renderTick, sourceCanvas, displayEl]);

  const fillAll = useCallback(() => {
    const mask = maskRef.current;
    const src = sourceCanvas;
    if (!mask || !src) return;
    const mctx = mask.getContext("2d");
    if (!mctx) return;
    seedFromSourceAlpha(mctx, src);
    setRenderTick((t) => t + 1);
    pushHistory();
    mask.toBlob((b) => onChange(b ?? null), "image/png");
  }, [sourceCanvas, onChange, pushHistory]);

  const clearAll = useCallback(() => {
    const mask = maskRef.current;
    if (!mask) return;
    const ctx = mask.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "rgba(0,0,0,1)";
    ctx.fillRect(0, 0, mask.width, mask.height);
    setRenderTick((t) => t + 1);
    pushHistory();
    mask.toBlob((b) => onChange(b ?? null), "image/png");
  }, [onChange, pushHistory]);

  const invertAll = useCallback(() => {
    const mask = maskRef.current;
    if (!mask) return;
    const ctx = mask.getContext("2d");
    if (!ctx) return;
    const data = ctx.getImageData(0, 0, mask.width, mask.height);
    for (let i = 0; i < data.data.length; i += 4) {
      data.data[i] = 255 - data.data[i];
      data.data[i + 1] = 255 - data.data[i + 1];
      data.data[i + 2] = 255 - data.data[i + 2];
    }
    ctx.putImageData(data, 0, 0);
    setRenderTick((t) => t + 1);
    pushHistory();
    mask.toBlob((b) => onChange(b ?? null), "image/png");
  }, [onChange, pushHistory]);

  /** Photoshop-style keyboard shortcuts. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't intercept while typing in an input/textarea.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      // Undo / Redo
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        redo();
        return;
      }
      // Fit / Actual size
      if ((e.ctrlKey || e.metaKey) && e.key === "0") {
        e.preventDefault();
        viewport.fit();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "1") {
        e.preventDefault();
        viewport.actualSize();
        return;
      }
      // Tool shortcuts
      if (e.key === "b" || e.key === "B") {
        setTool("paint");
        return;
      }
      if (e.key === "e" || e.key === "E") {
        setTool("erase");
        return;
      }
      // Brush size
      if (e.key === "[") {
        setBrushPx((px) => Math.max(MIN_BRUSH_PX, px - BRUSH_STEP));
        return;
      }
      if (e.key === "]") {
        setBrushPx((px) => Math.min(MAX_BRUSH_PX, px + BRUSH_STEP));
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, viewport]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-0">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--color-border)] px-3 py-2 text-xs">
        <span className="font-mono text-[var(--color-fg-dim)]">mask brush</span>
        <div className="flex gap-1">
          <ToolButton active={tool === "paint"} onClick={() => setTool("paint")} title="brush (B)">
            paint
          </ToolButton>
          <ToolButton active={tool === "erase"} onClick={() => setTool("erase")} title="eraser (E)">
            erase
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
            title="brush size ( [ / ] )"
          />
          <span className="w-10 text-right font-mono text-[var(--color-fg-dim)]">{brushPx}</span>
        </label>
        <div className="flex gap-1">
          <ToolButton onClick={undo} disabled={historyDepth.undo === 0} title="undo (Ctrl+Z)">
            undo
          </ToolButton>
          <ToolButton onClick={redo} disabled={historyDepth.redo === 0} title="redo (Ctrl+Shift+Z)">
            redo
          </ToolButton>
        </div>
        <div className="flex gap-1">
          <ToolButton onClick={fillAll} title="fill the whole component as edit zone">
            fill all
          </ToolButton>
          <ToolButton onClick={clearAll} title="clear (preserve everything)">
            clear
          </ToolButton>
          <ToolButton onClick={invertAll} title="invert edit / preserve">
            invert
          </ToolButton>
        </div>
        <div className="flex gap-1">
          <ToolButton onClick={viewport.fit} title="fit to screen (Ctrl+0)">
            fit
          </ToolButton>
          <ToolButton onClick={viewport.actualSize} title="100% zoom (Ctrl+1)">
            100%
          </ToolButton>
          <ToolButton onClick={viewport.zoomOut} title="zoom out">
            −
          </ToolButton>
          <ToolButton onClick={viewport.zoomIn} title="zoom in">
            ＋
          </ToolButton>
        </div>
        <span className="ml-auto whitespace-nowrap text-[var(--color-fg-dim)]">
          white = AI redraws · black = AI leaves alone · space = pan · wheel = zoom
        </span>
      </div>

      <div
        ref={containerRef}
        className="relative flex flex-1 min-h-0 items-center justify-center overflow-hidden bg-[var(--color-bg)] p-4"
        style={{ cursor: viewport.spaceHeld ? "grab" : "crosshair" }}
      >
        {sourceCanvas ? (
          <div
            ref={wrapperRef}
            className="relative max-h-full max-w-full"
            style={{
              aspectRatio: `${sourceCanvas.width} / ${sourceCanvas.height}`,
              height: "100%",
              transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`,
              transformOrigin: "center center",
              willChange: "transform",
            }}
          >
            <canvas
              ref={(el) => {
                setDisplayEl(el);
              }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onPointerLeave={onPointerUp}
              className="block h-full w-full border border-[var(--color-border)]"
              style={{
                touchAction: "none",
                cursor: viewport.isPanning ? "grabbing" : viewport.spaceHeld ? "grab" : "crosshair",
                imageRendering: "pixelated",
              }}
            />
          </div>
        ) : (
          <span className="text-sm text-[var(--color-fg-dim)]">source not ready</span>
        )}
        <BrushCursor
          canvas={displayEl}
          brushSize={brushPx}
          sourceWidth={sourceCanvas?.width ?? 1}
          enabled={!!sourceCanvas && !viewport.spaceHeld && !viewport.isPanning}
          color={tool === "paint" ? "var(--color-accent)" : "rgba(255,100,100,0.95)"}
        />
      </div>
    </div>
  );
}

function ToolButton({
  children,
  active,
  disabled,
  onClick,
  title,
}: {
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={[
        "rounded border px-2 py-1 font-mono text-[11px] transition",
        active
          ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-[var(--color-accent)]"
          : "border-[var(--color-border)] text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]",
        disabled ? "cursor-not-allowed opacity-30" : "",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function seedFromSourceAlpha(ctx: CanvasRenderingContext2D, sourceCanvas: HTMLCanvasElement): void {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
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
