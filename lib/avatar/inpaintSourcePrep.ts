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

export type OversizedFramePadding = {
  /** Where the original silhouette sits inside the padded frame. */
  paddingOffset: { x: number; y: number; w: number; h: number };
  /** The padded frame's square dimension. */
  canvasSize: number;
  /** Original source dimensions, echoed for the postprocess crop. */
  sourceBBox: { x: number; y: number; w: number; h: number };
};

/**
 * Pad the source canvas into an oversized square frame, with the
 * silhouette centered and the surrounding area filled with neutral
 * grey. Returns the padded blob alongside the offset metadata the
 * caller needs to (a) align the inpaint mask to the same frame and
 * (b) crop the model's result back to atlas dimensions.
 *
 * Why "oversized": when the silhouette fills the whole frame (the
 * naive PR #25 behaviour), the inpaint model treats the silhouette
 * as the outline of a character to fully draw — face, body, props,
 * everything — because that's the strongest prior it learned during
 * training. Shrinking the silhouette to a small region of a larger
 * frame breaks that prior: a hair-shaped patch sitting inside a
 * 3× grey canvas reads as "a clipped texture region", not "the
 * silhouette of a complete character to fill in".
 *
 * `scale` defaults to 3 — 3× the longer source side, padded to a
 * square. Bumps to 4+ may help on stubborn models; lower than 2 lets
 * the silhouette dominate the frame again.
 */
export async function bakeTransparencyToNeutral(
  sourceCanvas: HTMLCanvasElement,
  options: { scale?: number; minSize?: number } = {},
): Promise<{ blob: Blob; padding: OversizedFramePadding }> {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  if (w <= 0 || h <= 0) throw new Error("source canvas has zero dimensions");

  const scale = options.scale ?? 3;
  const minSize = options.minSize ?? 512;
  const longest = Math.max(w, h);
  const canvasSize = Math.max(minSize, Math.round(longest * scale));
  const offsetX = Math.floor((canvasSize - w) / 2);
  const offsetY = Math.floor((canvasSize - h) / 2);

  const out = document.createElement("canvas");
  out.width = canvasSize;
  out.height = canvasSize;
  const ctx = out.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("inpaint-source 2d context unavailable");

  // Fill the whole frame with neutral grey first; the silhouette gets
  // drawn on top at the centre offset.
  ctx.fillStyle = `rgb(${NEUTRAL_BG_RGB.join(",")})`;
  ctx.fillRect(0, 0, canvasSize, canvasSize);
  ctx.drawImage(sourceCanvas, offsetX, offsetY);

  // Force every pixel opaque — some diffusion endpoints honour alpha
  // as a soft mask. We want the background grey to be solid and the
  // silhouette interior to keep its colours.
  const data = ctx.getImageData(0, 0, canvasSize, canvasSize);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    px[i + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);

  const blob = await new Promise<Blob>((resolve, reject) => {
    out.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error("inpaint source toBlob returned null"));
    }, "image/png");
  });

  return {
    blob,
    padding: {
      paddingOffset: { x: offsetX, y: offsetY, w, h },
      canvasSize,
      sourceBBox: { x: 0, y: 0, w, h },
    },
  };
}

/**
 * Pad an inpaint-convention mask blob (RGB white = edit, RGB black =
 * preserve) onto an oversized square frame so its dims line up with
 * the source from `bakeTransparencyToNeutral`. Everything outside the
 * silhouette offset reads as RGB black (preserve) — the inpainter
 * leaves the grey padding alone.
 */
export async function padInpaintMaskToFrame(
  maskBlob: Blob,
  padding: OversizedFramePadding,
): Promise<Blob> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("inpaint mask blob decode failed"));
    i.src = URL.createObjectURL(maskBlob);
  });

  const out = document.createElement("canvas");
  out.width = padding.canvasSize;
  out.height = padding.canvasSize;
  const ctx = out.getContext("2d");
  if (!ctx) {
    URL.revokeObjectURL(img.src);
    throw new Error("inpaint mask padding 2d context unavailable");
  }
  ctx.fillStyle = "rgb(0,0,0)";
  ctx.fillRect(0, 0, padding.canvasSize, padding.canvasSize);
  ctx.drawImage(
    img,
    padding.paddingOffset.x,
    padding.paddingOffset.y,
    padding.paddingOffset.w,
    padding.paddingOffset.h,
  );
  URL.revokeObjectURL(img.src);

  return await new Promise<Blob>((resolve, reject) => {
    out.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error("padded inpaint mask toBlob returned null"));
    }, "image/png");
  });
}
