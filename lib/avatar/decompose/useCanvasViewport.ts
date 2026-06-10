/**
 * Canvas viewport hook — owns zoom + pan state for the
 * DecomposeStudio's canvas view, plus the coord-conversion helpers
 * the brush / bucket / wand all need to translate a client-pixel
 * pointer event into source-pixel space.
 *
 * The DecomposeStudio's existing CSS-fit layout (canvas wrapper has
 * `aspect-ratio: <source W/H>`, `height: 100%`) is preserved as the
 * "fit-to-screen" baseline. Zoom is applied as a CSS transform on
 * the wrapper:
 *
 *     transform: translate(panX, panY) scale(zoom)
 *
 * Painting still happens in source-pixel space — the wrapper's
 * bounding rect in client space is what the conversion helpers
 * read, so any CSS scaling is automatically baked in.
 *
 * Constraints:
 *   - zoom range [MIN_ZOOM .. MAX_ZOOM]
 *   - wheel zoom keeps the cursor anchored (zoom around the point
 *     under the mouse, classic Photoshop behaviour)
 *   - pan stays unbounded — Photoshop lets you drag past the edge
 *     too, the user can always Ctrl+0 back to fit
 */

import { useCallback, useEffect, useRef, useState } from "react";

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 32;
/** Wheel-scroll exponential factor — same magnitude as Live2DCanvas
 *  uses for puppet zoom. Keeps zoom feel consistent across input
 *  devices. */
const WHEEL_ZOOM_SPEED = 0.0015;

export interface CanvasViewportState {
  zoom: number;
  panX: number;
  panY: number;
}

export interface UseCanvasViewportOptions {
  /** Element being zoomed/panned. Wheel + pointer listeners attach
   *  to this element. Should be the same node whose `getBoundingClientRect`
   *  the paint handlers read for source-coord conversion. */
  containerRef: React.RefObject<HTMLElement | null>;
  /** When true, wheel events zoom regardless of Ctrl. Photoshop
   *  defaults wheel = scroll, Ctrl+wheel = zoom; designers expect
   *  scroll-zoom on touchpads though. We default to "wheel zooms"
   *  because scroll-pan is awkward inside a fixed modal — pass
   *  false to opt into the alt-key gating. */
  wheelZoomsAlways?: boolean;
}

export interface UseCanvasViewportReturn {
  zoom: number;
  panX: number;
  panY: number;
  /** Reset to fit-to-screen (1.0 zoom, centered). */
  fit: () => void;
  /** Snap to 100% (1.0 zoom) without changing pan. */
  actualSize: () => void;
  /** Programmatically zoom in around the canvas centre. */
  zoomIn: () => void;
  /** Programmatically zoom out around the canvas centre. */
  zoomOut: () => void;
  /** Set zoom while keeping the point under (clientX, clientY)
   *  stationary. */
  zoomAtClient: (zoomFactor: number, clientX: number, clientY: number) => void;
  /** Apply a pan delta in client-pixel units (matches drag distance). */
  panBy: (dx: number, dy: number) => void;
  /** Hand-tool / Space drag state — the pointer handler listens to
   *  this to know whether it should pan instead of paint. */
  isPanning: boolean;
  /** Stable callbacks the consumer wires onto the container. */
  onWheel: (e: WheelEvent) => void;
  onPanPointerDown: (e: PointerEvent) => void;
  onPanPointerMove: (e: PointerEvent) => void;
  onPanPointerUp: (e: PointerEvent) => void;
  /** True while space is held — drives the Hand-tool override. */
  spaceHeld: boolean;
}

