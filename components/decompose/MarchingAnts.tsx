"use client";

import { useEffect, useMemo, useRef } from "react";
import { selectionOutline } from "@/lib/avatar/decompose/wandSelection";

/**
 * Marching-ants overlay for the magic wand selection.
 *
 * Design:
 *
 *   1. Pre-compute the 1-pixel selection boundary as an alpha mask
 *      (`selectionOutline`). Same dimensions as the source.
 *
 *   2. Render a single absolutely-positioned <div> sized to the
 *      canvas wrapper. The boundary canvas becomes its CSS
 *      `mask-image`, so only pixels along the selection edge are
 *      visible — everything else is clipped away.
 *
 *   3. The div's `background-image` is a diagonal black/white
 *      repeating-linear-gradient (the dash pattern). Combined with
 *      the boundary mask, only the dashes that fall along the edge
 *      pixels are rendered.
 *
 *   4. A rAF loop continuously updates `background-position` so the
 *      dashes scroll along the contour. Pure CSS style mutation —
 *      no React re-renders, no per-frame canvas work, no per-frame
 *      JS layout.
 *
 * Why this is better than the previous implementation:
 *
 *   The earlier version stacked the SAME outline canvas TWICE at
 *   different `background-position` offsets to fake the "two
 *   colours marching" look. That literally rendered the line twice
 *   at 1px-apart positions, so users saw a doubled / slightly
 *   misaligned outline. Replacing the dual-image trick with a
 *   single masked gradient produces ONE crisp line whose fill
 *   actually moves.
 */
export interface MarchingAntsProps {
  selection: HTMLCanvasElement;
  /** Source dimensions — recorded for debugging; the actual mapping
   *  is handled by CSS (`mask-size: 100% 100%` stretches the
   *  source-dim boundary to fit the canvas wrapper). */
  sourceWidth: number;
  sourceHeight: number;
  className?: string;
}

export function MarchingAnts({
  selection,
  sourceWidth,
  sourceHeight,
  className,
}: MarchingAntsProps) {
  // The outline is only as expensive as the selection allows; useMemo
  // keys on the selection identity so a re-mount of MarchingAnts
  // with the same selection skips rebuilding.
  const outline = useMemo(() => selectionOutline(selection), [selection]);
  const maskUrl = useMemo(() => outline.toDataURL("image/png"), [outline]);

  const elementRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    let cancelled = false;
    const tick = (now: number) => {
      if (cancelled) return;
      const el = elementRef.current;
      if (el) {
        // 8px diagonal stripe period; scroll one full period every
        // ~600ms. Matches Photoshop's marching cadence — fast enough
        // to feel "selected", slow enough not to twitch.
        const period = 11.3137085; // 8 * sqrt(2) for a -45deg pattern
        const offset = (now / 60) % period;
        el.style.backgroundPosition = `${offset}px 0`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      ref={elementRef}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 ${className ?? ""}`}
      style={{
        // CSS mask clips the gradient to the selection's 1-px
        // boundary — everything outside that ring is transparent.
        // The -webkit- prefix is still required for Safari < 17.
        WebkitMaskImage: `url(${maskUrl})`,
        WebkitMaskSize: "100% 100%",
        WebkitMaskRepeat: "no-repeat",
        WebkitMaskPosition: "0 0",
        maskImage: `url(${maskUrl})`,
        maskSize: "100% 100%",
        maskRepeat: "no-repeat",
        maskPosition: "0 0",
        // Diagonal black/white dashes, repeating every 8px. The
        // animation in the effect above slides the position to make
        // dashes appear to march along the boundary.
        backgroundImage:
          "repeating-linear-gradient(-45deg, #ffffff 0, #ffffff 4px, #000000 4px, #000000 8px)",
        // Pixelated rendering keeps the 1-px outline crisp when the
        // wrapper is zoomed; without this the mask resamples with
        // bilinear smoothing and the line looks fuzzy at deep zoom.
        imageRendering: "pixelated",
      }}
      data-w={sourceWidth}
      data-h={sourceHeight}
    />
  );
}
