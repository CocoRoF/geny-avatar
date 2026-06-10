"use client";

/**
 * Whole-character restyle pipeline (client side).
 *
 * Strategy (upgrade-doc/04-전신-리스타일.md §4-B): an atlas page already
 * contains every part's texture in one image, so transforming the PAGE
 * in one AI call gives cross-part coherence for free — no per-drawable
 * anchor/palette chaining needed. The result is applied as a page
 * override (`setPageTextureOverride`), which the live renderer uses as
 * the page's compositing base while per-layer overrides stay intact.
 *
 * Safety: the page's alpha silhouette is IMMUTABLE. `enforcePageAlpha`
 * copies the source page's alpha channel onto the result, so UV
 * mapping can never break — at worst a part gets the wrong style, never
 * the wrong shape.
 */

import type { AvatarAdapter } from "../adapters/AvatarAdapter";
import type { Avatar, LayerId } from "../avatar/types";
import { type BakedAtlasPage, bakeAtlasPages } from "../export/bakeAtlas";

export type RestylePageSource = {
  pageIndex: number;
  /** Current composited page (page override + per-layer overrides). */
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
};

/**
 * Bake the CURRENT page composites (what the user sees) as restyle
 * sources. Reuses the export baker, which is already page-override
 * aware via `adapter.getTextureSource`.
 */
export async function bakeRestyleSources(input: {
  adapter: AvatarAdapter;
  avatar: Avatar;
  masks: Record<LayerId, Blob>;
  textures: Record<LayerId, Blob>;
}): Promise<RestylePageSource[]> {
  const pages: BakedAtlasPage[] = await bakeAtlasPages({
    adapter: input.adapter,
    avatar: input.avatar,
    masks: input.masks,
    textures: input.textures,
  });
  const out: RestylePageSource[] = [];
  for (const page of pages) {
    const canvas = await blobToCanvas(page.blob, page.width, page.height);
    out.push({ pageIndex: page.pageIndex, canvas, width: page.width, height: page.height });
  }
  out.sort((a, b) => a.pageIndex - b.pageIndex);
  return out;
}

export type RestyleSubmitFrame = {
  blob: Blob;
  /** Where the fitted page landed inside the square submit canvas. */
  offset: { x: number; y: number; w: number; h: number };
  /** Side length of the square submit canvas. */
  size: number;
};

/**
 * Fit a page into a 1024² transparent square for submission — keeps
 * aspect, remembers the placement so the result can be cropped back.
 * gpt-image returns at most ~1024-class dims; pages are often 2048+.
 */
export async function prepareRestyleFrame(page: RestylePageSource): Promise<RestyleSubmitFrame> {
  const SIZE = 1024;
  const scale = Math.min(SIZE / page.width, SIZE / page.height);
  const w = Math.max(1, Math.round(page.width * scale));
  const h = Math.max(1, Math.round(page.height * scale));
  const x = Math.floor((SIZE - w) / 2);
  const y = Math.floor((SIZE - h) / 2);
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("restyle frame 2d context unavailable");
  if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";
  ctx.drawImage(page.canvas, x, y, w, h);
  return { blob: await canvasToPngBlob(canvas), offset: { x, y, w, h }, size: SIZE };
}

/**
 * Crop the AI result back out of the submit frame, upscale to page
 * dims, and force the SOURCE page's alpha channel onto it. Returns the
 * page-override blob ready for `setPageTextureOverride`.
 */
