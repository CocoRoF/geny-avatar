"use client";

import type { Texture as PixiTexture } from "pixi.js";
import type { Layer, LayerId, TextureId } from "../avatar/types";
import type { TextureSourceInfo } from "./AvatarAdapter";

/**
 * Apply a set of per-layer masks to texture pages and re-upload to the
 * GPU so the live render reflects them. Shared by both adapters because
 * the actual page mutation logic is runtime-agnostic — only the source
 * lookup differs.
 *
 * For each affected page we start from the original bitmap (kept in
 * `textureSources`) so masks always layer onto pristine atlas pixels.
 * Per-layer mask blobs are rotated back into atlas orientation when the
 * region was packed sideways, then composited with `destination-out` so
 * mask alpha=255 wipes the page pixel to transparent.
 */
export async function applyLayerMasks(
  masks: Readonly<Record<LayerId, Blob>>,
  findLayer: (id: LayerId) => Layer | null,
  textureSources: ReadonlyMap<TextureId, TextureSourceInfo>,
  pixiTextures: ReadonlyMap<TextureId, PixiTexture>,
): Promise<void> {
  // Group affected pages → affecting layers (with valid texture slices)
  const layersByPage = new Map<TextureId, Layer[]>();
  for (const id of Object.keys(masks)) {
    const layer = findLayer(id);
    if (!layer?.texture) continue;
    const list = layersByPage.get(layer.texture.textureId) ?? [];
    list.push(layer);
    layersByPage.set(layer.texture.textureId, list);
  }

  // For each page tracked by the adapter, rebuild from original. Pages
  // not in `layersByPage` reset to pristine (covers "user cleared a mask"
  // path: the page should snap back to original).
  for (const [textureId, source] of textureSources) {
    const pixiTex = pixiTextures.get(textureId);
    if (!pixiTex) continue;

    const work = document.createElement("canvas");
    work.width = source.width;
    work.height = source.height;
    const ctx = work.getContext("2d");
    if (!ctx) continue;
    ctx.drawImage(source.image, 0, 0);

    const layers = layersByPage.get(textureId) ?? [];
    for (const layer of layers) {
      if (!layer.texture) continue;
      const blob = masks[layer.id];
      if (!blob) continue;
      const maskImg = await loadBlob(blob);
      if (!maskImg) continue;
      compositeMask(ctx, maskImg, layer.texture.rect, layer.texture.rotated ?? false);
    }

    replacePixiTextureSource(pixiTex, work);
  }
}

function compositeMask(
  ctx: CanvasRenderingContext2D,
  mask: HTMLImageElement,
  rect: { x: number; y: number; w: number; h: number },
  rotated: boolean,
): void {
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  if (rotated) {
    // The atlas region pixels are packed 90deg CW from upright. The mask
    // blob is upright (mask.w = rect.h, mask.h = rect.w). Rotate +90 to
    // map upright → sideways before drawing into rect.
    ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(mask, -rect.h / 2, -rect.w / 2, rect.h, rect.w);
  } else {
    ctx.drawImage(mask, rect.x, rect.y, rect.w, rect.h);
  }
  ctx.restore();
}

async function loadBlob(blob: Blob): Promise<HTMLImageElement | null> {
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  } finally {
    // The image keeps its decoded pixels in memory after revoke, so the
    // URL handle can be released immediately after load.
    URL.revokeObjectURL(url);
  }
}

/**
 * Pixi v8 swap pattern: replace `source.resource` with the working canvas
 * and bump the upload counter so the GPU re-uploads on next render. The
 * existing `Texture` and `TextureSource` instances stay alive — anything
 * that already holds them (spine atlas pages, Cubism model textures)
 * keeps working without re-binding.
 */
function replacePixiTextureSource(tex: PixiTexture, canvas: HTMLCanvasElement): void {
  const source = tex.source;
  if (!source) return;
  // biome-ignore lint/suspicious/noExplicitAny: pixi v8 source.resource is generic
  (source as any).resource = canvas;
  // biome-ignore lint/suspicious/noExplicitAny: pixi v8 source.update bumps uploadId
  if (typeof (source as any).update === "function") (source as any).update();
  // Some Pixi v8 builds gate on `_updateID`; bump it explicitly so the
  // renderer knows the resource changed.
  // biome-ignore lint/suspicious/noExplicitAny: pixi v8 internal
  const s = source as any;
  if (typeof s._updateID === "number") s._updateID++;
  if (typeof s.uploadId === "number") s.uploadId++;
}
