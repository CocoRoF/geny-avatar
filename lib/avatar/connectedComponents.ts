"use client";

/**
 * Connected-component labeling for layer source canvases.
 *
 * Why this exists: a single rigged-puppet layer's atlas region can
 * contain multiple disjoint silhouettes (e.g. an "upper body" slot
 * holding both the torso mesh and a separate shoulder-frill mesh).
 * The AI generation pipeline used to treat the whole layer as one
 * subject — it'd union-bbox the disjoint islands, pad that to 1024²,
 * and the model would paint one centered subject. After alpha-enforce
 * the subject would land cookie-cuttered onto each island, with no
 * regard for what each island actually represents.
 *
 * This module finds the islands so callers can run a per-island
 * generate pass (each island fills the full 1024² frame and can be
 * prompted separately). Runs entirely client-side on a 2D canvas.
 */
export type ComponentInfo = {
  /** Stable index into the returned array. */
  id: number;
  /** Tight bbox of this component within the source canvas, in source pixels. */
  bbox: { x: number; y: number; w: number; h: number };
  /** Number of opaque pixels (alpha >= threshold) inside the bbox. */
  area: number;
  /**
   * Source-canvas-sized binary mask isolating this component. Alpha is
   * 255 inside the component, 0 elsewhere. Useful for multiplying
   * against the original source to produce an isolated per-component
   * canvas (one component's pixels visible, others zeroed out).
   */
  maskCanvas: HTMLCanvasElement;
};

export type FindComponentsOptions = {
  /** Pixels with alpha < this threshold are treated as background. */
  alphaThreshold?: number;
  /** Components with fewer pixels than this are dropped. Filters out
   *  AA-edge fragments / atlas gutter noise. */
  minArea?: number;
  /** Connectivity: 4 (cardinal) or 8 (with diagonals). 8 keeps thin
   *  diagonal silhouettes from getting split into a noisy stack of
   *  one-pixel components. */
  connectivity?: 4 | 8;
};

/**
 * Label connected components of opaque pixels in `canvas`. Returns at
 * most one component when the silhouette is a single connected blob,
 * or N when there are N disjoint silhouettes.
 *
 * Returns `[]` when the canvas is fully transparent.
 *
 * Implementation: two-pass union-find over a flat alpha buffer. Stays
 * O(W·H) in time, single allocation for the labels array.
 */
