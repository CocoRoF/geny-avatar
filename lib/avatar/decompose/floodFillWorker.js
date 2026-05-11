/**
 * Flood-fill worker — runs the BFS off the main thread so a big
 * magic-wand click can't freeze the editor.
 *
 * Plain JS (not TS) on purpose: Next.js emits worker URLs under
 * static/media/ keeping the source's extension; a `.ts` extension is
 * served with MIME `video/mp2t` (the IANA mapping for MPEG-TS
 * streams), which strict module-script loaders refuse, so the worker
 * silently never instantiates. Plain JS files come back as
 * `application/javascript` and load fine. The shared message
 * protocol types live in `floodFillWorker.types.ts` for the client
 * side; here we use JSDoc for documentation only.
 *
 * @typedef {"alpha"|"luminance"|"rgb"} SampleMode
 *
 * @typedef {Object} FloodRequest
 * @property {number} id
 * @property {Uint8ClampedArray} pixels    RGBA, transferable
 * @property {number} width
 * @property {number} height
 * @property {number} seedX
 * @property {number} seedY
 * @property {number} tolerance            0..255
 * @property {SampleMode} sampleMode
 * @property {number} sampleSize           1, 3, 5, 11 — averaged seed
 * @property {boolean} contiguous          true = BFS, false = scan-all
 * @property {boolean} antiAlias           soft 1-px gradient at boundary
 *
 * @typedef {Object} FloodResponse
 * @property {number} id
 * @property {Uint8ClampedArray} mask
 * @property {number} area
 */

const NEIGHBOUR_DX = [1, -1, 0, 0];
const NEIGHBOUR_DY = [0, 0, 1, -1];

self.onmessage = (ev) => {
  /** @type {FloodRequest} */
  const req = ev.data;
  const res = floodFill(req);
  self.postMessage(res, [res.mask.buffer]);
};

/**
 * @param {FloodRequest} req
 * @returns {FloodResponse}
 */
function floodFill(req) {
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
    // Empty seed alpha — nothing to flood.
    return { id: req.id, mask, area: 0 };
  }

  const distance = makeDistance(sampleMode, seed);

  if (!contiguous) {
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

  const queue = [seedY * w + seedX];
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

/**
 * Sample a window of `size` × `size` pixels centred on (x, y) and
 * return the averaged RGBA. size=1 falls through to a single tap.
 * Out-of-bounds taps are clamped to the edge.
 */
function sampleAt(pixels, w, h, x, y, size) {
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

function makeDistance(mode, seed) {
  if (mode === "alpha") {
    return (px, idx) => {
      const a = px[idx * 4 + 3];
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
  // rgb — max-channel distance, Photoshop-style.
  return (px, idx) => {
    const i = idx * 4;
    const a = px[i + 3];
    if (a === 0) return Number.POSITIVE_INFINITY;
    const dr = px[i] - seed.r;
    const dg = px[i + 1] - seed.g;
    const db = px[i + 2] - seed.b;
    return Math.max(Math.abs(dr), Math.abs(dg), Math.abs(db));
  };
}

/** One-pass 1-pixel feather: any boundary pixel (mask transitions
 *  inside↔outside) gets its alpha softened to 0x80. */
function feather1px(mask, w, h) {
  const src = mask.slice();
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (src[i] !== 0xff) continue;
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
