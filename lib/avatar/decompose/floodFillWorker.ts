/**
 * Flood-fill worker — runs the BFS off the main thread so a big
 * magic-wand click can't freeze the editor.
 *
 * Loaded as a module worker via `new Worker(..., { type: "module" })`.
 * Protocol:
 *
 *   main → worker  {
 *     id: <ticket>,
 *     pixels: Uint8ClampedArray (RGBA, transferable),
 *     width, height,
 *     seedX, seedY,
 *     tolerance,                  // 0..255
 *     sampleMode: alpha | luminance | rgb,
 *     sampleSize,                 // 1, 3, 5, 11 — averaged seed
 *     contiguous,                 // true = BFS, false = scan-all
 *     antiAlias,                  // soft 1-px gradient at boundary
 *   }
 *
 *   worker → main  {
 *     id, mask: Uint8ClampedArray (transferable), area
 *   }
 *
 * The pixels buffer is moved into the worker; the caller hands over
 * a copy of the source's ImageData.data. Mask buffer goes back the
 * same way. Both transfers are zero-copy.
 *
 * NOTE: This module is loaded with `?worker&inline` so it bundles
 * into the editor without an extra HTTP request. The `self`
 * reference at the bottom is the worker scope.
 */

/// <reference lib="webworker" />

export type SampleMode = "alpha" | "luminance" | "rgb";

export interface FloodRequest {
  id: number;
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  seedX: number;
  seedY: number;
  tolerance: number;
  sampleMode: SampleMode;
  /** 1 | 3 | 5 | 11 — window side length used to compute the seed
   *  signature. Larger averages out single-pixel noise. */
  sampleSize: number;
  contiguous: boolean;
  antiAlias: boolean;
}

export interface FloodResponse {
  id: number;
  mask: Uint8ClampedArray;
  area: number;
}

const NEIGHBOUR_DX = [1, -1, 0, 0];
const NEIGHBOUR_DY = [0, 0, 1, -1];

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (ev: MessageEvent<FloodRequest>) => {
  const req = ev.data;
  const res = floodFill(req);
  self.postMessage(res, [res.mask.buffer]);
};

function floodFill(req: FloodRequest): FloodResponse {
  const {
    pixels,
    width: w,
    height: h,
    seedX,
    seedY,
    tolerance,
    sampleMode,
    sampleSize,
    contiguous,
    antiAlias,
  } = req;
  const mask = new Uint8ClampedArray(w * h);
  if (w <= 0 || h <= 0 || seedX < 0 || seedY < 0 || seedX >= w || seedY >= h) {
    return { id: req.id, mask, area: 0 };
  }

  // Seed signature: averaged sample over a window of sampleSize.
  // 1 = single pixel (point sample); larger softens single-pixel
  // noise that would otherwise trip tolerance comparisons.
  const seed = sampleAt(pixels, w, h, seedX, seedY, sampleSize);
  if (seed.a === 0) {
    // Empty seed alpha — nothing to flood (matches the old
    // `requireOpaqueSeed` behaviour in the prior implementation).
    return { id: req.id, mask, area: 0 };
  }

  // Tolerance comparator. Returns the "distance" between the pixel
  // at `idx` and the seed — caller decides if the distance is within
  // tolerance.
  const distance = makeDistance(sampleMode, seed);

  if (!contiguous) {
    // Global scan — any pixel within tolerance qualifies, regardless
    // of connectivity. Photoshop's "Contiguous: off" equivalent.
    let area = 0;
    for (let i = 0; i < w * h; i++) {
      if (distance(pixels, i) <= tolerance) {
        mask[i] = 0xff;
        area++;
      }
    }
    if (antiAlias) feather1px(mask, w, h);
    return { id: req.id, mask, area };
  }

  // Standard contiguous BFS. Uint32Array-backed queue would be
  // faster than `number[].push` for huge fills; the simple Array
  // path is good enough up to ~ 1 Mpx connected regions.
  const queue: number[] = [seedY * w + seedX];
  let head = 0;
  while (head < queue.length) {
    const idx = queue[head++];
    if (mask[idx] === 0xff) continue;
    if (distance(pixels, idx) > tolerance) continue;
    mask[idx] = 0xff;
    const x = idx % w;
    const y = (idx - x) / w;
    for (let n = 0; n < 4; n++) {
      const nx = x + NEIGHBOUR_DX[n];
      const ny = y + NEIGHBOUR_DY[n];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const nIdx = ny * w + nx;
      if (mask[nIdx] !== 0xff) queue.push(nIdx);
    }
  }

  if (antiAlias) feather1px(mask, w, h);

  let area = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) area++;
  return { id: req.id, mask, area };
}

