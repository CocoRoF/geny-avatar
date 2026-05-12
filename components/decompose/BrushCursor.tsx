"use client";

import { useEffect, useRef } from "react";

/**
 * Circle outline that follows the cursor, sized to match the actual
 * brush footprint. Photoshop has the same affordance — without it
 * the user has to guess how big a stroke will be at the current
 * zoom level.
 *
 * Hot path: at 240 Hz pen rates the previous implementation called
 * setState on every pointermove, which forced React to reconcile +
 * re-render this whole component 240×/sec. Even though the rendered
 * output is just one div, that's hundreds of full render cycles per
 * second on the main thread.
 *
 * This version skips React state entirely. A single hidden div is
 * mounted; pointer listeners mutate its `style.left/top/width/...`
 * directly through the ref. Zero React work per mouse move; the
 * browser only repaints the cursor's transform.
 *
 * `canvas` is passed as a state-tracked element (not a RefObject)
 * so this component's effect re-attaches listeners when the canvas
 * DOM node actually mounts. The ref-as-prop pattern wouldn't trigger
 * the effect on mount, which is why the cursor used to be invisible
 * until the user toggled tools.
 */
export interface BrushCursorProps {
  canvas: HTMLCanvasElement | null;
  /** Brush diameter in source-pixel units (the value the OptionsBar
   *  slider exposes). */
  brushSize: number;
  /** Source canvas width — for scaling brushSize from source-px to
   *  client-px. The compositor backbuffer may be much larger on a
   *  Retina display so we don't use canvas.width here. */
  sourceWidth: number;
  enabled: boolean;
  color?: string;
}

export function BrushCursor({
  canvas,
  brushSize,
  sourceWidth,
  enabled,
  color = "var(--color-accent)",
}: BrushCursorProps) {
  const elRef = useRef<HTMLDivElement>(null);
  // Refs hold the latest values so the event handlers (set up once
  // per attach) always see fresh data without re-attaching.
  const brushSizeRef = useRef(brushSize);
  const sourceWidthRef = useRef(sourceWidth);
  const colorRef = useRef(color);
  brushSizeRef.current = brushSize;
  sourceWidthRef.current = sourceWidth;
  colorRef.current = color;

  useEffect(() => {
    const el = elRef.current;
    if (!enabled || !canvas || !el) {
      if (el) el.style.display = "none";
      return;
    }

    const place = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || sourceWidthRef.current <= 0) return;
      const scale = rect.width / sourceWidthRef.current;
      const diameter = Math.max(2, brushSizeRef.current * scale);
      // Single-frame style assignment block. Browser handles the
      // composited transform in one repaint — no React, no layout
      // flush from this side.
      el.style.left = `${clientX}px`;
      el.style.top = `${clientY}px`;
      el.style.width = `${diameter}px`;
      el.style.height = `${diameter}px`;
      el.style.marginLeft = `${-diameter / 2}px`;
      el.style.marginTop = `${-diameter / 2}px`;
      el.style.boxShadow = `0 0 0 1px ${colorRef.current}, 0 0 0 2px rgba(0,0,0,0.55)`;
      el.style.display = "block";
    };

    const onCanvasMove = (e: PointerEvent) => place(e.clientX, e.clientY);
    const onLeave = () => {
      el.style.display = "none";
    };
    // Window-level capture also picks up the initial pointer
    // position when the tool switches while the cursor is already
    // hovering — without it the brush ring would only appear on
    // the next move.
    const onWindowMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      ) {
        return;
      }
      place(e.clientX, e.clientY);
    };

    canvas.addEventListener("pointermove", onCanvasMove);
    canvas.addEventListener("pointerenter", onCanvasMove);
    canvas.addEventListener("pointerleave", onLeave);
    window.addEventListener("pointermove", onWindowMove, { capture: true });
    return () => {
      canvas.removeEventListener("pointermove", onCanvasMove);
      canvas.removeEventListener("pointerenter", onCanvasMove);
      canvas.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("pointermove", onWindowMove, { capture: true });
      el.style.display = "none";
    };
  }, [enabled, canvas]);

  return (
    <div
      ref={elRef}
      aria-hidden="true"
      className="pointer-events-none fixed z-50"
      style={{
        display: "none",
        borderRadius: "50%",
        // The actual position / size / colour are set imperatively
        // in the effect above — these are just initial placeholders
        // so the first paint doesn't see partial styles.
        left: 0,
        top: 0,
        width: 2,
        height: 2,
      }}
    />
  );
}
