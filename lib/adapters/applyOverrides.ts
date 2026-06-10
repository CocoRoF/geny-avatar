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
 *   2. Masks (`destination-out`, alpha=255 wipes the page pixel,
 *      clipped to the layer's triangles for the same reason).
 *
 * Concurrency: callers go through `LayerOverrideApplier`, which
 *   - serializes applies (a second call while one is in flight queues
 *     and coalesces — only the latest requested state runs next), and
 *   - rebuilds only pages whose overrides actually changed since the
 *     last applied state (Blob identity diff). A page whose last
 *     override was removed is rebuilt once back to pristine; pages
 *     never touched are never re-uploaded.
 */
export type ApplyContext = {
  findLayer: (id: LayerId) => Layer | null;
  getTriangles: (id: LayerId) => LayerTriangles | null;
  textureSources: ReadonlyMap<TextureId, TextureSourceInfo>;
  pixiTextures: ReadonlyMap<TextureId, PixiTexture>;
  /** pageIndex ↔ TextureId translation. Page overrides persist by
   *  pageIndex (stable across reloads); the GPU side keys by the
   *  per-load TextureId. */
  textureIdForPageIndex: (pageIndex: number) => TextureId | null;
  pageIndexForTextureId: (id: TextureId) => number | null;
};

export type LayerOverrides = {
  /** PNG masks. Alpha=255 wipes the page pixel. */
  masks: Readonly<Record<LayerId, Blob>>;
  /** PNG replacement textures sized to the layer's upright rect. */
  textures: Readonly<Record<LayerId, Blob>>;
  /** Whole-page replacement images keyed by pageIndex. When present,
   *  the page is rebuilt from THIS image instead of the pristine
   *  bitmap; per-layer textures/masks still composite on top. */
  pages?: Readonly<Record<number, Blob>>;
};

export type ApplyResult = {
  /** Layers whose override blob failed to decode — the rest of the
   *  page was still composited so one corrupt blob can't wedge the
   *  whole apply. Callers surface these to the user. */
  failedLayerIds: LayerId[];
};

/**
 * Per-adapter apply queue. One instance per adapter lifetime; `dispose`
 * on adapter destroy.
 */
export class LayerOverrideApplier {
  private ctx: ApplyContext;
  /** Latest requested-but-not-yet-applied state (coalesced). */
  private pending: LayerOverrides | null = null;
  /** Resolves when the queue drains (the latest state is on the GPU). */
  private draining: Promise<ApplyResult> | null = null;
  /** State that is actually applied — basis for the page diff. */
  private lastApplied: LayerOverrides = { masks: {}, textures: {} };
  /** Decoded page-override images, kept alive so read-side consumers
   *  (thumbnails, DecomposeStudio source extraction, atlas bake) see
   *  the same base the live render uses. `getPageBase` serves these
   *  through the adapter's `getTextureSource`. */
  private pageBases = new Map<TextureId, TextureSourceInfo>();
  private disposed = false;

  constructor(ctx: ApplyContext) {
    this.ctx = ctx;
  }

  apply(overrides: LayerOverrides): Promise<ApplyResult> {
    this.pending = overrides;
    if (!this.draining) this.draining = this.drain();
    return this.draining;
  }

  dispose(): void {
    this.disposed = true;
    this.pending = null;
    for (const base of this.pageBases.values()) {
      if (typeof ImageBitmap !== "undefined" && base.image instanceof ImageBitmap) {
        base.image.close();
      }
    }
    this.pageBases.clear();
  }

  /** Current page-override base for a page, when one is applied. */
  getPageBase(textureId: TextureId): TextureSourceInfo | null {
    return this.pageBases.get(textureId) ?? null;
  }

  private async drain(): Promise<ApplyResult> {
    let result: ApplyResult = { failedLayerIds: [] };
    try {
      while (this.pending && !this.disposed) {
        const next = this.pending;
        this.pending = null;
        result = await this.applyOnce(next);
        this.lastApplied = next;
      }
    } finally {
      this.draining = null;
    }
    return result;
  }

  /** Pages whose override set changed between `lastApplied` and `next`. */
  private diffDirtyPages(next: LayerOverrides): Set<TextureId> {
    const dirty = new Set<TextureId>();
    const collect = (
      prev: Readonly<Record<LayerId, Blob>>,
      cur: Readonly<Record<LayerId, Blob>>,
    ) => {
      const keys = new Set([...Object.keys(prev), ...Object.keys(cur)]);
      for (const id of keys) {
        if (prev[id] === cur[id]) continue;
        const layer = this.ctx.findLayer(id);
        if (layer?.texture) dirty.add(layer.texture.textureId);
      }
    };
    collect(this.lastApplied.textures, next.textures);
    collect(this.lastApplied.masks, next.masks);
    // Whole-page bases — keyed by pageIndex, diffed by Blob identity.
    const prevPages = this.lastApplied.pages ?? {};
    const curPages = next.pages ?? {};
    const pageKeys = new Set([...Object.keys(prevPages), ...Object.keys(curPages)]);
    for (const key of pageKeys) {
      const idx = Number(key);
      if (prevPages[idx] === curPages[idx]) continue;
      const textureId = this.ctx.textureIdForPageIndex(idx);
      if (textureId) dirty.add(textureId);
    }
    return dirty;
  }

  private async applyOnce(overrides: LayerOverrides): Promise<ApplyResult> {
    const failedLayerIds: LayerId[] = [];
    const dirtyPages = this.diffDirtyPages(overrides);
    if (dirtyPages.size === 0) return { failedLayerIds };

    // Decode each blob once even when several dirty pages share it.
    const decoded = new Map<Blob, CanvasImageSource | null>();
    const decode = async (blob: Blob): Promise<CanvasImageSource | null> => {
      if (decoded.has(blob)) return decoded.get(blob) ?? null;
      const img = await loadBlob(blob);
      decoded.set(blob, img);
      return img;
    };

    for (const textureId of dirtyPages) {
      if (this.disposed) break;
      const source = this.ctx.textureSources.get(textureId);
      const pixi = this.ctx.pixiTextures.get(textureId);
      if (!source || !pixi) continue;

      const work = document.createElement("canvas");
      work.width = source.width;
      work.height = source.height;
      const work2d = work.getContext("2d");
      if (!work2d) continue;

      // 0. Page base — replacement image when present, pristine
      //    otherwise. Scaled to the page dims so a downscaled AI
      //    result still covers the full page. The decoded base is
      //    retained in `pageBases` so read-side consumers (via the
      //    adapter's getTextureSource) match the live render.
      const pageIndex = this.ctx.pageIndexForTextureId(textureId);
      const pageBlob = pageIndex != null ? overrides.pages?.[pageIndex] : undefined;
      let baseDrawn = false;
      const prevBase = this.pageBases.get(textureId);
      if (pageBlob) {
        const img = await loadBlob(pageBlob);
        if (img) {
          // Normalize to page dims: read-side consumers crop by
          // page-space pixel rects, so the retained base's intrinsic
          // size must equal the page size even when the override blob
          // was generated at a different resolution.
          let baseImage: CanvasImageSource = img;
          const iw = "width" in img ? Number(img.width) : source.width;
          const ih = "height" in img ? Number(img.height) : source.height;
          if (iw !== source.width || ih !== source.height) {
            const baseCanvas = document.createElement("canvas");
            baseCanvas.width = source.width;
            baseCanvas.height = source.height;
            baseCanvas.getContext("2d")?.drawImage(img, 0, 0, source.width, source.height);
            baseImage = baseCanvas;
            if (typeof ImageBitmap !== "undefined" && img instanceof ImageBitmap) img.close();
          }
          work2d.drawImage(baseImage, 0, 0, source.width, source.height);
          baseDrawn = true;
          this.pageBases.set(textureId, {
            image: baseImage,
            width: source.width,
            height: source.height,
          });
        } else {
          failedLayerIds.push(`page:${pageIndex}`);
          console.warn(`[applyOverrides] page override decode failed (page ${pageIndex})`);
        }
      }
      if (!baseDrawn) {
        work2d.drawImage(source.image, 0, 0);
        this.pageBases.delete(textureId);
      }
      if (prevBase && this.pageBases.get(textureId) !== prevBase) {
        if (typeof ImageBitmap !== "undefined" && prevBase.image instanceof ImageBitmap) {
          prevBase.image.close();
        }
      }

      // 1. Textures first.
      for (const [layerId, blob] of Object.entries(overrides.textures)) {
        const layer = this.ctx.findLayer(layerId);
        if (!layer?.texture || layer.texture.textureId !== textureId) continue;
        const img = await decode(blob);
        if (!img) {
          failedLayerIds.push(layerId);
          continue;
        }
        const path = pagePathForLayer(this.ctx, layer, source.width, source.height);
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
        const layer = this.ctx.findLayer(layerId);
        if (!layer?.texture || layer.texture.textureId !== textureId) continue;
        const img = await decode(blob);
        if (!img) {
          failedLayerIds.push(layerId);
          continue;
        }
        const path = pagePathForLayer(this.ctx, layer, source.width, source.height);
        compositeMask(work2d, img, layer.texture.rect, layer.texture.rotated ?? false, path);
      }

      if (!this.disposed) replacePixiTextureSource(pixi, work);
    }

    for (const img of decoded.values()) {
      if (typeof ImageBitmap !== "undefined" && img instanceof ImageBitmap) img.close();
    }
    return { failedLayerIds };
  }
}

// ----- composition helpers -----

function compositeTexture(
  ctx: CanvasRenderingContext2D,
  texture: CanvasImageSource,
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
  clipToFootprint(ctx, rect, trianglePath);
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
  drawIntoRect(ctx, texture, rect, rotated);
  ctx.restore();
}

function compositeMask(
  ctx: CanvasRenderingContext2D,
  mask: CanvasImageSource,
  rect: { x: number; y: number; w: number; h: number },
  rotated: boolean,
  trianglePath: Path2D | null,
): void {
  ctx.save();
  // Same footprint clip as textures: mask alpha that strays outside
  // the layer's triangles (possible for blobs not produced by
  // DecomposeStudio, e.g. restored from an export) must not erase
  // atlas neighbors packed inside the same bbox.
  clipToFootprint(ctx, rect, trianglePath);
  ctx.globalCompositeOperation = "destination-out";
  drawIntoRect(ctx, mask, rect, rotated);
  ctx.restore();
}

function clipToFootprint(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  trianglePath: Path2D | null,
): void {
  if (trianglePath) {
    ctx.clip(trianglePath);
  } else {
    const rectPath = new Path2D();
    rectPath.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip(rectPath);
  }
}

function drawIntoRect(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  rect: { x: number; y: number; w: number; h: number },
  rotated: boolean,
): void {
  if (rotated) {
    // The blob is upright; the atlas region is packed 90deg CW.
    // Rotate +90 around the rect center to map upright → sideways.
    ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(img, -rect.h / 2, -rect.w / 2, rect.h, rect.w);
  } else {
    ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h);
  }
}

/**
 * Build a `Path2D` describing the layer's triangles in atlas-page
 * pixel coords (not the upright canvas-local coords used by
 * `buildLayerClipPath` in `regionExtract.ts`). When the adapter
 * doesn't report triangles, return `null` so the caller clips to the
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

async function loadBlob(blob: Blob): Promise<CanvasImageSource | null> {
  // createImageBitmap decodes off the main thread and skips the object-
  // URL round trip; fall back to HTMLImageElement for odd blobs.
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(blob);
    } catch {
      // fall through
    }
  }
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
