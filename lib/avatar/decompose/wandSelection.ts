/**
 * Selection-bitmap ops for the magic wand.
 *
 * The wand owns an HTMLCanvasElement at source dimensions; pixels
 * with non-zero alpha are "selected". Everything in here operates
 * on that canvas in place (or returns a new one of the same size).
 *
 * Photoshop-equivalent capabilities exposed:
 *   - compose (replace / add / subtract / intersect)
 *   - invert  (within the source's own footprint, not the whole
 *              bounding canvas — otherwise the user would always
 *              end up selecting the bbox padding which is useless)
 *   - grow / shrink  (morphological dilate / erode by N pixels via
 *                     box-filtered alpha thresholding)
 *   - feather        (Gaussian-ish blur on alpha, soft edge)
 *   - area           (cheap count for the status readout)
 *
 * The wand BFS itself lives in floodFillWorker — this module is the
 * post-processing toolkit the user runs after a selection exists.
 */

export type SelectionCompose = "replace" | "add" | "subtract" | "intersect";

/** Compose `incoming` into `existing` with the given op. Mutates
 *  `existing`; returns it for chaining. Both canvases must be the
 *  same dimensions. */
export function composeSelection(
  existing: HTMLCanvasElement,
  incoming: HTMLCanvasElement,
  op: SelectionCompose,
): HTMLCanvasElement {
  const ctx = existing.getContext("2d");
  if (!ctx) return existing;
  if (op === "replace") {
    ctx.clearRect(0, 0, existing.width, existing.height);
    ctx.drawImage(incoming, 0, 0);
    return existing;
  }
  ctx.globalCompositeOperation =
    op === "add" ? "source-over" : op === "subtract" ? "destination-out" : "destination-in";
  ctx.drawImage(incoming, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  return existing;
}

/** Invert the selection within the source's own footprint. Returns
 *  a fresh canvas — caller swaps it in. The source's alpha defines
 *  the universe to invert against; outside the puppet the selection
 *  stays empty (there's nothing meaningful out there). */
export function invertSelection(
  selection: HTMLCanvasElement,
  source: HTMLCanvasElement,
): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = selection.width;
  out.height = selection.height;
  const ctx = out.getContext("2d");
  if (!ctx) return out;
  // Start with the source's footprint (anywhere source has alpha).
  ctx.drawImage(source, 0, 0, out.width, out.height);
  // Recolor any source-opaque pixel to opaque white — gives us a
  // mask of "everywhere the user could possibly select".
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, out.width, out.height);
  // Subtract the existing selection — what's left is the inversion.
  ctx.globalCompositeOperation = "destination-out";
  ctx.drawImage(selection, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  return out;
}

/** Grow the selection by `px` pixels via morphological dilation.
 *  Implemented as `px` rounds of a 3×3 max filter. Cheap for small
 *  px values (1-10); for larger growths use feather + threshold
 *  instead. Returns a fresh canvas. */
export function growSelection(selection: HTMLCanvasElement, px: number): HTMLCanvasElement {
  return morphology(selection, px, "dilate");
}

/** Shrink the selection by `px` pixels via morphological erosion. */
export function shrinkSelection(selection: HTMLCanvasElement, px: number): HTMLCanvasElement {
  return morphology(selection, px, "erode");
}

function morphology(
  selection: HTMLCanvasElement,
  px: number,
  op: "dilate" | "erode",
): HTMLCanvasElement {
  const w = selection.width;
  const h = selection.height;
  if (px <= 0 || w <= 0 || h <= 0) return selection;
  const src = selection.getContext("2d");
  if (!src) return selection;
  const cur = src.getImageData(0, 0, w, h).data;
  // Work in a single-byte alpha buffer for tight inner loops.
  let buf = new Uint8Array(w * h);
  for (let i = 0; i < buf.length; i++) buf[i] = cur[i * 4 + 3];
  let next = new Uint8Array(w * h);
  const isMax = op === "dilate";

  for (let pass = 0; pass < px; pass++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = buf[y * w + x];
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= w) continue;
            const nv = buf[ny * w + nx];
            if (isMax ? nv > v : nv < v) v = nv;
          }
        }
        next[y * w + x] = v;
      }
    }
    [buf, next] = [next, buf];
  }

  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const octx = out.getContext("2d");
  if (!octx) return out;
  const img = octx.createImageData(w, h);
  for (let i = 0; i < buf.length; i++) {
    img.data[i * 4 + 0] = 255;
    img.data[i * 4 + 1] = 255;
    img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = buf[i];
  }
  octx.putImageData(img, 0, 0);
  return out;
}

/** Feather the selection edge by `px`. Approximated by chaining
 *  CanvasFilter blur — supported on every browser the editor
 *  targets. Returns a fresh canvas with softened alpha. */
export function featherSelection(selection: HTMLCanvasElement, px: number): HTMLCanvasElement {
  if (px <= 0) return selection;
  const out = document.createElement("canvas");
  out.width = selection.width;
  out.height = selection.height;
  const ctx = out.getContext("2d");
  if (!ctx) return out;
  // `filter` is widely supported; if it's missing we fall through
  // to plain drawImage so the result is no-op rather than blank.
  try {
    ctx.filter = `blur(${px}px)`;
  } catch {
    // ignore
  }
  ctx.drawImage(selection, 0, 0);
  ctx.filter = "none";
  return out;
}

/** Count the non-zero alpha pixels in the selection. O(W*H) and
 *  alloc-heavy because of `getImageData`; only call after a
 *  user-driven mutation, never per frame. */
export function selectionArea(selection: HTMLCanvasElement): number {
  const ctx = selection.getContext("2d");
  if (!ctx) return 0;
  const data = ctx.getImageData(0, 0, selection.width, selection.height).data;
  let area = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) area++;
  return area;
}

/** Build the 1-pixel boundary mask of a selection (the marching-ants
 *  outline source). Pixel is in the boundary when it's inside and
 *  any 4-neighbour is outside. Returned canvas is opaque-white at
 *  the boundary, transparent elsewhere. */
export function selectionOutline(selection: HTMLCanvasElement): HTMLCanvasElement {
  const w = selection.width;
  const h = selection.height;
  const src = selection.getContext("2d");
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const octx = out.getContext("2d");
  if (!src || !octx) return out;
  const data = src.getImageData(0, 0, w, h).data;
  const img = octx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const a = data[i * 4 + 3];
      if (a === 0) continue;
      // Boundary test — at least one 4-neighbour is out of selection.
      const left = x > 0 ? data[(i - 1) * 4 + 3] : 0;
      const right = x < w - 1 ? data[(i + 1) * 4 + 3] : 0;
      const up = y > 0 ? data[(i - w) * 4 + 3] : 0;
      const down = y < h - 1 ? data[(i + w) * 4 + 3] : 0;
      if (left === 0 || right === 0 || up === 0 || down === 0) {
        img.data[i * 4 + 0] = 255;
        img.data[i * 4 + 1] = 255;
        img.data[i * 4 + 2] = 255;
        img.data[i * 4 + 3] = 255;
      }
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}
