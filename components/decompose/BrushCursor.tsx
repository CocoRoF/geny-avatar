"use client";

import { useEffect, useState } from "react";

/**
 * Circle outline that follows the cursor, sized to match the actual
 * brush footprint. Photoshop has the same affordance — without it
 * the user has to guess how big a stroke will be at the current
 * zoom level.
 *
 * Hidden when:
 *   - cursor is outside the canvas, or
 *   - the active tool isn't a sized-brush tool (we still want the
 *     normal browser cursor for hand / move / wand / etc.)
 *
 * Why this takes a `canvas: HTMLCanvasElement | null` prop instead
 * of a RefObject: the listener-attachment effect needs to re-run
 * when the canvas DOM element mounts. A RefObject's identity is
 * stable across renders so React can't track the inner `.current`
 * field — when this component mounts before the canvas does (the
 * studio shows "loading region…" first), the listeners would never
 * attach and the cursor stays invisible until the user toggles tools
 * which forces the effect to re-run for an unrelated reason. By
 * tracking the element through state in the parent we get a real
 * dependency the effect can observe.
 *
 * `sourceWidth` is the layer's source-pixel width. Brush size is
 * also expressed in source-pixel units, so the rendered diameter is
 * `brushSize × (canvasRect.width / sourceWidth)` regardless of the
 * canvas's backbuffer resolution (which may be much larger than
 * source on a Retina screen — the compositor sizes the backbuffer
 * to layout × DPR).
 */
export interface BrushCursorProps {
  /** The preview canvas DOM element. Tracked through state in the
   *  parent (callback-ref pattern) so this component's effect can
   *  observe element mount/unmount as a real dep change. */
  canvas: HTMLCanvasElement | null;
  /** Brush diameter in source-pixel units (the same units the
   *  OptionsBar slider shows). */
  brushSize: number;
  /** Source canvas width. Used to compute the visual scale —
   *  rect.width / sourceWidth is the source→client ratio. */
  sourceWidth: number;
  /** When false, the cursor is unmounted entirely. */
  enabled: boolean;
  /** Outline color hint. The default green matches the editor's
   *  accent. */
  color?: string;
}

export function BrushCursor({
  canvas,
  brushSize,
  sourceWidth,
  enabled,
  color = "var(--color-accent)",
}: BrushCursorProps) {
  const [pos, setPos] = useState<{ x: number; y: number; scale: number } | null>(null);

  useEffect(() => {
    if (!enabled || !canvas) {
      setPos(null);
      return;
    }

    const compute = (
      clientX: number,
      clientY: number,
    ): { x: number; y: number; scale: number } | null => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || sourceWidth <= 0) return null;
      // Source→client scale. brushSize is in source-pixel units;
      // multiplying by this scale gives the visible diameter in
      // client pixels.
      const scale = rect.width / sourceWidth;
      return { x: clientX, y: clientY, scale };
    };

    const onCanvasMove = (e: PointerEvent) => {
      setPos(compute(e.clientX, e.clientY));
    };
    const onLeave = () => setPos(null);

    // Window-level pointermove (capture phase) catches the case where
    // the user is already hovering over the canvas at the moment the
    // tool switches: the canvas's own pointermove listener wouldn't
    // fire until the mouse actually moves, but the window-level one
    // sees the next mousemove anywhere and we can hit-test it against
    // the canvas rect for an instant cursor render. Cheap — a single
    // setState per mousemove, React reconciles via shallow compare.
    const onWindowMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      ) {
        return; // Outside the canvas — leave the canvas-leave handler to clear.
      }
      setPos(compute(e.clientX, e.clientY));
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
    };
  }, [enabled, canvas, sourceWidth]);

  if (!enabled || !pos) return null;
  const diameter = Math.max(2, brushSize * pos.scale);
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed z-50"
      style={{
        left: pos.x,
        top: pos.y,
        width: diameter,
        height: diameter,
        marginLeft: -diameter / 2,
        marginTop: -diameter / 2,
        borderRadius: "50%",
        // Two rings (light + dark) so the cursor stays legible on
        // any background. Inner is the accent colour; outer is
        // semi-transparent black for contrast on light pixels.
        boxShadow: `0 0 0 1px ${color}, 0 0 0 2px rgba(0,0,0,0.55)`,
      }}
    />
  );
}
