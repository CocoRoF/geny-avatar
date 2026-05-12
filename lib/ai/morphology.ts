/**
 * Morphological alpha operations for the AI generate pipeline.
 *
 * Used by `postprocessGeneratedBlob` to erode the alpha-enforce mask
 * a few pixels inward before multiplying against the result. This
 * prevents seam contamination at atlas-island boundaries: gpt-image-2
 * happily paints anti-aliased pixels right up to (and a couple past)
 * the silhouette edge, and atlas pages pack islands as close as 4 px
 * apart. Without erosion those edge pixels leak onto neighbour
 * islands when the result is composited back to the atlas page.
 *
 * Erosion radius rule of thumb: silhouette short-side / 100, clamped
 * to [2, 8] px. Small components get small erosion (so we don't eat
 * the whole drawable on a tiny ribbon), large ones get a safer margin.
 */

/**
 * In-place grayscale erosion on the alpha channel of `imageData`.
 *
 * Implementation: separable min filter in two passes (horizontal,
 * then vertical). Window size is `2 * radius + 1` square. Soft alpha
 * edges erode proportionally — a pixel at 200 next to a pixel at 0
 * becomes 0 after one pass through, which is the behaviour we want
 * (anti-aliased silhouette boundaries shrink inward by `radius` px).
 *
 * No-op when `radius <= 0`. Safe to call on any ImageData.
 */
export function erodeAlphaInPlace(imageData: ImageData, radius: number): void {
  if (radius <= 0) return;
  const W = imageData.width;
  const H = imageData.height;
  const data = imageData.data;
  if (W <= 0 || H <= 0) return;

  // Lift the alpha plane into a tight buffer. Two passes over a
  // Uint8Array beats two passes over a strided RGBA Uint8ClampedArray
  // by ~2× — the inner loop sees one byte per pixel instead of
  // jumping four bytes at a time.
  const N = W * H;
  const alphaIn = new Uint8Array(N);
  for (let i = 0, j = 0; j < N; i += 4, j++) {
    alphaIn[j] = data[i + 3];
  }

  // Horizontal pass: min over [x - r, x + r] for each row.
  const horiz = new Uint8Array(N);
  for (let y = 0; y < H; y++) {
    const rowBase = y * W;
    for (let x = 0; x < W; x++) {
      const x0 = x - radius < 0 ? 0 : x - radius;
      const x1 = x + radius > W - 1 ? W - 1 : x + radius;
      let m = 255;
      for (let xi = x0; xi <= x1; xi++) {
        const v = alphaIn[rowBase + xi];
        if (v < m) {
          m = v;
          if (m === 0) break;
        }
      }
      horiz[rowBase + x] = m;
    }
  }

  // Vertical pass: min over [y - r, y + r] for each column. Write
  // results directly back into the RGBA data buffer's alpha byte.
  for (let y = 0; y < H; y++) {
    const y0 = y - radius < 0 ? 0 : y - radius;
    const y1 = y + radius > H - 1 ? H - 1 : y + radius;
    for (let x = 0; x < W; x++) {
      let m = 255;
      for (let yi = y0; yi <= y1; yi++) {
        const v = horiz[yi * W + x];
        if (v < m) {
          m = v;
          if (m === 0) break;
        }
      }
      data[(y * W + x) * 4 + 3] = m;
    }
  }
}

/**
 * Default erosion radius for a postprocess alpha-enforce mask, given
 * the silhouette bbox short side (or canvas short side as fallback).
 *
 * Rule: shortSide / 100, clamped to [2, 8]. A 600 px silhouette gets
 * 6 px erosion, a 50 px ribbon gets 2 px, a 1600 px head gets 8 px.
 */
export function defaultAlphaErodeRadius(shortSide: number): number {
  if (!Number.isFinite(shortSide) || shortSide <= 0) return 0;
  const raw = Math.round(shortSide / 100);
  if (raw < 2) return 2;
  if (raw > 8) return 8;
  return raw;
}
