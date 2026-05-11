"use client";

import type { Texture as PixiTexture } from "pixi.js";
import type { Layer, LayerId, TextureId } from "../avatar/types";
import type { LayerTriangles, TextureSourceInfo } from "./AvatarAdapter";

/**
 * Compose per-layer overrides (textures and masks) onto each affected
 * atlas page and re-upload to the GPU so the live render reflects them.
 * Shared by both adapters because the page mutation logic is runtime-
 * agnostic — only the lookups differ.
 *
 * Composition order, per page (from pristine source bitmap):
 *   1. Texture overrides (`source-over`, clipped to the layer's
 *      triangles so the new pixels stay inside the layer's footprint).
 *   2. Masks (`destination-out`, alpha=255 wipes the page pixel).
 *
 * Pages that don't appear in either map reset to pristine — covers the
 * "user cleared a mask / discarded a generation" path.
 */
export type ApplyContext = {
  findLayer: (id: LayerId) => Layer | null;
  getTriangles: (id: LayerId) => LayerTriangles | null;
  textureSources: ReadonlyMap<TextureId, TextureSourceInfo>;
  pixiTextures: ReadonlyMap<TextureId, PixiTexture>;
};

export type LayerOverrides = {
  /** PNG masks. Alpha=255 wipes the page pixel. */
  masks: Readonly<Record<LayerId, Blob>>;
  /** PNG replacement textures sized to the layer's upright rect. */
  textures: Readonly<Record<LayerId, Blob>>;
};

export async function applyLayerOverrides(
  overrides: LayerOverrides,
  ctx: ApplyContext,
): Promise<void> {
  // Collect affected pages from both override types.
  const pageDirty = new Set<TextureId>();
  for (const id of Object.keys(overrides.textures)) {
    const l = ctx.findLayer(id);
    if (l?.texture) pageDirty.add(l.texture.textureId);
  }
  for (const id of Object.keys(overrides.masks)) {
    const l = ctx.findLayer(id);
    if (l?.texture) pageDirty.add(l.texture.textureId);
  }

  // Rebuild every tracked page from pristine. Pages without overrides
  // get re-uploaded with the original pixels — keeps the GPU in sync
  // when a user discards a generation or clears a mask.
  for (const [textureId, source] of ctx.textureSources) {
    const pixi = ctx.pixiTextures.get(textureId);
    if (!pixi) continue;

    const work = document.createElement("canvas");
    work.width = source.width;
    work.height = source.height;
    const work2d = work.getContext("2d");
    if (!work2d) continue;
    work2d.drawImage(source.image, 0, 0);

    if (pageDirty.has(textureId)) {
      // 1. Textures first.
      for (const [layerId, blob] of Object.entries(overrides.textures)) {
        const layer = ctx.findLayer(layerId);
        if (!layer?.texture || layer.texture.textureId !== textureId) continue;
        const img = await loadBlob(blob);
        if (!img) continue;
        const path = pagePathForLayer(ctx, layer, source.width, source.height);
        compositeTexture(work2d, img, layer.texture.rect, layer.texture.rotated ?? false, path);
      }

      // 2. Masks — destination-out, applied regardless of whether the
      //    layer also has a texture override. Convention: a saved
      //    DecomposeStudio mask means "erase this region from the
      //    final render". When the same layer ALSO has a generated
      //    texture, the AI was told to PRESERVE the marked region
      //    (so the texture blob carries the original pixels there);
      //    this destination-out then wipes them, leaving the masked
      //    area transparent and the AI-edited rest visible. The two
      //    overrides compose cleanly because the mask convention is
      //    consistent end-to-end.
      for (const [layerId, blob] of Object.entries(overrides.masks)) {
        const layer = ctx.findLayer(layerId);
        if (!layer?.texture || layer.texture.textureId !== textureId) continue;
        const img = await loadBlob(blob);
        if (!img) continue;
        compositeMask(work2d, img, layer.texture.rect, layer.texture.rotated ?? false);
      }
    }

    replacePixiTextureSource(pixi, work);
  }
}

// ----- composition helpers -----

