/**
 * Bake the per-pixel edits (AI texture, DecomposeStudio mask) onto the
 * atlas pages and emit one PNG blob per page.
 *
 * This is what makes "Export Model" different from "Save to File":
 *   - Save to File ships pristine atlases + sidecar override blobs that
 *     only our editor knows how to apply.
 *   - Export Model ships atlas pages with the user's mask + texture
 *     edits *already in the pixels*. Drop the resulting zip into any
 *     third-party Spine or Cubism viewer and it renders the same as
 *     our preview.
 *
 * **Visibility hide is intentionally NOT handled here.** Earlier
 * iterations erased a hidden layer's triangle footprint via
 * `destination-out`, but pixel-level erase has fundamental problems:
 * a Cubism part's atlas region can be non-trivially shared with mesh
 * vertices that read neighboring pixels (mesh sampling, mip-mapping,
 * adjacent regions in the same atlas quad). Erasing introduced ghost
 * imagery, blocky breakage, and "watermark"-style residue on the body.
 *
 * The right fix lives in the model file, not the atlas. `buildModelZip`
 * patches the model's runtime state (Cubism: PartOpacity curves; Spine:
 * setup-pose attachment removal) so the part stops rendering — texture
 * pixels stay untouched. See `buildModelZip.ts` for that side.
 *
 * Composition order on each page (matches `applyOverrides.ts`):
 *   1. Pristine source bitmap.
 *   2. Texture overrides (`source-over`, clipped to the layer's
 *      triangles so neighboring atlas regions stay untouched).
 *   3. Masks (`destination-out`, alpha=255 wipes).
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
  const { adapter, avatar, masks, textures } = input;
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