export function findAlphaComponents(
  canvas: HTMLCanvasElement,
  opts: FindComponentsOptions = {},
): ComponentInfo[] {
  const W = canvas.width;
  const H = canvas.height;
  if (W <= 0 || H <= 0) return [];
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];

  const alphaThreshold = opts.alphaThreshold ?? 1;
  const minArea = opts.minArea ?? 64;
  const connectivity = opts.connectivity ?? 8;

  const data = ctx.getImageData(0, 0, W, H).data;

  // labels[i] holds a positive root id for foreground pixels (alpha >=
  // threshold), -1 for background. We use 0 as "not yet assigned" so
  // we can distinguish first-touch from a real label.
  const labels = new Int32Array(W * H);
  const parents: number[] = [0]; // parents[0] is unused so root ids start at 1
  const rank: number[] = [0];

  function makeSet(): number {
    const id = parents.length;
    parents.push(id);
    rank.push(0);
    return id;
  }
  function findRoot(x: number): number {
    let r = x;
    while (parents[r] !== r) r = parents[r];
    // path compression
    let n = x;
    while (parents[n] !== r) {
      const next = parents[n];
      parents[n] = r;
      n = next;
    }
    return r;
  }
  function union(a: number, b: number): void {
    const ra = findRoot(a);
    const rb = findRoot(b);
    if (ra === rb) return;
    if (rank[ra] < rank[rb]) parents[ra] = rb;
    else if (rank[ra] > rank[rb]) parents[rb] = ra;
    else {
      parents[rb] = ra;
      rank[ra]++;
    }
  }

  // Pass 1: provisional labels. For each foreground pixel, look at the
  // already-labeled neighbors (above + left + diagonals when 8-conn);
  // pick the smallest, register equivalences with the others.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      if (data[idx * 4 + 3] < alphaThreshold) {
        labels[idx] = -1;
        continue;
      }
      const neighbors: number[] = [];
      if (y > 0) {
        const up = labels[idx - W];
        if (up > 0) neighbors.push(up);
        if (connectivity === 8) {
          if (x > 0) {
            const ul = labels[idx - W - 1];
            if (ul > 0) neighbors.push(ul);
          }
          if (x + 1 < W) {
            const ur = labels[idx - W + 1];
            if (ur > 0) neighbors.push(ur);
          }
        }
      }
      if (x > 0) {
        const left = labels[idx - 1];
        if (left > 0) neighbors.push(left);
      }
      if (neighbors.length === 0) {
        labels[idx] = makeSet();
      } else {
        let m = neighbors[0];
        for (let i = 1; i < neighbors.length; i++) if (neighbors[i] < m) m = neighbors[i];
        labels[idx] = m;
        for (const n of neighbors) if (n !== m) union(m, n);
      }
    }
  }

  // Pass 2: collapse to roots and accumulate per-component bbox / area.
  const stats = new Map<
    number,
    {
      minX: number;
      minY: number;
      maxX: number;
      maxY: number;
      area: number;
    }
  >();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      const lab = labels[idx];
      if (lab <= 0) continue;
      const root = findRoot(lab);
      labels[idx] = root;
      let s = stats.get(root);
      if (!s) {
        s = { minX: x, minY: y, maxX: x, maxY: y, area: 0 };
        stats.set(root, s);
      }
      if (x < s.minX) s.minX = x;
      if (x > s.maxX) s.maxX = x;
      if (y < s.minY) s.minY = y;
      if (y > s.maxY) s.maxY = y;
      s.area++;
    }
  }

  // Sort by area desc — biggest islands first (predictable UI ordering).
  const roots = Array.from(stats.entries())
    .filter(([_, s]) => s.area >= minArea)
    .sort((a, b) => b[1].area - a[1].area);

  return roots.map(([root, s], idx) => {
    const w = s.maxX - s.minX + 1;
    const h = s.maxY - s.minY + 1;
    // Build the canvas-sized binary mask. White (255) where this
    // component's pixels live, transparent elsewhere. Drawing this
    // back over the source with destination-in produces an isolated
    // canvas that contains only this component.
    const mask = document.createElement("canvas");
    mask.width = W;
    mask.height = H;
    const mctx = mask.getContext("2d");
    if (mctx) {
      const out = mctx.createImageData(W, H);
      let i = 0;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++, i++) {
          if (labels[y * W + x] === root) {
            out.data[i * 4 + 0] = 255;
            out.data[i * 4 + 1] = 255;
            out.data[i * 4 + 2] = 255;
            out.data[i * 4 + 3] = 255;
          }
        }
      }
      mctx.putImageData(out, 0, 0);
    }

    return {
      id: idx,
      bbox: { x: s.minX, y: s.minY, w, h },
      area: s.area,
      maskCanvas: mask,
    };
  });
}

/**
 * Multiply `source`'s alpha by `mask`'s alpha to produce an isolated
 * canvas. Used to derive a per-component source canvas (this island's
 * pixels visible, other islands transparent) before feeding into the
 * gpt-image-2 prep pipeline. The output is at source dims.
 */
export function isolateWithMask(
  source: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement,
): HTMLCanvasElement {
  const W = source.width;
  const H = source.height;
  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const ctx = out.getContext("2d");
  if (!ctx) return source;
  // Draw the source first, then keep only pixels whose mask alpha is
  // > 0. `destination-in` is the cheapest way to express that — the
  // GPU does the alpha multiply in one pass.
  ctx.drawImage(source, 0, 0);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(maskCanvas, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  return out;
}