function compositeTexture(
  ctx: CanvasRenderingContext2D,
  texture: HTMLImageElement,
  rect: { x: number; y: number; w: number; h: number },
  rotated: boolean,
  trianglePath: Path2D | null,
): void {
  ctx.save();
  // Triangle clip prevents the new pixels from spilling onto atlas
  // neighbors when the layer's footprint is non-rectangular (Cubism
  // mesh, Spine MeshAttachment). When the adapter can't produce
  // triangles, fall back to the rectangular rect — without any
  // clip the wipe below would erase the whole atlas page.
  if (trianglePath) {
    ctx.clip(trianglePath);
  } else {
    const rectPath = new Path2D();
    rectPath.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip(rectPath);
  }
  // Wipe pristine atlas pixels inside the clip BEFORE drawing the
  // override blob. Without this, source-over below preserves
  // pristine pixels anywhere the blob has alpha=0 — which is
  // exactly what happens when the user uses the eraser in paint
  // mode: dabs become transparent holes in the saved PNG, but the
  // page-side composite would still show the original pristine
  // texture through them, so erase appeared to do nothing.
  // Clearing first means the blob's pixels are 100% authoritative
  // inside the clip: opaque pixels replace pristine, transparent
  // pixels leave alpha=0. Other layers' atlas content (outside
  // the clip) stays untouched.
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = "rgba(0,0,0,1)";
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.globalCompositeOperation = "source-over";
  if (rotated) {
    // The texture blob is upright; the atlas region is packed 90deg
    // CW. Rotate +90 around the rect center to map upright → sideways.
    ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(texture, -rect.h / 2, -rect.w / 2, rect.h, rect.w);
  } else {
    ctx.drawImage(texture, rect.x, rect.y, rect.w, rect.h);
  }
  ctx.restore();
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
    ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(mask, -rect.h / 2, -rect.w / 2, rect.h, rect.w);
  } else {
    ctx.drawImage(mask, rect.x, rect.y, rect.w, rect.h);
  }
  ctx.restore();
}

/**
 * Build a `Path2D` describing the layer's triangles in atlas-page
 * pixel coords (not the upright canvas-local coords used by
 * `buildLayerClipPath` in `regionExtract.ts`). When the adapter
 * doesn't report triangles, return `null` so the caller draws the
 * full rect — strictly less precise but never wrong.
 */
function pagePathForLayer(
  ctx: ApplyContext,
  layer: Layer,
  pageW: number,
  pageH: number,
): Path2D | null {
  const tris = ctx.getTriangles(layer.id);
  if (!tris || tris.uvs.length < 6) return null;
  if (layer.texture && tris.textureId !== layer.texture.textureId) return null;
  const path = new Path2D();
  for (let i = 0; i + 5 < tris.uvs.length; i += 6) {
    for (let v = 0; v < 3; v++) {
      const u = tris.uvs[i + v * 2];
      const vv = tris.uvs[i + v * 2 + 1];
      const px = u * pageW;
      const py = vv * pageH;
      if (v === 0) path.moveTo(px, py);
      else path.lineTo(px, py);
    }
    path.closePath();
  }
  return path;
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
    URL.revokeObjectURL(url);
  }
}

/**
 * Pixi v8 swap pattern: replace `source.resource` with the working
 * canvas and bump the upload counter. The existing `Texture` and
 * `TextureSource` instances stay alive — anything that already holds
 * them keeps working without re-binding.
 */
function replacePixiTextureSource(tex: PixiTexture, canvas: HTMLCanvasElement): void {
  const source = tex.source;
  if (!source) return;
  // biome-ignore lint/suspicious/noExplicitAny: pixi v8 source.resource is generic
  (source as any).resource = canvas;
  // biome-ignore lint/suspicious/noExplicitAny: pixi v8 source.update bumps uploadId
  if (typeof (source as any).update === "function") (source as any).update();
  // biome-ignore lint/suspicious/noExplicitAny: pixi v8 internal counters
  const s = source as any;
  if (typeof s._updateID === "number") s._updateID++;
  if (typeof s.uploadId === "number") s.uploadId++;
}
