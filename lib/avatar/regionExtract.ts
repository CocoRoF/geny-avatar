"use client";

import type { AvatarAdapter, TextureSourceInfo } from "../adapters/AvatarAdapter";
import type { Layer, Rect } from "./types";

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

/**
 * Build a `Path2D` describing the layer's actual atlas footprint, in
 * the local coord space of the upright `extractRegionCanvas` output.
 * Used by DecomposeStudio to clip both the source preview and the
 * brush — so the user only sees / paints pixels that belong to the
 * layer (instead of bbox neighbors).
 *
 * Returns `null` when the adapter doesn't expose triangles for this
 * layer (e.g. an attachment we don't recognize).
 */
export function buildLayerClipPath(
  adapter: AvatarAdapter,
  layer: Layer,
  source: TextureSourceInfo,
): Path2D | null {
  if (!layer.texture) return null;
  const triangles = adapter.getLayerTriangles(layer.id);
  if (!triangles || triangles.uvs.length < 6) return null;
  if (triangles.textureId !== layer.texture.textureId) return null;

  const pageW = source.width;
  const pageH = source.height;
  const r = layer.texture.rect;
  const rotated = layer.texture.rotated ?? false;

  const path = new Path2D();
  const uvs = triangles.uvs;
  for (let i = 0; i + 5 < uvs.length; i += 6) {
    for (let v = 0; v < 3; v++) {
      const u = uvs[i + v * 2];
      const vv = uvs[i + v * 2 + 1];
      const px = u * pageW;
      const py = vv * pageH;
      // Map atlas-page pixel → upright canvas-local pixel. See the math
      // worked out in extractRegionCanvas (we invert its draw transform).
      const lx = rotated ? py - r.y : px - r.x;
      const ly = rotated ? r.x + r.w - px : py - r.y;
      if (v === 0) path.moveTo(lx, ly);
      else path.lineTo(lx, ly);
    }
    path.closePath();
  }
  return path;
}

/**
 * Extract a layer's footprint as an upright canvas, with non-layer
 * pixels (atlas neighbors that fall inside the bbox) clipped out.
 * Falls back to the rectangular bbox crop when the adapter can't
 * report triangles for the layer.
 */
export function extractLayerCanvas(
  adapter: AvatarAdapter,
  layer: Layer,
): { canvas: HTMLCanvasElement; clip: Path2D | null } | null {
  if (!layer.texture) return null;
  const source = adapter.getTextureSource(layer.texture.textureId);
  if (!source) return null;
  const bboxCanvas = extractRegionCanvas(
    source,
    layer.texture.rect,
    layer.texture.rotated ?? false,
  );
  if (!bboxCanvas) return null;

  const clip = buildLayerClipPath(adapter, layer, source);
  if (!clip) return { canvas: bboxCanvas, clip: null };

  const out = document.createElement("canvas");
  out.width = bboxCanvas.width;
  out.height = bboxCanvas.height;
  const ctx = out.getContext("2d");
  if (!ctx) return { canvas: bboxCanvas, clip };
  ctx.save();
  ctx.clip(clip);
  ctx.drawImage(bboxCanvas, 0, 0);
  ctx.restore();
  return { canvas: out, clip };
}

/**
 * Like `extractLayerCanvas`, but composites the layer's saved
 * overrides on top of the base extraction. The returned canvas
 * matches what the live atlas currently renders for this layer —
 * stacking the user's previous edits step by step.
 *
 * Composition order mirrors `applyLayerOverrides`:
 *   1. Base = extractLayerCanvas (original triangle-clipped atlas)
 *   2. Texture override (source-over) — AI-generated content covers
 *      the layer footprint
 *   3. Mask (destination-out) — wipes the user-marked region
 *
 * Both blobs are sized to the layer's upright rect already
 * (postprocessGeneratedBlob and DecomposeStudio's save bake to that
 * dim), so we draw them directly without any further transform.
 *
 * Used by:
 *   - DecomposeStudio (texture only — the user is about to edit the
 *     mask, so we leave the mask layer fresh and load any saved mask
 *     into the brush canvas separately).
 *   - GeneratePanel (both — the user sees and the AI receives the
 *     full current visible state, enabling iterative refinement).
 */
export type LayerOverrideBlobs = {
  texture?: Blob | null;
  mask?: Blob | null;
};

export async function extractCurrentLayerCanvas(
  adapter: AvatarAdapter,
  layer: Layer,
  overrides: LayerOverrideBlobs,
): Promise<{ canvas: HTMLCanvasElement; clip: Path2D | null } | null> {
  const base = extractLayerCanvas(adapter, layer);
  if (!base) return null;

  const ctx = base.canvas.getContext("2d");
  if (!ctx) return base;

  if (overrides.texture) {
    const img = await blobToImageSafe(overrides.texture);
    if (img) {
      ctx.save();
      // Source-over by default. We *don't* re-apply the triangle clip
      // here — the texture blob has already been alpha-enforced
      // against the base footprint at apply time, so its alpha
      // already matches the silhouette.
      ctx.drawImage(img, 0, 0, base.canvas.width, base.canvas.height);
      ctx.restore();
    }
  }

  if (overrides.mask) {
    const img = await blobToImageSafe(overrides.mask);
    if (img) {
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.drawImage(img, 0, 0, base.canvas.width, base.canvas.height);
      ctx.restore();
    }
  }

  return base;
}

async function blobToImageSafe(blob: Blob): Promise<HTMLImageElement | null> {
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