export async function postprocessRestyledPage(input: {
  resultBlob: Blob;
  frame: RestyleSubmitFrame;
  page: RestylePageSource;
}): Promise<Blob> {
  const { resultBlob, frame, page } = input;
  const resultImg = await blobToImageBitmap(resultBlob);
  try {
    // The model may return different dims than the submit frame —
    // scale the crop rect proportionally (same trick as the per-layer
    // postprocess).
    const sx = resultImg.width / frame.size;
    const sy = resultImg.height / frame.size;

    const out = document.createElement("canvas");
    out.width = page.width;
    out.height = page.height;
    const ctx = out.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("restyle postprocess 2d context unavailable");
    if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      resultImg,
      frame.offset.x * sx,
      frame.offset.y * sy,
      frame.offset.w * sx,
      frame.offset.h * sy,
      0,
      0,
      page.width,
      page.height,
    );

    // Hard alpha enforce: silhouette is authoritative from the source.
    const srcCtx = page.canvas.getContext("2d", { willReadFrequently: true });
    if (!srcCtx) throw new Error("restyle source 2d context unavailable");
    const srcData = srcCtx.getImageData(0, 0, page.width, page.height).data;
    const outData = ctx.getImageData(0, 0, page.width, page.height);
    const px = outData.data;
    for (let i = 3; i < px.length; i += 4) {
      px[i] = srcData[i];
    }
    ctx.putImageData(outData, 0, 0);
    return await canvasToPngBlob(out);
  } finally {
    resultImg.close();
  }
}

/**
 * Prompt scaffold for atlas-page edits. The atlas-sprite-sheet framing
 * is load-bearing: without it the model reads the page as "a strange
 * character drawing" and tries to complete it (the exact FLUX failure
 * mode recorded in docs-upgrade/progress/2026-05-13-mask-as-reference-hint.md).
 */
export function composeRestylePrompt(input: {
  userPrompt: string;
  pageNumber: number;
  pageCount: number;
  hasSnapshot: boolean;
  refCount: number;
  hasPrevPageResult: boolean;
}): string {
  const { userPrompt, pageNumber, pageCount, hasSnapshot, refCount, hasPrevPageResult } = input;
  const lines: string[] = [];
  lines.push(
    `[image 1] is page ${pageNumber}/${pageCount} of a 2D character TEXTURE ATLAS (sprite sheet). ` +
      `It contains many disconnected body/clothing/hair parts of ONE character laid out at arbitrary positions. ` +
      `It is NOT a portrait and NOT a full character illustration.`,
  );
  lines.push(
    "STRICT RULES: repaint the surface style of the EXISTING parts only. " +
      "Every part must stay exactly in place — same silhouette, same scale, same orientation. " +
      "Do NOT add new parts, faces, eyes, limbs, or a whole character. " +
      "Do NOT rearrange, merge, or outline parts. Transparent/empty areas must stay empty.",
  );
  let slot = 2;
  if (hasSnapshot) {
    lines.push(
      `[image ${slot}] is a snapshot of the assembled character — use it ONLY to understand which atlas part is which. Do not copy its composition.`,
    );
    slot++;
  }
  if (refCount > 0) {
    const last = slot + refCount - 1;
    lines.push(
      `[image ${slot}${refCount > 1 ? `..${last}` : ""}] ${refCount > 1 ? "are" : "is"} the style reference${refCount > 1 ? "s" : ""}: apply ${refCount > 1 ? "their" : "its"} style, palette and materials to every atlas part coherently.`,
    );
    slot = last + 1;
  }
  if (hasPrevPageResult) {
    lines.push(
      `[image ${slot}] is the already-restyled PREVIOUS page of this same atlas — match its style exactly so all pages stay consistent.`,
    );
  }
  lines.push(`Edit [image 1]: ${userPrompt}`);
  lines.push("Anime / illustration style, NOT photorealistic.");
  return lines.join("\n");
}

// ----- small canvas helpers -----

async function blobToCanvas(blob: Blob, width: number, height: number): Promise<HTMLCanvasElement> {
  const img = await blobToImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")?.drawImage(img, 0, 0, width, height);
    return canvas;
  } finally {
    img.close();
  }
}

async function blobToImageBitmap(blob: Blob): Promise<ImageBitmap> {
  return await createImageBitmap(blob);
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error("canvas.toBlob returned null"));
    }, "image/png");
  });
}
