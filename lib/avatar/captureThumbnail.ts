"use client";

import type { Application } from "pixi.js";

/**
 * Capture a downscaled WEBP snapshot of the current Pixi stage.
 *
 * `app.canvas` can read black on browsers that don't preserve the WebGL
 * drawing buffer between frames, so we route through `extract.canvas` —
 * Pixi re-renders the stage into a fresh offscreen target, which is
 * always readable.
 *
 * Returned blob is suitable for IndexedDB storage (~5-15 KB at 256px/0.85).
 */
export async function captureThumbnail(
  app: Application,
  sizePx = 256,
  quality = 0.85,
): Promise<Blob | null> {
  // wait one rAF so the puppet has a chance to render after mount
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  const extracted = (await app.renderer.extract.canvas(app.stage)) as HTMLCanvasElement;
  if (!extracted.width || !extracted.height) return null;

  const scale = Math.min(sizePx / extracted.width, sizePx / extracted.height, 1);
  const w = Math.max(1, Math.round(extracted.width * scale));
  const h = Math.max(1, Math.round(extracted.height * scale));

  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(extracted, 0, 0, w, h);

  return await new Promise<Blob | null>((resolve) => {
    out.toBlob((b) => resolve(b), "image/webp", quality);
  });
}
