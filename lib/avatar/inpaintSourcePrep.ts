"use client";

/**
 * Source pre-processing for inpainting endpoints.
 *
 * Why this exists: fal-general/inpainting (and similar mask-aware
 * diffusion endpoints) treat an isolated atlas crop as "a character
 * thumbnail with a transparent background" and happily fill the
 * silhouette with a complete character — face, body, accessories —
 * instead of just repainting the texture region the mask marks. The
 * prompt scaffold can push back ("DO NOT add face / body") but the
 * strongest signal is the source itself: when the model sees a
 * neutral-grey background instead of transparency, the silhouette
 * stops reading as "outline of a character to draw" and starts
 * reading as "texture region embedded in a frame".
 *
 * This module bakes the layer's transparent area to neutral grey
 * before we hand the blob to the inpaint provider. The mask channel
 * is unaffected (still RGB white = edit, RGB black = preserve) so
 * the model only repaints inside the silhouette; the grey backdrop
 * just gives the prior something benign to anchor on.
 */

/** Neutral 50% grey — picked over white/black so it doesn't bias the
 *  inpainter toward a specific colour direction inside the
 *  silhouette. Same value Photoshop's default canvas uses. */
const NEUTRAL_BG_RGB: readonly [number, number, number] = [127, 127, 127];

/**
 * Take a source canvas (with alpha-clipped silhouette) and return a
 * PNG blob where every transparent pixel is filled with neutral grey
 * while the silhouette interior is preserved at full opacity. Output
 * dims match the input.
 *
 * This is destructive on a *copy* — the input canvas is untouched.
 */
export async function bakeTransparencyToNeutral(sourceCanvas: HTMLCanvasElement): Promise<Blob> {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  if (w <= 0 || h <= 0) throw new Error("source canvas has zero dimensions");

  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("inpaint-source 2d context unavailable");

  // Fill the whole frame with the neutral background first, then
  // draw the source silhouette on top. Source pixels at alpha=255
  // win; transparent pixels remain grey.
  ctx.fillStyle = `rgb(${NEUTRAL_BG_RGB.join(",")})`;
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(sourceCanvas, 0, 0);

  // Force every pixel opaque — some diffusion endpoints honour alpha
  // as a soft mask. We want the background grey to be solid and the
  // silhouette interior to keep its original colours at full opacity.
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    px[i + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);

  return await new Promise<Blob>((resolve, reject) => {
    out.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error("inpaint source toBlob returned null"));
    }, "image/png");
  });
}
