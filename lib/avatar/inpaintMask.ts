"use client";

/**
 * Build the binary mask an inpainting provider expects, derived from
 * the source canvas's alpha channel.
 *
 * Why this exists separately from `lib/store/editor.layerMasks`:
 *
 * DecomposeStudio's "mask" is a destination-out hide tool —
 * `alpha=255` marks pixels the user wants ERASED from the final
 * baked atlas. Sending that as an inpainting mask is exactly
 * backwards: every diffusion inpainter we use reads `alpha=255` (or
 * RGB white) as "REGENERATE this pixel". Forwarding the Decompose
 * mask makes the inpainter rewrite the parts the user wanted to
 * hide and preserve the parts they wanted to keep. The two concepts
 * collide.
 *
 * The natural default for a Live2D texture layer is: the entire
 * component (every pixel where `alpha > 0` in the source) is the
 * edit zone. The user picked this layer because they want it edited;
 * the rest of the atlas isn't even in the source crop. So we derive
 * the mask from the source alpha itself — opaque source pixels →
 * white in the mask, transparent source pixels → black. The result
 * matches the standard FLUX / SDXL inpainting convention.
 *
 * If the user later wants partial-component edits ("only the bangs,
 * not the side hair"), GeneratePanel can grow its own mask brush
 * surface that produces output in this same convention. Decompose's
 * mask stays separate, with its own destination-out semantics.
 */

const ALPHA_EDIT_THRESHOLD = 1;

/**
 * Convert a source canvas to a binary white-on-black PNG suitable
 * for an inpainting model's `mask` / `mask_url` input.
 *
 * - Alpha ≥ threshold → RGB white (255,255,255).
 * - Alpha < threshold → RGB black (0,0,0).
 * - Output alpha is always 255 (opaque) so providers that read RGB
 *   luma instead of the alpha channel get the same answer.
 */
export async function buildInpaintMaskFromAlpha(sourceCanvas: HTMLCanvasElement): Promise<Blob> {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  if (w <= 0 || h <= 0) throw new Error("source canvas has zero dimensions");

  const srcCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
  if (!srcCtx) throw new Error("source canvas 2d context unavailable");
  const srcData = srcCtx.getImageData(0, 0, w, h);

  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const outCtx = out.getContext("2d");
  if (!outCtx) throw new Error("mask canvas 2d context unavailable");
  const outData = outCtx.createImageData(w, h);

  const src = srcData.data;
  const dst = outData.data;
  for (let i = 0; i < src.length; i += 4) {
    const v = src[i + 3] >= ALPHA_EDIT_THRESHOLD ? 255 : 0;
    dst[i] = v;
    dst[i + 1] = v;
    dst[i + 2] = v;
    dst[i + 3] = 255;
  }
  outCtx.putImageData(outData, 0, 0);

  return await new Promise<Blob>((resolve, reject) => {
    out.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error("inpaint mask toBlob returned null"));
    }, "image/png");
  });
}

/**
 * Pad an inpaint-convention mask blob (RGB white = edit, RGB black =
 * preserve) onto an OpenAI-padded square frame WITHOUT inverting the
 * convention. Used when the mask travels as an `image[]` reference
 * hint (not a hard inpaint mask), so the model reads "[image N] is a
 * white-on-black region hint" via the prompt scaffold.
 *
 * Output: white inside the silhouette offset (matches the original
 * mask), black everywhere else (the padded border preserves). Alpha
 * always 255 — keeps the multi-image edit pipeline happy regardless
 * of whether the model reads alpha or luma.
 */
/**
 * Region variant of `padInpaintMaskRefToOpenAI`: the mask blob is at
 * full layer dims, but the source being sent is a TIGHT CROP
 * (`sourceBBox` in layer space) padded into a square at
 * `paddingOffset`. Crop the matching mask subrect and place it at the
 * same offset so the hint actually aligns with image[1] — sending the
 * full-layer mask raw made the prompt's "same dimensions and
 * alignment" claim false for every multi-region call.
 */
export async function padInpaintMaskRegionRefToOpenAI(
  inpaintMaskBlob: Blob,
  sourceBBox: { x: number; y: number; w: number; h: number },
  paddingOffset: { x: number; y: number; w: number; h: number },
  canvasSize: number,
): Promise<Blob> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("inpaint mask region ref blob decode failed"));
    i.src = URL.createObjectURL(inpaintMaskBlob);
  });

  const out = document.createElement("canvas");
  out.width = canvasSize;
  out.height = canvasSize;
  const ctx = out.getContext("2d");
  if (!ctx) {
    URL.revokeObjectURL(img.src);
    throw new Error("padInpaintMaskRegionRefToOpenAI 2d context unavailable");
  }
  ctx.fillStyle = "rgb(0,0,0)";
  ctx.fillRect(0, 0, canvasSize, canvasSize);
  ctx.drawImage(
    img,
    sourceBBox.x,
    sourceBBox.y,
    sourceBBox.w,
    sourceBBox.h,
    paddingOffset.x,
    paddingOffset.y,
    paddingOffset.w,
    paddingOffset.h,
  );
  URL.revokeObjectURL(img.src);

  return await new Promise<Blob>((resolve, reject) => {
    out.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error("padded inpaint mask region ref toBlob returned null"));
    }, "image/png");
  });
}

export async function padInpaintMaskRefToOpenAI(
  inpaintMaskBlob: Blob,
  paddingOffset: { x: number; y: number; w: number; h: number },
  canvasSize: number,
): Promise<Blob> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("inpaint mask ref blob decode failed"));
    i.src = URL.createObjectURL(inpaintMaskBlob);
  });

  const out = document.createElement("canvas");
  out.width = canvasSize;
  out.height = canvasSize;
  const ctx = out.getContext("2d");
  if (!ctx) {
    URL.revokeObjectURL(img.src);
    throw new Error("padInpaintMaskRefToOpenAI 2d context unavailable");
  }
  ctx.fillStyle = "rgb(0,0,0)";
  ctx.fillRect(0, 0, canvasSize, canvasSize);
  ctx.drawImage(img, paddingOffset.x, paddingOffset.y, paddingOffset.w, paddingOffset.h);
  URL.revokeObjectURL(img.src);

  return await new Promise<Blob>((resolve, reject) => {
    out.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error("padded inpaint mask ref toBlob returned null"));
    }, "image/png");
  });
}
