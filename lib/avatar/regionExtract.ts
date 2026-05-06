"use client";

import type { TextureSourceInfo } from "../adapters/AvatarAdapter";
import type { Rect } from "./types";

/**
 * Crop a region out of an atlas page bitmap into its own canvas, at
 * native pixel resolution. When the region was packed sideways
 * (`rotated: true` from spine v4 atlas), we un-rotate so callers always
 * get the layer upright.
 *
 * Returns `null` only when the slice is degenerate (zero area) or when
 * a 2D context can't be acquired. For thumbnails see `useLayerThumbnail`;
 * this is the path used by DecomposeStudio for full-resolution editing.
 */
export function extractRegionCanvas(
  source: TextureSourceInfo,
  rect: Rect,
  rotated: boolean,
): HTMLCanvasElement | null {
  if (rect.w <= 0 || rect.h <= 0) return null;

  const upW = rotated ? rect.h : rect.w;
  const upH = rotated ? rect.w : rect.h;

  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(upW));
  out.height = Math.max(1, Math.round(upH));
  const ctx = out.getContext("2d");
  if (!ctx) return null;

  if (rotated) {
    ctx.save();
    ctx.translate(out.width / 2, out.height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(
      source.image,
      rect.x,
      rect.y,
      rect.w,
      rect.h,
      -out.height / 2,
      -out.width / 2,
      out.height,
      out.width,
    );
    ctx.restore();
  } else {
    ctx.drawImage(source.image, rect.x, rect.y, rect.w, rect.h, 0, 0, out.width, out.height);
  }

  return out;
}
