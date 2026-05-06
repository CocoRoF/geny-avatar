"use client";

import { useEffect, useState } from "react";
import type { AvatarAdapter, TextureSourceInfo } from "../adapters/AvatarAdapter";
import type { Layer } from "./types";

const THUMB_PX = 48;
const QUALITY = 0.85;

/**
 * Lazy thumbnail for a single layer. Crops the layer's atlas region out
 * of the underlying texture page (via the adapter), resamples to a small
 * webp, and exposes a blob URL for `<img src>`. Returns `null` when the
 * layer has no texture slice (e.g. Cubism layers until sprint 2.2 lands)
 * or when the page bitmap isn't available.
 *
 * The url is revoked on unmount / dependency change so we don't leak.
 */
export function useLayerThumbnail(adapter: AvatarAdapter | null, layer: Layer): string | null {
  const [url, setUrl] = useState<string | null>(null);
  // `layer` comes from the editor store; its reference is stable until
  // the avatar is reloaded, so `layer.texture` is also stable. We can
  // depend on the slice object directly without memoizing a string key.
  const slice = layer.texture;
  const layerName = layer.name;

  useEffect(() => {
    if (!adapter || !slice) {
      setUrl(null);
      return;
    }
    const source = adapter.getTextureSource(slice.textureId);
    if (!source) {
      setUrl(null);
      return;
    }

    let cancelled = false;
    let created: string | null = null;
    void (async () => {
      try {
        const blob = await cropAtlasRegion(source, slice.rect, slice.rotated ?? false);
        if (cancelled || !blob) return;
        created = URL.createObjectURL(blob);
        setUrl(created);
      } catch (e) {
        console.warn(`[layerThumb] failed for ${layerName}`, e);
      }
    })();

    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [adapter, slice, layerName]);

  return url;
}

/**
 * Crop a sub-rect from `source.image` into a square thumbnail. When the
 * region was packed 90 degrees clockwise into the atlas (`rotated`), the
 * canvas is rotated counter-clockwise so the thumbnail shows the layer
 * upright.
 */
async function cropAtlasRegion(
  source: TextureSourceInfo,
  rect: { x: number; y: number; w: number; h: number },
  rotated: boolean,
): Promise<Blob | null> {
  if (rect.w <= 0 || rect.h <= 0) return null;

  // Unrotated display dimensions: when the region is rotated 90deg on
  // the page, the on-page width/height are swapped relative to the
  // upright image we want to render.
  const upW = rotated ? rect.h : rect.w;
  const upH = rotated ? rect.w : rect.h;

  const scale = Math.min(THUMB_PX / upW, THUMB_PX / upH, 1);
  const drawW = Math.max(1, Math.round(upW * scale));
  const drawH = Math.max(1, Math.round(upH * scale));
  const dx = Math.round((THUMB_PX - drawW) / 2);
  const dy = Math.round((THUMB_PX - drawH) / 2);

  const out = document.createElement("canvas");
  out.width = THUMB_PX;
  out.height = THUMB_PX;
  const ctx = out.getContext("2d");
  if (!ctx) return null;

  if (rotated) {
    // Pixels at (rect.x, rect.y, rect.w, rect.h) are sideways. Rotating
    // the canvas -90deg (CCW) before drawing makes them land upright.
    ctx.save();
    ctx.translate(dx + drawW / 2, dy + drawH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(
      source.image,
      rect.x,
      rect.y,
      rect.w,
      rect.h,
      -drawH / 2,
      -drawW / 2,
      drawH,
      drawW,
    );
    ctx.restore();
  } else {
    ctx.drawImage(source.image, rect.x, rect.y, rect.w, rect.h, dx, dy, drawW, drawH);
  }

  return await new Promise<Blob | null>((resolve) => {
    out.toBlob((b) => resolve(b), "image/webp", QUALITY);
  });
}
