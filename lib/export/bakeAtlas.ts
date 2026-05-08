/**
 * Bake every per-layer edit (AI texture, DecomposeStudio mask, explicit
 * hide) onto the atlas pages and emit one PNG blob per page.
 *
 * This is what makes "Export Model" different from "Save to File":
 *   - Save to File ships pristine atlases + sidecar override blobs that
 *     only our editor knows how to apply.
 *   - Export Model ships atlas pages with the user's edits *already in
 *     the pixels*. Drop the resulting zip into any third-party Spine
 *     or Cubism viewer and it renders the same as our preview.
 *
 * Composition order on each page (matches `applyOverrides.ts`):
 *   1. Pristine source bitmap.
 *   2. Texture overrides (`source-over`, clipped to the layer's
 *      triangles so neighboring atlas regions stay untouched).
 *   3. Masks (`destination-out`, alpha=255 wipes).
 *   4. **Visibility erase** — layers that the user explicitly toggled
 *      off from a default-visible state get their footprint wiped via
 *      `destination-out` over the layer's triangles. Skips layers
 *      whose defaults were already hidden, so a Cubism part that the
 *      puppet's idle motion may legitimately raise to opacity > 0
 *      keeps its pixels in the atlas.
 *
 * The function is adapter-agnostic: it asks the adapter for pristine
 * bitmaps + per-layer triangles and never touches the GPU. Safe to
 * call without disturbing the live preview.
 */

import type { AvatarAdapter } from "../adapters/AvatarAdapter";
import type { Avatar, Layer, LayerId, Rect, TextureId } from "../avatar/types";

export type BakeAtlasInput = {
  adapter: AvatarAdapter;
  avatar: Avatar;
  visibility: Record<LayerId, boolean>;
  masks: Record<LayerId, Blob>;
  textures: Record<LayerId, Blob>;
};

export type BakedAtlasPage = {
  textureId: TextureId;
  pageIndex: number;
  width: number;
  height: number;
  blob: Blob;
};

export async function bakeAtlasPages(input: BakeAtlasInput): Promise<BakedAtlasPage[]> {
  const { adapter, avatar, visibility, masks, textures } = input;
  const out: BakedAtlasPage[] = [];

  // Pre-load every override blob once so each page's loop doesn't pay
  // the decode cost twice when several layers share a page.
  const textureImages = await loadBlobMap(textures);
  const maskImages = await loadBlobMap(masks);

  for (const tex of avatar.textures) {
    const src = adapter.getTextureSource(tex.id);
    if (!src) continue;

    const work = document.createElement("canvas");
    work.width = src.width;
    work.height = src.height;
    const ctx = work.getContext("2d");
    if (!ctx) continue;
    ctx.drawImage(src.image, 0, 0);

    // 1. Texture overrides
    for (const layer of avatar.layers) {
      if (!layer.texture || layer.texture.textureId !== tex.id) continue;
      const img = textureImages.get(layer.id);
      if (!img) continue;
      const path = trianglesPathForLayer(adapter, layer, src.width, src.height);
      compositeOver(ctx, img, layer.texture.rect, layer.texture.rotated ?? false, path);
    }

    // 2. Masks
    for (const layer of avatar.layers) {
      if (!layer.texture || layer.texture.textureId !== tex.id) continue;
      const img = maskImages.get(layer.id);
      if (!img) continue;
      compositeErase(ctx, img, layer.texture.rect, layer.texture.rotated ?? false);
    }

    // 3. Visibility erase — only layers the user explicitly turned off
    //    from a default-visible state. Layers that were already hidden
    //    by default keep their atlas pixels intact so any motion that
    //    legitimately raises them later still has something to draw.
    for (const layer of avatar.layers) {
      if (!layer.texture || layer.texture.textureId !== tex.id) continue;
      const current = visibility[layer.id];
      if (current !== false) continue;
      if (layer.defaults.visible !== true) continue;
      const path = trianglesPathForLayer(adapter, layer, src.width, src.height);
      if (!path) continue;
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "#000";
      ctx.fill(path);
      ctx.restore();
    }

    const blob = await canvasToPngBlob(work);
    out.push({
      textureId: tex.id,
      pageIndex: tex.pageIndex,
      width: src.width,
      height: src.height,
      blob,
    });
  }

  return out;
}

// ----- helpers (mirror of applyOverrides composition) -----

function compositeOver(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  rect: Rect,
  rotated: boolean,
  trianglePath: Path2D | null,
): void {
  ctx.save();
  if (trianglePath) ctx.clip(trianglePath);
  ctx.globalCompositeOperation = "source-over";
  if (rotated) {
    ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(img, -rect.h / 2, -rect.w / 2, rect.h, rect.w);
  } else {
    ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h);
  }
  ctx.restore();
}

function compositeErase(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  rect: Rect,
  rotated: boolean,
): void {
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  if (rotated) {
    ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(img, -rect.h / 2, -rect.w / 2, rect.h, rect.w);
  } else {
    ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h);
  }
  ctx.restore();
}

function trianglesPathForLayer(
  adapter: AvatarAdapter,
  layer: Layer,
  pageW: number,
  pageH: number,
): Path2D | null {
  const tris = adapter.getLayerTriangles(layer.id);
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

async function loadBlobMap(map: Record<LayerId, Blob>): Promise<Map<LayerId, HTMLImageElement>> {
  const out = new Map<LayerId, HTMLImageElement>();
  await Promise.all(
    Object.entries(map).map(async ([id, blob]) => {
      const img = await loadBlob(blob);
      if (img) out.set(id, img);
    }),
  );
  return out;
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

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error("canvas.toBlob returned null"));
    }, "image/png");
  });
}