/** Sample a window of `size` × `size` pixels centred on (x, y) and
 *  return the averaged RGBA. size=1 falls through to a single tap.
 *  Out-of-bounds taps are clamped to the edge. */
function sampleAt(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  x: number,
  y: number,
  size: number,
): { r: number; g: number; b: number; a: number } {
  if (size <= 1) {
    const i = (y * w + x) * 4;
    return { r: pixels[i], g: pixels[i + 1], b: pixels[i + 2], a: pixels[i + 3] };
  }
  const half = (size - 1) >> 1;
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  let n = 0;
  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      const sx = Math.max(0, Math.min(w - 1, x + dx));
      const sy = Math.max(0, Math.min(h - 1, y + dy));
      const i = (sy * w + sx) * 4;
      r += pixels[i];
      g += pixels[i + 1];
      b += pixels[i + 2];
      a += pixels[i + 3];
      n++;
    }
  }
  return { r: r / n, g: g / n, b: b / n, a: a / n };
}

/** Build the per-pixel distance function for the chosen sample mode.
 *  Returned closure is hot — kept allocation-free in its inner loop. */
function makeDistance(
  mode: SampleMode,
  seed: { r: number; g: number; b: number; a: number },
): (pixels: Uint8ClampedArray, idx: number) => number {
  if (mode === "alpha") {
    return (px, idx) => {
      const a = px[idx * 4 + 3];
      // Don't include pixels that are fully transparent unless the
      // seed is also fully transparent.
      if (a === 0 && seed.a > 0) return Number.POSITIVE_INFINITY;
      return Math.abs(a - seed.a);
    };
  }
  if (mode === "luminance") {
    const seedLum = 0.2126 * seed.r + 0.7152 * seed.g + 0.0722 * seed.b;
    return (px, idx) => {
      const i = idx * 4;
      const a = px[i + 3];
      if (a === 0) return Number.POSITIVE_INFINITY;
      const lum = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      return Math.abs(lum - seedLum);
    };
  }
  // rgb
  return (px, idx) => {
    const i = idx * 4;
    const a = px[i + 3];
    if (a === 0) return Number.POSITIVE_INFINITY;
    const dr = px[i] - seed.r;
    const dg = px[i + 1] - seed.g;
    const db = px[i + 2] - seed.b;
    // Max-channel distance — cheap and matches Photoshop's tolerance
    // semantics better than Euclidean (which would need a different
    // tolerance scale).
    return Math.max(Math.abs(dr), Math.abs(dg), Math.abs(db));
  };
}

/** One-pass 1-pixel feather: any boundary pixel (mask transitions
 *  inside↔outside) gets its alpha softened to 0x80. Cheap stand-in
 *  for proper Gaussian feathering — Photoshop's anti-alias checkbox
 *  is roughly this effect. */
function feather1px(mask: Uint8ClampedArray, w: number, h: number): void {
  // Capture original so we don't read pixels we've already written.
  const src = mask.slice();
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (src[i] !== 0xff) continue;
      // A pixel is a boundary if any 4-neighbour is outside.
      if (
        src[i - 1] !== 0xff ||
        src[i + 1] !== 0xff ||
        src[i - w] !== 0xff ||
        src[i + w] !== 0xff
      ) {
        mask[i] = 0x80;
      }
    }
  }
}
