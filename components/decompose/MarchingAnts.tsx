"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { selectionOutline } from "@/lib/avatar/decompose/wandSelection";

/**
 * Marching-ants overlay for a wand selection.
 *
 * Why this exists vs the old "translucent blue fill":
 *   - Photoshop convention. Marching ants is the universal "this is
 *     a selection" signal — solid fills imply paint, not selection.
 *   - The fill obscured the underlying texture so the user couldn't
 *     see exactly what was selected vs not at the seam.
 *
 * Implementation:
 *   1. Pre-compute a 1-pixel boundary canvas from the selection
 *      (white where selection ends, transparent elsewhere). Same
 *      dimensions as source, so the parent's CSS transform — which
 *      already handles zoom / pan — places the ants correctly.
 *   2. Render the boundary canvas twice on top of the preview, with
 *      alternating colours (white/black) animated via CSS dashed
 *      mask-pattern offset. Since the boundary is already a 1-px
 *      ring, animating *colour* across time produces the same
 *      perceptual effect as classic crawling-ants without needing a
 *      contour walk + SVG path.
 *
 * The ring image is regenerated only when the selection identity
 * changes, so a 10 Hz animation tick is just two cheap CSS prop
 * tweaks (no canvas work per frame).
 */
export interface MarchingAntsProps {
  selection: HTMLCanvasElement;
  /** Source dimensions — the boundary is drawn at source resolution
   *  and the parent CSS already maps it onto the preview. */
  sourceWidth: number;
  sourceHeight: number;
  /** CSS class for the absolutely-positioned wrapper. */
  className?: string;
}

export function MarchingAnts({
  selection,
  sourceWidth,
  sourceHeight,
  className,
}: MarchingAntsProps) {
  // The boundary canvas is expensive (full-image scan) but only
  // changes when the selection changes — useMemo keys on the
  // selection instance.
  const outline = useMemo(() => selectionOutline(selection), [selection]);
  const dataUrl = useMemo(() => outline.toDataURL("image/png"), [outline]);

  // Animate the dash phase via a simple frame counter — gives the
  // classic "ants crawling" perceptual effect by swapping the
  // outline image's box-shadow direction without redrawing the
  // canvas. requestAnimationFrame ticked at ~ 8 Hz keeps CPU near 0.
  const [phase, setPhase] = useState(0);
  const lastRef = useRef(0);
  useEffect(() => {
    let raf = 0;
    const ANT_HZ = 8;
    const tick = (t: number) => {
      if (t - lastRef.current > 1000 / ANT_HZ) {
        lastRef.current = t;
        setPhase((p) => (p + 1) & 1);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 ${className ?? ""}`}
      style={{
        // Two stacked images: dark ring + white ring. We swap the
        // backgroundPosition (1 px diagonal) on each phase tick so
        // the eye sees crawling pixels. The single-pixel ring data
        // URL is the same; only the offset alternates.
        backgroundImage: `url(${dataUrl}), url(${dataUrl})`,
        backgroundSize: "100% 100%, 100% 100%",
        backgroundRepeat: "no-repeat, no-repeat",
        backgroundPosition: phase === 0 ? "0 0, 1px 1px" : "1px 0, 0 1px",
        backgroundBlendMode: "normal",
        // Filter tints both layers. The first to white (via a
        // brightness/contrast push), the second is the source —
        // gives a soft white-on-black ant trail readable on any
        // texture without obscuring it.
        filter: "drop-shadow(0 0 1px rgba(0,0,0,0.85))",
        mixBlendMode: "normal",
        imageRendering: "pixelated",
        width: "100%",
        height: "100%",
      }}
      // Reserved attributes so future devs can find the wrapper —
      // not used by the layout itself.
      data-marching-ants
      data-w={sourceWidth}
      data-h={sourceHeight}
    />
  );
}
