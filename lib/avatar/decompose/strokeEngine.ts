/**
 * Brush stroke pipeline.
 *
 * What it does that the old paintAt() inline path didn't:
 *
 *   1. Sub-pixel dab positions. The old code floored x,y to source
 *      pixels, which made fast strokes wobble against the pixel grid
 *      at deep zoom.
 *
 *   2. Stamp interpolation. Between two consecutive pointer samples
 *      we lay down dabs every `spacing × brushRadius` pixels (default
 *      25% — Photoshop's default). Fast strokes no longer leave a
 *      dotted trail.
 *
 *   3. Coalesced events. The caller's pointermove handler is expected
 *      to call `getCoalescedEvents()` and feed every coalesced sample
 *      in via addSample(). On a 120 Hz pen this is the difference
 *      between 60 dabs and 240 dabs along the same stroke — only the
 *      latter renders as a smooth line.
 *
 *   4. Pressure. Reads PointerEvent.pressure (0..1, defaulting to 0.5
 *      for non-pressure devices) and modulates both size and opacity
 *      with optional per-axis enable.
 *
 *   5. No per-dab redraw. The stamping writes to the target canvas;
 *      the consumer calls compositor.invalidate() once per
 *      pointermove and the rAF coalescing in the compositor takes
 *      care of the rest.
 *
 * The engine doesn't know about React or the studio; it just owns a
 * brush configuration plus the running per-stroke state. Studio
 * creates one engine instance for the panel's lifetime and feeds it
 * pointer events. New stroke = beginStroke + addSample × N +
 * endStroke.
 */

import type { BrushOp } from "./tools";

export interface BrushConfig {
  /** Source-pixel diameter. */
  size: number;
  /** 0..100, 100 = hard edge, 0 = radial gradient with a soft fall-off. */
  hardness: number;
  /** Composite op for the dab: "source-over" (add) or
   *  "destination-out" (remove). Driven by the active tool's brushOp. */
  op: BrushOp;
  /** Fill colour. Paint mode passes the foreground color; trim and
   *  split modes leave it white-on-mask. */
  color: { r: number; g: number; b: number };
  /** When true, pressure modulates the dab radius (within 25% .. 100%
   *  of the configured size). Off for static brushes. */
  pressureSize: boolean;
  /** When true, pressure modulates the dab opacity. Independent of
   *  size — Photoshop exposes both as separate brush dynamics. */
  pressureOpacity: boolean;
  /** Dab spacing as a fraction of the radius. 0.25 = stamp every 25%
   *  of the radius. Lower = more dabs = smoother but more expensive. */
  spacing: number;
}

/** Default config used by the studio's brush / eraser tool. The
 *  pressure flags default off; the OptionsBar surfaces them. */
export function defaultBrushConfig(): BrushConfig {
  return {
    size: 20,
    hardness: 80,
    op: "add",
    color: { r: 255, g: 255, b: 255 },
    pressureSize: false,
    pressureOpacity: false,
    spacing: 0.25,
  };
}

/** Per-sample input — pointer event in source-pixel coords. */
export interface StrokeSample {
  /** Source-pixel x (float — not floored). */
  x: number;
  y: number;
  /** PointerEvent.pressure (0..1). 0.5 for non-pressure devices. */
  pressure: number;
}

export class StrokeEngine {
  /** Current brush config. Mutable — the studio passes the latest
   *  config on each beginStroke; mid-stroke size changes via shortcut
   *  keys are deferred to the next stroke. */
  private cfg: BrushConfig;
  /** Target canvas the current stroke is drawing into. Null between
   *  strokes. */
  private target: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  /** Optional clip path — the layer's actual footprint inside the
   *  bbox crop. Mirrors what the studio's paintAt() did. */
  private clip: Path2D | null = null;
  /** Last stamped sample so we can interpolate up to the next one. */
  private lastSample: StrokeSample | null = null;
  /** Leftover distance from the last interpolation pass. Tracks how
   *  far we are into the next spacing interval so spacing stays
   *  consistent across pointermove ticks. */
  private leftoverDist = 0;

  constructor(cfg?: Partial<BrushConfig>) {
    this.cfg = { ...defaultBrushConfig(), ...(cfg ?? {}) };
  }

  /** Update the brush config. Takes effect on the next addSample() —
   *  mid-stroke changes don't retroactively redraw earlier dabs. */
  setConfig(cfg: Partial<BrushConfig>): void {
    this.cfg = { ...this.cfg, ...cfg };
  }

  /** Start a new stroke. `target` is the canvas dabs will be drawn
   *  onto (the studio's mask, paint, or region canvas depending on
   *  mode). `clip` is optional — when set, dabs that fall outside it
   *  are clipped at draw time. */
  beginStroke(target: HTMLCanvasElement, clip: Path2D | null): void {
    this.target = target;
    this.ctx = target.getContext("2d");
    this.clip = clip;
    this.lastSample = null;
    this.leftoverDist = 0;
  }

  /** Add a pointer sample. The engine stamps any interpolated dabs
   *  between the previous sample and this one before stamping the
   *  current point. Coordinates are in source-pixel space (float). */
  addSample(s: StrokeSample): void {
    if (!this.ctx || !this.target) return;
    if (!this.lastSample) {
      this.stamp(s);
      this.lastSample = s;
      return;
    }
    const prev = this.lastSample;
    const dx = s.x - prev.x;
    const dy = s.y - prev.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= 0) {
      // Pointer didn't move — skip but keep lastSample so future
      // interpolation has a baseline.
      return;
    }
    const spacing = Math.max(0.5, this.cfg.size * this.cfg.spacing);
    let travelled = -this.leftoverDist;
    while (travelled + spacing < dist) {
      travelled += spacing;
      const t = travelled / dist;
      const interp: StrokeSample = {
        x: prev.x + dx * t,
        y: prev.y + dy * t,
        // Linear pressure interp — fine for visual smoothness; the
        // pen's own sample rate is usually higher than display rate
        // anyway so this is a low-amplitude correction.
        pressure: prev.pressure + (s.pressure - prev.pressure) * t,
      };
      this.stamp(interp);
    }
    this.leftoverDist = dist - travelled;
    this.stamp(s);
    this.lastSample = s;
  }

  /** End the stroke. The engine releases the target reference; the
   *  next beginStroke() starts fresh. */
  endStroke(): void {
    this.target = null;
    this.ctx = null;
    this.clip = null;
    this.lastSample = null;
    this.leftoverDist = 0;
  }

  /** Stamp a single dab. Public for the "click without drag" path —
   *  the studio's onPointerDown calls this once before beginStroke
   *  + addSample takes over for the drag. */
  stamp(s: StrokeSample): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const { r, g, b } = this.cfg.color;
    const baseRadius = Math.max(0.5, this.cfg.size / 2);
    const pressureT = clamp01(s.pressure);
    const radius = this.cfg.pressureSize ? baseRadius * (0.25 + 0.75 * pressureT) : baseRadius;
    const opacity = this.cfg.pressureOpacity ? pressureT : 1;

    ctx.save();
    if (this.clip) ctx.clip(this.clip);
    ctx.globalCompositeOperation = this.cfg.op === "add" ? "source-over" : "destination-out";
    if (this.cfg.hardness >= 100) {
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${opacity})`;
    } else {
      const inner = radius * (this.cfg.hardness / 100);
      const grad = ctx.createRadialGradient(s.x, s.y, inner, s.x, s.y, radius);
      grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${opacity})`);
      grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
      ctx.fillStyle = grad;
    }
    ctx.beginPath();
    ctx.arc(s.x, s.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
