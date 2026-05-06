"use client";

import { useEffect, useState } from "react";
import type { AvatarAdapter } from "../adapters/AvatarAdapter";
import { extractLayerCanvas } from "./regionExtract";
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

    let cancelled = false;
    let created: string | null = null;
    void (async () => {
      try {
        const extracted = extractLayerCanvas(adapter, layer);
        if (!extracted) return;
        const blob = await downscaleToBlob(extracted.canvas);
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
  }, [adapter, slice, layer, layerName]);

  return url;
}

/**
 * Resample an upright (already triangle-clipped) layer canvas down to
 * a square webp thumbnail. The hard work — atlas crop, rotation, clip —
 * is done by `extractLayerCanvas` so this is a pure scale + encode.
 */
async function downscaleToBlob(layerCanvas: HTMLCanvasElement): Promise<Blob | null> {
  if (!layerCanvas.width || !layerCanvas.height) return null;

  const scale = Math.min(THUMB_PX / layerCanvas.width, THUMB_PX / layerCanvas.height, 1);
  const drawW = Math.max(1, Math.round(layerCanvas.width * scale));
  const drawH = Math.max(1, Math.round(layerCanvas.height * scale));
  const dx = Math.round((THUMB_PX - drawW) / 2);
  const dy = Math.round((THUMB_PX - drawH) / 2);

  const out = document.createElement("canvas");
  out.width = THUMB_PX;
  out.height = THUMB_PX;
  const ctx = out.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(layerCanvas, 0, 0, layerCanvas.width, layerCanvas.height, dx, dy, drawW, drawH);

  return await new Promise<Blob | null>((resolve) => {
    out.toBlob((b) => resolve(b), "image/webp", QUALITY);
  });
}
