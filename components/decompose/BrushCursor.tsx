"use client";

import { useEffect, useState } from "react";

/**
 * Circle outline that follows the cursor, sized to match the actual
 * brush footprint. Photoshop has the same affordance — without it
 * the user has to guess how big a stroke will be at the current
 * zoom level.
 *
 * The circle is positioned in client coords (no scrolling parent
 * inside the modal, so position: fixed is safe). Brush size is the
 * source-pixel diameter; the rendered diameter applies the canvas
 * scale (`source.width / canvasRect.width`) so what the user sees
 * matches what `paintAt()` will actually paint.
 *
 * Hidden when:
 *   - cursor is outside the canvas, or
 *   - the active tool isn't a sized-brush tool (we still want the
 *     normal browser cursor for hand / move / etc.)
 */
export interface BrushCursorProps {
  /** Element whose pointer events drive the cursor; usually the
   *  canvas itself. Listener is attached to its parent so we can
   *  tell when the pointer leaves the canvas (pointermove on the
   *  parent fires when the cursor is just outside the canvas too). */
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** Brush size in source-pixel units. */
  brushSize: number;
  /** When false, the cursor is unmounted entirely — no overlay div
   *  in the DOM. Pass false when the active tool isn't a brush /
   *  eraser / bucket / wand. */
  enabled: boolean;
  /** Outline color hint. The default green matches the editor's
   *  accent. The Wand tool passes a different color so the user
   *  can tell selection vs paint at a glance. */
  color?: string;
}

export function BrushCursor({
  canvasRef,
  brushSize,
  enabled,
  color = "var(--color-accent)",
}: BrushCursorProps) {
  const [pos, setPos] = useState<{ x: number; y: number; scale: number } | null>(null);

  useEffect(() => {
    if (!enabled) {
      setPos(null);
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      // The diameter the user sees should match `brushSize` source-px
      // scaled into client pixels: scale = rect.width / source.width
      // = rect.width / canvas.width. (canvas.width is the source dim.)
      if (rect.width <= 0 || canvas.width <= 0) {
        setPos(null);
        return;
      }
      const scale = rect.width / canvas.width;
      setPos({ x: e.clientX, y: e.clientY, scale });
    };
    const onLeave = () => setPos(null);

    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerenter", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    return () => {
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerenter", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
    };
  }, [enabled, canvasRef]);

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