export function useCanvasViewport(options: UseCanvasViewportOptions): UseCanvasViewportReturn {
  const { containerRef } = options;
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const dragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startPanX: number;
    startPanY: number;
  } | null>(null);

  // Single write path. All mutators read the latest values from this
  // ref and write through `applyView` — no setters nested inside other
  // setters (those side effects ran twice under StrictMode, doubling
  // the pan delta per zoom tick) and no stale-closure pan reads on
  // rapid wheel events between renders.
  const viewRef = useRef({ zoom: 1, panX: 0, panY: 0 });
  const applyView = useCallback((z: number, px: number, py: number) => {
    viewRef.current = { zoom: z, panX: px, panY: py };
    setZoom(z);
    setPanX(px);
    setPanY(py);
  }, []);

  const fit = useCallback(() => {
    applyView(1, 0, 0);
  }, [applyView]);
  const actualSize = useCallback(() => {
    const v = viewRef.current;
    applyView(1, v.panX, v.panY);
  }, [applyView]);

  /**
   * Canonical cursor-anchored zoom: scale pan by the zoom ratio and
   * pull the anchor point's centre-relative coord back under the
   * cursor. (An earlier variant had broken algebra that reduced to
   * `pan * ratio`, silently dropping the anchor term — zoom-tool
   * clicks drifted with pan.)
   */
  const zoomAroundPoint = useCallback(
    (zoomFactor: number, clientX: number, clientY: number) => {
      const v = viewRef.current;
      const newZoom = clamp(v.zoom * zoomFactor);
      if (newZoom === v.zoom) return;
      const node = containerRef.current;
      if (!node) {
        applyView(newZoom, v.panX, v.panY);
        return;
      }
      const rect = node.getBoundingClientRect();
      // Position of the cursor inside the wrapper's local coords (centre origin).
      const cx = clientX - (rect.left + rect.width / 2);
      const cy = clientY - (rect.top + rect.height / 2);
      const ratio = newZoom / v.zoom;
      applyView(newZoom, v.panX * ratio + cx * (1 - ratio), v.panY * ratio + cy * (1 - ratio));
    },
    [containerRef, applyView],
  );

  const zoomIn = useCallback(() => {
    const v = viewRef.current;
    applyView(clamp(v.zoom * 1.25), v.panX, v.panY);
  }, [applyView]);
  const zoomOut = useCallback(() => {
    const v = viewRef.current;
    applyView(clamp(v.zoom / 1.25), v.panX, v.panY);
  }, [applyView]);
  const panBy = useCallback(
    (dx: number, dy: number) => {
      const v = viewRef.current;
      applyView(v.zoom, v.panX + dx, v.panY + dy);
    },
    [applyView],
  );

  const onWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SPEED);
      zoomAroundPoint(factor, e.clientX, e.clientY);
    },
    [zoomAroundPoint],
  );

  const onPanPointerDown = useCallback((e: PointerEvent) => {
    dragRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startPanX: viewRef.current.panX,
      startPanY: viewRef.current.panY,
    };
    setIsPanning(true);
  }, []);

  const onPanPointerMove = useCallback(
    (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      const v = viewRef.current;
      applyView(
        v.zoom,
        d.startPanX + (e.clientX - d.startClientX),
        d.startPanY + (e.clientY - d.startClientY),
      );
    },
    [applyView],
  );

  const onPanPointerUp = useCallback((e: PointerEvent) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    dragRef.current = null;
    setIsPanning(false);
  }, []);

  // Track Space for temporary Hand-tool override (matches Photoshop).
  // We don't trigger pan on space alone — the consumer's pointer
  // handler reads `spaceHeld` and routes accordingly.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
      }
      e.preventDefault();
      setSpaceHeld(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      setSpaceHeld(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  return {
    zoom,
    panX,
    panY,
    fit,
    actualSize,
    zoomIn,
    zoomOut,
    // Public name kept for consumers (zoom tool); implementation is the
    // single corrected cursor-anchored variant.
    zoomAtClient: zoomAroundPoint,
    panBy,
    isPanning,
    onWheel,
    onPanPointerDown,
    onPanPointerMove,
    onPanPointerUp,
    spaceHeld,
  };
}

function clamp(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
}

/**
 * Convert a client-pixel pointer position into source-pixel space.
 *
 * Both Brush, Bucket, and Magic Wand call into this. The CSS
 * transform on the canvas wrapper is already baked into the
 * bounding rect we read here, so we don't need to do any
 * zoom-aware math ourselves — multiplying by `source.width /
 * rect.width` divides out the scale automatically.
 */
export function clientToSourcePixel(
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement,
  source: HTMLCanvasElement,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
  const x = ((clientX - rect.left) / rect.width) * source.width;
  const y = ((clientY - rect.top) / rect.height) * source.height;
  return { x, y };
}
