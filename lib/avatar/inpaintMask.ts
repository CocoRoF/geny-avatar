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
