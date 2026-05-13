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
 * Convert an inpaint-convention mask blob (RGB white = edit, alpha 255)
 * into the OpenAI gpt-image-2 mask convention (`alpha=0` = edit zone,
 * `alpha=255` = preserve), aligned to the OpenAI-padded source dims.
 *
 * Why this exists: gpt-image-2 treats atlas crops correctly — it
 * doesn't try to "complete" the silhouette into a character thumbnail
 * the way fal-general/inpainting does. But its mask convention is
 * inverted from the FLUX/SDXL standard our inpaint canvas produces.
 * This helper bakes both transforms at once:
 *   1. Bake the mask's luma → alpha (RGB white → alpha=0 edit; RGB
 *      black → alpha=255 preserve).
 *   2. Paste at `paddingOffset` inside a `canvasSize`² canvas so the
 *      mask dims match `prepareOpenAISource`'s padded output. OpenAI
 *      requires the mask and source to share dims exactly.
 *
 * Pixels outside `paddingOffset` (the white border `padToOpenAISquare`
 * adds around the silhouette) get alpha=255 = preserve. The model
 * never edits the border so the postprocess crop reads it as
 * untouched padding.
 */
export async function convertInpaintMaskToOpenAIPadded(
  inpaintMaskBlob: Blob,
  paddingOffset: { x: number; y: number; w: number; h: number },
  canvasSize: number,
): Promise<Blob> {
  // Decode the inpaint mask blob to an Image we can draw.
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("inpaint mask blob decode failed"));
    i.src = URL.createObjectURL(inpaintMaskBlob);
  });

  // Draw the mask into a temp canvas at the padded subrect to read
  // its RGB at the resampled scale.
  const inner = document.createElement("canvas");
  inner.width = paddingOffset.w;
  inner.height = paddingOffset.h;
  const innerCtx = inner.getContext("2d", { willReadFrequently: true });
  if (!innerCtx) throw new Error("inpaint mask convert 2d context unavailable");
  innerCtx.drawImage(img, 0, 0, paddingOffset.w, paddingOffset.h);
  URL.revokeObjectURL(img.src);

  const innerData = innerCtx.getImageData(0, 0, paddingOffset.w, paddingOffset.h);
  const inPx = innerData.data;
  // Re-encode pixel-by-pixel: luma → alpha. Convention inversion
  // bakes in here: edit (white) becomes alpha=0, preserve (black)
  // becomes alpha=255.
  for (let i = 0; i < inPx.length; i += 4) {
    const luma = (inPx[i] + inPx[i + 1] + inPx[i + 2]) / 3;
    inPx[i] = 255;
    inPx[i + 1] = 255;
    inPx[i + 2] = 255;
    inPx[i + 3] = luma >= 128 ? 0 : 255;
  }
  innerCtx.putImageData(innerData, 0, 0);

  // Compose into the final OpenAI-square mask. The whole canvas
  // starts as preserve (white RGB + alpha 255 everywhere) so border
  // pixels outside the source silhouette stay untouched.
  const out = document.createElement("canvas");
  out.width = canvasSize;
  out.height = canvasSize;
  const outCtx = out.getContext("2d");
  if (!outCtx) throw new Error("inpaint mask padded canvas 2d context unavailable");
  outCtx.fillStyle = "rgba(255,255,255,1)";
  outCtx.fillRect(0, 0, canvasSize, canvasSize);
  outCtx.drawImage(inner, paddingOffset.x, paddingOffset.y);

  return await new Promise<Blob>((resolve, reject) => {
    out.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error("openai-padded mask toBlob returned null"));
    }, "image/png");
  });
}
