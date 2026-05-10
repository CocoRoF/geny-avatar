/**
 * Connected-component flood fill driven by alpha similarity.
 *
 * Used by two tools in the DecomposeStudio:
 *   1. Bucket — fills the connected region with mask add/remove
 *   2. Magic Wand — produces a selection bitmap (separate from
 *      the mask) that subsequent operations can target
 *
 * The algorithm is a non-recursive BFS over 4-neighbours. We stash
 * visited pixels in a Uint8Array sized to the source bitmap so the
 * stack stays bounded even on the worst-case 4k×4k input. Tolerance
 * is measured against the seed pixel's alpha — a tolerance of 0
 * matches only pixels with the exact same alpha; 32 (a sensible
 * default) catches feathered edges of a stroke.
 *
 * For an alpha-only fill (the common case for Cubism layers where
 * the source has been pre-clipped to its own footprint), we sample
 * the source's pixel alpha and compare against the seed's. If you
 * need RGB-aware tolerance later, switch the comparison fn — the
 * BFS itself stays the same.
 */

export interface FloodFillOptions {
  /** Source bitmap to walk. Read-only. */
  source: HTMLCanvasElement | OffscreenCanvas;
  /** Seed point in source pixel space. */
  seedX: number;
  seedY: number;
  /** Alpha tolerance: pixels whose alpha differs from the seed by
   *  more than this are excluded from the fill. 0..255, default 32. */
  tolerance?: number;
  /** When true, only consider pixels whose alpha is non-zero — i.e.
   *  fill is constrained to the layer's footprint. The bucket and
   *  wand both want this on so the fill can't leak into the
   *  transparent canvas surround. */
  requireOpaqueSeed?: boolean;
  /** Optional clip path; pixels outside it are skipped. Mirrors the
   *  paintAt() clip for atlas-neighbour safety. */
  clip?: Path2D | null;
}

export interface FloodFillResult {
  /** Width / height of the source. */
  width: number;
  height: number;
  /** A 1-byte-per-pixel mask: 0xff inside the connected region,
   *  0x00 outside. Same dimensions as the source. */
  mask: Uint8ClampedArray;
  /** Total pixel count inside the fill — useful for the OptionsBar
   *  status line. */
  area: number;
  /** True when no fill could be produced (seed off-canvas, seed
   *  alpha=0 with `requireOpaqueSeed`, or zero matches). */
  empty: boolean;
}

const NEIGHBOUR_DX = [1, -1, 0, 0];
const NEIGHBOUR_DY = [0, 0, 1, -1];

export function floodFillAlpha(opts: FloodFillOptions): FloodFillResult {
  const { source, seedX, seedY } = opts;
  const tolerance = Math.max(0, Math.min(255, opts.tolerance ?? 32));
  const requireOpaqueSeed = opts.requireOpaqueSeed ?? true;

  const w = source.width;
  const h = source.height;
  const mask = new Uint8ClampedArray(w * h); // initialised to 0
  const empty: FloodFillResult = { width: w, height: h, mask, area: 0, empty: true };

  if (w <= 0 || h <= 0) return empty;
  const sx = Math.floor(seedX);
  const sy = Math.floor(seedY);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return empty;

  // Read the source via getImageData. We accept HTMLCanvasElement
  // and OffscreenCanvas — both have a 2d context that returns a
  // compatible ImageData object.
  // biome-ignore lint/suspicious/noExplicitAny: 2d ctx union
  const ctx = (source as any).getContext("2d") as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) return empty;
  const data = ctx.getImageData(0, 0, w, h).data;

  const seedAlpha = data[(sy * w + sx) * 4 + 3];
  if (requireOpaqueSeed && seedAlpha === 0) return empty;

  // BFS queue. Encoded as (y * w + x) so we don't allocate a tuple
  // per push. Capacity is unbounded but in practice peaks at the
  // perimeter of the connected region.
  const queue: number[] = [sy * w + sx];
  let head = 0;

  // Optional clip test via a hidden canvas — Path2D isPointInPath
  // is on CanvasRenderingContext2D, so we need a context to evaluate.
  // For perf we lazy-allocate a 1×1 helper canvas only if `clip` is
  // present.
  let clipCtx: CanvasRenderingContext2D | null = null;
  if (opts.clip && typeof document !== "undefined") {
    const helper = document.createElement("canvas");
    helper.width = 1;
    helper.height = 1;
    clipCtx = helper.getContext("2d");
  }
  const clip = opts.clip ?? null;

  while (head < queue.length) {
    const idx = queue[head++];
    if (mask[idx] === 0xff) continue; // already visited
    const x = idx % w;
    const y = Math.floor(idx / w);

    const a = data[idx * 4 + 3];
    if (Math.abs(a - seedAlpha) > tolerance) continue;
    if (clip && clipCtx && !clipCtx.isPointInPath(clip, x, y)) continue;

    mask[idx] = 0xff;

    for (let n = 0; n < 4; n++) {
      const nx = x + NEIGHBOUR_DX[n];
      const ny = y + NEIGHBOUR_DY[n];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const nIdx = ny * w + nx;
      if (mask[nIdx] === 0xff) continue;
      queue.push(nIdx);
    }
  }

  let area = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) area++;
  return { width: w, height: h, mask, area, empty: area === 0 };
}

/**
 * Convert the 1-byte-per-pixel result mask into an RGBA canvas the
 * same size as the source. Painted pixels are opaque white; empty
 * pixels stay fully transparent. Used to feed `drawImage` into a
 * region's mask canvas via `globalCompositeOperation`.
 */
export function maskToCanvas(result: FloodFillResult): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = result.width;
  c.height = result.height;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  const img = ctx.createImageData(result.width, result.height);
  for (let i = 0; i < result.mask.length; i++) {
    const a = result.mask[i];
    img.data[i * 4 + 0] = 255;
    img.data[i * 4 + 1] = 255;
    img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = a;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
