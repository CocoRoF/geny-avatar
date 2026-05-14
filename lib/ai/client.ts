"use client";

import { apiUrl } from "@/lib/basePath";

/**
 * Client-side helpers for the AI generate flow.
 *
 * The browser owns the image manipulation (canvas / blobs); the server
 * route stays a thin proxy to provider APIs. So the conversions live
 * here:
 *   - canvas → PNG blob
 *   - mask convention swap (DecomposeStudio alpha=255 → OpenAI alpha=0)
 *   - resize-to-spec for OpenAI (≥655,360 px, multiples of 16, ≤3:1)
 *
 * Gemini accepts arbitrary input dims, so it gets the source as-is.
 *
 * Submit + polling helpers are also here — `submitGenerate` returns
 * a `Promise<Blob>` that resolves on success, rejects on failure or
 * timeout.
 */

import { defaultAlphaErodeRadius, erodeAlphaInPlace } from "./morphology";
import type { AIJobStatus, ModelInfo, ProviderId } from "./types";

export type ProviderAvailability = {
  id: ProviderId;
  displayName: string;
  capabilities: {
    supportsBinaryMask: boolean;
    supportsNegativePrompt: boolean;
    supportsReferenceImages: boolean;
    defaultModelId: string;
    models: readonly ModelInfo[];
  };
  available: boolean;
  reason?: string;
};

export async function fetchProviders(): Promise<ProviderAvailability[]> {
  const r = await fetch(apiUrl("/api/ai/providers"));
  if (!r.ok) throw new Error(`/api/ai/providers ${r.status}`);
  const data = (await r.json()) as { providers: ProviderAvailability[] };
  return data.providers;
}

// ----- prompt refinement (Sprint 5.4) -----

export type RefinePromptInput = {
  userPrompt: string;
  layerName?: string;
  hasMask: boolean;
  negativePrompt?: string;
  /** PNG of the layer's source canvas (unpadded — the LLM doesn't need
   *  the white border that gpt-image-2 padding adds). The vision pass
   *  reads this so the refined prompt can be tied to what's actually
   *  in [image 1]. */
  sourceImage: Blob;
  /** PNG/JPEG/WebP design references the user attached. The vision
   *  pass reads each so the refined prompt can name concrete design
   *  elements seen in them (palette, pattern, fabric, trim) instead
   *  of using vague style words. */
  referenceImages: Blob[];
};

export type RefinePromptResult = {
  refinedPrompt: string;
  model: string;
};

/**
 * Optional pre-pass that sends the source image + every reference
 * image into a vision-capable OpenAI chat model and asks it to
 * rewrite the user's prompt as a precise gpt-image-2 edit
 * instruction with concrete design descriptions extracted from the
 * references. Errors when the server can't reach the chat endpoint
 * or the OPENAI_API_KEY env isn't set — caller falls back to the
 * raw prompt.
 */
export async function refinePrompt(input: RefinePromptInput): Promise<RefinePromptResult> {
  const form = new FormData();
  form.set("userPrompt", input.userPrompt);
  if (input.layerName) form.set("layerName", input.layerName);
  form.set("hasMask", input.hasMask ? "true" : "false");
  if (input.negativePrompt) form.set("negativePrompt", input.negativePrompt);
  form.set("sourceImage", input.sourceImage, "source.png");
  input.referenceImages.forEach((b, idx) => {
    form.append("referenceImage", b, `ref-${idx}.png`);
  });

  const r = await fetch(apiUrl("/api/ai/refine-prompt"), {
    method: "POST",
    body: form,
  });
  if (!r.ok) {
    const body = await safeJson(r);
    throw new Error(`refine-prompt ${r.status}: ${body?.error ?? r.statusText}`);
  }
  return (await r.json()) as RefinePromptResult;
}

// ----- canvas → blob -----

export async function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))), "image/png");
  });
}

// ----- OpenAI requires the input within specific size constraints -----

/**
 * OpenAI image edits demand:
 *   - max edge ≤ 3840
 *   - both edges multiples of 16
 *   - aspect long:short ≤ 3:1
 *   - total pixels in [655_360, 8_294_400]
 *   - mask must match image dims
 *
 * The simplest valid output: a 1024×1024 center-padded square. Aspect
 * is preserved; padding is transparent so the mask aligns. Generated
 * images come back at 1024×1024 — caller can crop back to the layer's
 * native rect when applying to the atlas (Sprint 3.3).
 */
const OPENAI_TARGET = 1024;

/**
 * Find the tight bounding box of the silhouette (alpha > threshold)
 * within `canvas` and return both a cropped canvas + the bbox in
 * original-canvas coords.
 *
 * Why this matters for gpt-image-2: a layer's atlas region often has
 * lots of transparent space around the actual silhouette (the bbox
 * the runtime packed is generous). If we feed the bbox-shaped source
 * into `padToOpenAISquare` directly, the model sees a small subject
 * pinned in one corner of a mostly-empty 1024² frame and frequently
 * paints its edit *centered* (or anywhere else its prior expects),
 * not at the silhouette's position. After the offset crop + alpha
 * enforce, the misaligned content lands outside the silhouette and
 * gets zeroed out → blank or partial-content results.
 *
 * Cropping to the silhouette before padding keeps the model's
 * "frame" filled by the subject — generated content centers on the
 * silhouette by default, and the apply step re-positions the
 * tight-cropped result back to its original bbox inside the layer
 * canvas.
 *
 * Returns `null` when the canvas is fully transparent (no silhouette
 * to crop to). Callers should fall back to using the canvas verbatim.
 */
export function tightSilhouetteCrop(
  canvas: HTMLCanvasElement,
  alphaThreshold = 1,
): { canvas: HTMLCanvasElement; bbox: { x: number; y: number; w: number; h: number } } | null {
  const W = canvas.width;
  const H = canvas.height;
  if (W <= 0 || H <= 0) return null;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const data = ctx.getImageData(0, 0, W, H).data;

  let minX = W;
  let minY = H;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const a = data[(y * W + x) * 4 + 3];
      if (a >= alphaThreshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0 || maxY < 0) return null;

  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  // Skip the tight-crop pipeline when the silhouette already fills the
  // whole canvas — there's no win and we'd just allocate an extra
  // canvas. Caller can treat the original as the tight crop.
  if (minX === 0 && minY === 0 && w === W && h === H) {
    return { canvas, bbox: { x: 0, y: 0, w, h } };
  }

  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const outCtx = out.getContext("2d");
  if (!outCtx) return null;
  outCtx.drawImage(canvas, minX, minY, w, h, 0, 0, w, h);
  return { canvas: out, bbox: { x: minX, y: minY, w, h } };
}

/**
 * Combined preparation: tight-crop the silhouette, then pad to the
 * OpenAI 1024² square. Returns everything `postprocessGeneratedBlob`
 * needs to put the model's output back at the right place inside the
 * original source canvas:
 *
 *   - `padded` — the canvas to send to OpenAI
 *   - `paddingOffset` — where the tight crop sits inside the 1024²
 *   - `sourceBBox` — where the tight crop came from inside the original
 *     source canvas (so the result composites back at the same place)
 *
 * Falls back to padding the entire source canvas (no tight crop) if
 * the silhouette is fully transparent — should never happen in
 * practice, but the fallback keeps the pipeline alive.
 */
export function prepareOpenAISource(source: HTMLCanvasElement): {
  padded: HTMLCanvasElement;
  paddingOffset: { x: number; y: number; w: number; h: number };
  sourceBBox: { x: number; y: number; w: number; h: number };
} {
  const tight = tightSilhouetteCrop(source);
  const cropCanvas = tight?.canvas ?? source;
  const sourceBBox = tight?.bbox ?? { x: 0, y: 0, w: source.width, h: source.height };
  const { canvas: padded, offset } = padToOpenAISquare(cropCanvas);
  return { padded, paddingOffset: offset, sourceBBox };
}

/**
 * Multi-component preparation: split the source canvas into its
 * disjoint silhouette islands and prep each one independently. Each
 * returned entry is a self-contained submit-ready package — feed it
 * to the gpt-image-2 endpoint, then call `postprocessGeneratedBlob`
 * with the same `paddingOffset` / `sourceBBox` to composite back.
 *
 * Returns a length-1 array (functionally identical to
 * `prepareOpenAISource`) when the source has only one island, so
 * callers can use the same pipeline for both single- and multi-
 * component layers.
 *
 * `componentMaskCanvas` is the source-canvas-sized binary mask for
 * this island — handy for postprocess's alpha enforcement against
 * just this island, and for thumbnail rendering in region-aware UI.
 */
export type PreparedComponent = {
  /** Index of the component in source order (largest island first). */
  componentId: number;
  /** Where this island lives inside the source canvas. */
  sourceBBox: { x: number; y: number; w: number; h: number };
  /** How many opaque pixels this island has. */
  area: number;
  /** 1024² padded canvas with this island filling its frame. */
  padded: HTMLCanvasElement;
  /** Where the (tight-cropped) island sits inside the 1024². */
  paddingOffset: { x: number; y: number; w: number; h: number };
  /** Source-canvas-sized binary mask isolating this island. */
  componentMaskCanvas: HTMLCanvasElement;
  /** The isolated source canvas (other islands zeroed out). Useful
   *  for the LLM refiner pass, which wants to see just this island. */
  isolatedSource: HTMLCanvasElement;
};

/**
 * Variant of `prepareOpenAISourcesPerComponent` that takes a list of
 * pre-built masks instead of running connected-components on the
 * source. Used by GeneratePanel's E.3 path when DecomposeStudio's
 * split mode has persisted user-defined regions for this layer.
 *
 * Each input mask is treated as a single component:
 *   - isolate the source by that mask → per-region canvas
 *   - prepare via the standard tight-crop + 1024² pad pipeline
 *   - return a PreparedComponent that postprocess can place back
 *
 * componentId is the mask's index in the input array, preserving
 * caller order so the panel's tiles map 1:1 to submit calls.
 */
export async function prepareOpenAISourcesFromMasks(
  source: HTMLCanvasElement,
  masks: HTMLCanvasElement[],
): Promise<PreparedComponent[]> {
  const { isolateWithMask } = await import("@/lib/avatar/connectedComponents");
  return masks.map((maskCanvas, idx) => {
    const isolated = isolateWithMask(source, maskCanvas);
    const prepared = prepareOpenAISource(isolated);
    // Compute a coarse area estimate from the prepared sourceBBox.
    // Exact pixel-count area isn't required for the submit path —
    // diagnostic logging and ordering use it, and bbox area is good
    // enough for the manual-region case.
    const area = prepared.sourceBBox.w * prepared.sourceBBox.h;
    return {
      componentId: idx,
      sourceBBox: prepared.sourceBBox,
      area,
      padded: prepared.padded,
      paddingOffset: prepared.paddingOffset,
      componentMaskCanvas: maskCanvas,
      isolatedSource: isolated,
    };
  });
}

export async function prepareOpenAISourcesPerComponent(
  source: HTMLCanvasElement,
  opts: { minArea?: number } = {},
): Promise<PreparedComponent[]> {
  // Lazy-import so the connected-components module stays out of the
  // bundle for callers that never touch the multi-component path.
  const { findAlphaComponents, isolateWithMask } = await import("@/lib/avatar/connectedComponents");
  const components = findAlphaComponents(source, { minArea: opts.minArea });
  if (components.length === 0) {
    // Source has no opaque pixels at all — fall back to the legacy
    // single-source path so the pipeline doesn't dead-end.
    const single = prepareOpenAISource(source);
    return [
      {
        componentId: 0,
        sourceBBox: single.sourceBBox,
        area: 0,
        padded: single.padded,
        paddingOffset: single.paddingOffset,
        componentMaskCanvas: source,
        isolatedSource: source,
      },
    ];
  }

  return components.map((c) => {
    const isolated = isolateWithMask(source, c.maskCanvas);
    const prepared = prepareOpenAISource(isolated);
    return {
      componentId: c.id,
      sourceBBox: prepared.sourceBBox,
      area: c.area,
      padded: prepared.padded,
      paddingOffset: prepared.paddingOffset,
      componentMaskCanvas: c.maskCanvas,
      isolatedSource: isolated,
    };
  });
}

export function padToOpenAISquare(canvas: HTMLCanvasElement): {
  canvas: HTMLCanvasElement;
  /** offset of the original image within the padded square */
  offset: { x: number; y: number; w: number; h: number };
} {
  const { width: w, height: h } = canvas;
  const scale = Math.min(OPENAI_TARGET / w, OPENAI_TARGET / h, 1);
  const drawW = Math.max(1, Math.round(w * scale));
  const drawH = Math.max(1, Math.round(h * scale));
  const dx = Math.round((OPENAI_TARGET - drawW) / 2);
  const dy = Math.round((OPENAI_TARGET - drawH) / 2);

  const out = document.createElement("canvas");
  out.width = OPENAI_TARGET;
  out.height = OPENAI_TARGET;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  // Fill with opaque white before placing the layer. gpt-image-2
  // returns its result as a fully-opaque PNG, which means transparent
  // input pixels effectively render as black in the model's
  // visualization — and that black bias spills into the edit region:
  // a "change red to skin color" prompt against a black-surround
  // input yields dark/black tones, not skin tones. A clean white
  // backdrop gives the model an unambiguous palette to work against
  // and yields the natural skin tones the user expects. The padded
  // area is still flagged "preserve" in the mask so the model copies
  // it through verbatim.
  ctx.fillStyle = "rgba(255, 255, 255, 1)";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, dx, dy, drawW, drawH);
  return { canvas: out, offset: { x: dx, y: dy, w: drawW, h: drawH } };
}

/**
 * Build the OpenAI edit mask. The output is always dimension-matched
 * to the padded source canvas and uses a clean **bbox-based binary**
 * alpha channel:
 *
 *   - alpha=255 (preserve): outside the layer's offset rectangle, or
 *     inside the rectangle but covered by the user's painted mask.
 *   - alpha=0 (edit):       inside the offset rectangle and outside
 *     the user's painted mask. When no user mask exists the whole
 *     offset rectangle is editable.
 *
 * Why bbox instead of triangle silhouette. The earlier design read
 * the padded source's alpha channel and built a footprint-shaped
 * editable region — but that shape has anti-aliased edges and is
 * broken into tiny fragments along the silhouette boundary, which
 * gpt-image-2 handles inconsistently (often producing dark or
 * generation-only outputs). A solid rectangular edit region is much
 * easier for the model to reason about, and the over-paint that
 * spills into the bbox corners outside the actual silhouette gets
 * clipped during postprocess (alpha enforce against the source layer
 * canvas).
 *
 * Why this is also the user's mental model. DecomposeStudio's mask
 * means "erase this region from the final render"; the live
 * compositor applies it destination-out. When sent here, marked
 * pixels become alpha=255 (preserve) so the AI doesn't waste effort
 * on a region that's about to be erased — the compositor finishes
 * the erase after the AI texture lands.
 */
export async function buildOpenAIEditMask(
  paddedSource: HTMLCanvasElement,
  userMaskBlob: Blob | null,
  /** Where the layer's upright canvas was placed inside the padded square. */
  offset: { x: number; y: number; w: number; h: number },
): Promise<HTMLCanvasElement> {
  const W = paddedSource.width;
  const H = paddedSource.height;
  if (!W || !H) throw new Error("padded source has zero dimensions");

  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const outCtx = out.getContext("2d");
  if (!outCtx) throw new Error("2d context unavailable");

  // Rasterize the user mask into the padded coordinate space (if any).
  let userData: ImageData | null = null;
  if (userMaskBlob) {
    const um = document.createElement("canvas");
    um.width = W;
    um.height = H;
    const umCtx = um.getContext("2d");
    if (umCtx) {
      try {
        const img = await blobToImage(userMaskBlob);
        umCtx.drawImage(img, offset.x, offset.y, offset.w, offset.h);
        userData = umCtx.getImageData(0, 0, W, H);
      } catch (e) {
        console.warn("[buildOpenAIEditMask] user mask load failed; ignoring", e);
      }
    }
  }

  const xMin = offset.x;
  const yMin = offset.y;
  const xMax = offset.x + offset.w;
  const yMax = offset.y + offset.h;

  const outData = outCtx.createImageData(W, H);
  let i = 0;
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++, i += 4) {
      // RGB irrelevant to OpenAI alpha-only mask; white is a friendly
      // placeholder for any debug viewer.
      outData.data[i] = 255;
      outData.data[i + 1] = 255;
      outData.data[i + 2] = 255;

      const insideBbox = px >= xMin && px < xMax && py >= yMin && py < yMax;
      if (!insideBbox) {
        outData.data[i + 3] = 255; // preserve outside the bbox
        continue;
      }

      if (userData) {
        // Threshold to 0/255 for a binary mask — anti-aliased mask
        // edges otherwise leave intermediate alpha that can confuse
        // gpt-image-2.
        outData.data[i + 3] = userData.data[i + 3] >= 128 ? 255 : 0;
      } else {
        outData.data[i + 3] = 0;
      }
    }
  }
  outCtx.putImageData(outData, 0, 0);
  return out;
}

async function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("image load failed"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ----- result postprocessing (apply-to-atlas path) -----

/**
 * Turn a raw provider response into an atlas-ready PNG sized to the
 * layer's upright rect. Three transformations:
 *
 *   1. Crop the layer region out of the result. Providers that pad
 *      the input to a square (OpenAI) need the saved offset back —
 *      and because the model may return at a *different* resolution
 *      than we sent (OpenAI without an explicit `size` picks for us),
 *      we scale the offset proportionally so it indexes the right
 *      pixels regardless of output size. Providers that send the
 *      layer at native dims (Gemini) skip the offset and just scale
 *      the whole result to target.
 *
 *   2. Resample to the layer's upright rect. Bilinear is fine —
 *      atlas pages are rendered at 1× anyway and aliasing is hidden
 *      under the alpha enforcement step.
 *
 *   3. Enforce alpha. Inpaint models often return fully-opaque output
 *      even when the source had soft / transparent edges (Cubism mesh
 *      antialiasing, Spine attachment alpha). We multiply the result's
 *      alpha by the upright source canvas's alpha so the pasted
 *      texture never extends past the layer's natural footprint —
 *      this is also what guarantees pixel-perfect re-positioning when
 *      a provider drifts the content slightly.
 */
export async function postprocessGeneratedBlob(opts: {
  blob: Blob;
  /** Upright source canvas — used for both target dimensions and the
   *  alpha-enforcement reference. */
  sourceCanvas: HTMLCanvasElement;
  /** Set when the source was padded to an OpenAI square at submit
   *  time. `paddingOffset` says where the input sat inside the 1024²;
   *  `sourceBBox` (set when `prepareOpenAISource` ran) says where the
   *  input came from inside the original source canvas, so we
   *  composite the result back to that exact rect. */
  openAIPadding?: {
    /** Backwards-compat alias for `paddingOffset`. */
    offset?: { x: number; y: number; w: number; h: number };
    paddingOffset?: { x: number; y: number; w: number; h: number };
    sourceBBox?: { x: number; y: number; w: number; h: number };
    canvasSize?: number;
  };
}): Promise<Blob> {
  const img = await blobToImage(opts.blob);
  const targetW = opts.sourceCanvas.width;
  const targetH = opts.sourceCanvas.height;
  if (!targetW || !targetH) {
    throw new Error("source canvas has zero dimensions");
  }

  const paddingOffset = opts.openAIPadding?.paddingOffset ?? opts.openAIPadding?.offset;
  const sourceBBox = opts.openAIPadding?.sourceBBox;
  const canvasSize = opts.openAIPadding?.canvasSize ?? OPENAI_TARGET;
  console.info(
    `[postprocess] input=${img.naturalWidth}x${img.naturalHeight} → target=${targetW}x${targetH} ` +
      (paddingOffset
        ? `paddingOffset=${JSON.stringify(paddingOffset)} sourceBBox=${
            sourceBBox ? JSON.stringify(sourceBBox) : "(whole canvas)"
          } canvasSize=${canvasSize}`
        : "padding=none"),
  );

  const out = document.createElement("canvas");
  out.width = targetW;
  out.height = targetH;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");

  // Step 1: extract the layer region from the raw result and place it
  // back into the source canvas.
  if (paddingOffset) {
    // OpenAI picks an output size from the input dims; if the response
    // came back at a different resolution, the saved offset (in input
    // coords) needs to be scaled into output coords.
    const sx = (paddingOffset.x / canvasSize) * img.naturalWidth;
    const sy = (paddingOffset.y / canvasSize) * img.naturalHeight;
    const sw = (paddingOffset.w / canvasSize) * img.naturalWidth;
    const sh = (paddingOffset.h / canvasSize) * img.naturalHeight;

    // Where the result should land inside the source-canvas-sized
    // output. With `sourceBBox`, the result was tight-cropped at submit
    // time and must go back to that same rect — anywhere outside it
    // was originally transparent and stays transparent. Without it
    // (legacy path), the result fills the whole source canvas.
    const dx = sourceBBox?.x ?? 0;
    const dy = sourceBBox?.y ?? 0;
    const dw = sourceBBox?.w ?? targetW;
    const dh = sourceBBox?.h ?? targetH;

    console.info(
      `[postprocess] crop src=(${sx.toFixed(0)},${sy.toFixed(0)} ${sw.toFixed(0)}x${sh.toFixed(0)}) → dst=(${dx},${dy} ${dw}x${dh})`,
    );
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  } else {
    // Gemini & friends: scale the whole result to target dims.
    ctx.drawImage(img, 0, 0, targetW, targetH);
  }

  // Step 2: alpha enforcement against the upright source.
  //
  // Eroding the source alpha a few pixels inward before multiplying
  // prevents seam contamination at atlas-island boundaries — atlas
  // pages pack islands ~4 px apart, and the AI's anti-aliased edge
  // would otherwise bleed onto the neighbour at composite time.
  // Radius scales with the silhouette short side; tiny components
  // get the floor (2 px), large ones cap at 8 px.
  const srcCtx = opts.sourceCanvas.getContext("2d");
  if (srcCtx) {
    const srcData = srcCtx.getImageData(0, 0, targetW, targetH);
    const erodeShortSide = sourceBBox
      ? Math.min(sourceBBox.w, sourceBBox.h)
      : Math.min(targetW, targetH);
    const erodeRadius = defaultAlphaErodeRadius(erodeShortSide);
    if (erodeRadius > 0) {
      erodeAlphaInPlace(srcData, erodeRadius);
    }
    console.info(
      `[postprocess] alpha-enforce: erode radius=${erodeRadius}px (shortSide=${erodeShortSide}px)`,
    );
    const cropData = ctx.getImageData(0, 0, targetW, targetH);
    for (let i = 0; i < cropData.data.length; i += 4) {
      cropData.data[i + 3] = Math.round((cropData.data[i + 3] * srcData.data[i + 3]) / 255);
    }
    ctx.putImageData(cropData, 0, 0);
  }

  return await canvasToPngBlob(out);
}

/**
 * Compose mode for `composeAIResultWithMask`. Each value describes a
 * different relationship between the AI's edit and the user's
 * region intent — the GeneratePanel exposes the choice in the
 * RESULT toolbar so the user picks what they actually want, instead
 * of the pipeline silently forcing one interpretation.
 */
export type BlendMode = "ai-only" | "mask-hard";

/**
 * Composite the AI's postprocess result with the original source,
 * gated by the user-painted inpaint mask. Pure client-side op — no
 * model call, no provider — so the user can flip between modes
 * after the AI run completes.
 *
 * Modes:
 *   - `ai-only`: returns `aiResultBlob` unchanged. Use when the
 *     model handled the edit cleanly and the user wants to keep
 *     every pixel of the AI output.
 *   - `mask-hard`: pixels where the mask is WHITE keep the AI
 *     result; pixels where the mask is BLACK revert to the original
 *     source. Use when the model overflowed the intended region —
 *     gpt-image-2 has been observed redrawing the whole silhouette
 *     in response to a "soft hint" mask. This is the post-hoc
 *     enforcement of the user's region intent.
 *
 * Future modes (soft blend / feathered edge / preserve-luma-only)
 * land here without touching the AI pipeline.
 *
 * `maskBlob` is expected at any dims — drawImage resamples to
 * `sourceCanvas` dims. `null`/undefined disables blending regardless
 * of the chosen mode.
 */
export async function composeAIResultWithMask(opts: {
  aiResultBlob: Blob;
  sourceCanvas: HTMLCanvasElement;
  maskBlob: Blob | null;
  mode: BlendMode;
}): Promise<Blob> {
  // No mask attached → there's nothing to blend with. Same for the
  // AI-only mode regardless of mask presence.
  if (opts.mode === "ai-only" || !opts.maskBlob) {
    return opts.aiResultBlob;
  }

  const w = opts.sourceCanvas.width;
  const h = opts.sourceCanvas.height;
  if (w <= 0 || h <= 0) return opts.aiResultBlob;

  const aiImg = await blobToImage(opts.aiResultBlob);
  const maskImg = await blobToImage(opts.maskBlob);

  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d", { willReadFrequently: true });
  if (!ctx) return opts.aiResultBlob;

  // Start from the source so any pixel we don't overwrite stays
  // untouched. Then paint the AI result on top inside masked pixels.
  ctx.drawImage(opts.sourceCanvas, 0, 0);
  const baseData = ctx.getImageData(0, 0, w, h);

  // Resample AI + mask to source dims so we can iterate per-pixel.
  const aiCanvas = document.createElement("canvas");
  aiCanvas.width = w;
  aiCanvas.height = h;
  const aiCtx = aiCanvas.getContext("2d", { willReadFrequently: true });
  if (!aiCtx) return opts.aiResultBlob;
  aiCtx.drawImage(aiImg, 0, 0, w, h);
  const aiData = aiCtx.getImageData(0, 0, w, h);

  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = w;
  maskCanvas.height = h;
  const maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true });
  if (!maskCtx) return opts.aiResultBlob;
  maskCtx.drawImage(maskImg, 0, 0, w, h);
  const maskData = maskCtx.getImageData(0, 0, w, h);

  const out0 = baseData.data;
  const ai = aiData.data;
  const mk = maskData.data;
  let edited = 0;
  for (let i = 0; i < out0.length; i += 4) {
    const luma = (mk[i] + mk[i + 1] + mk[i + 2]) / 3;
    if (luma >= 128) {
      // Mask = edit → take the AI pixel.
      out0[i] = ai[i];
      out0[i + 1] = ai[i + 1];
      out0[i + 2] = ai[i + 2];
      out0[i + 3] = ai[i + 3];
      edited++;
    }
    // else: keep the source pixel that's already in `out0`.
  }
  ctx.putImageData(baseData, 0, 0);
  console.info(`[compose] mask-hard: ${edited}/${out0.length / 4} px replaced with AI output.`);

  return await canvasToPngBlob(out);
}

/**
 * Composite N already-postprocessed component blobs into a single
 * source-canvas-sized image and re-enforce alpha against the full
 * source canvas.
 *
 * Each input blob is expected to be at source-canvas dims with only
 * one component's pixels populated (the rest transparent) — i.e. the
 * exact output of `postprocessGeneratedBlob` called per-component
 * with that component's `componentMaskCanvas` as the alpha-enforce
 * reference. Disjoint components don't fight at composite time, so a
 * straight source-over draw works.
 *
 * The final alpha-enforce against the full source canvas reinstates
 * any anti-aliased edges that the binary per-component masks
 * flattened to 0/255 — keeping the result visually consistent with
 * what the live atlas was already rendering.
 *
 * Single-component callers can also use this (length-1 array) so the
 * pipeline shape doesn't fork.
 */
export async function compositeProcessedComponents(opts: {
  componentBlobs: Blob[];
  sourceCanvas: HTMLCanvasElement;
}): Promise<Blob> {
  const W = opts.sourceCanvas.width;
  const H = opts.sourceCanvas.height;
  if (!W || !H) throw new Error("source canvas has zero dimensions");

  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");

  for (const blob of opts.componentBlobs) {
    const img = await blobToImage(blob);
    ctx.drawImage(img, 0, 0, W, H);
  }

  const srcCtx = opts.sourceCanvas.getContext("2d");
  if (srcCtx) {
    const srcData = srcCtx.getImageData(0, 0, W, H);
    const outData = ctx.getImageData(0, 0, W, H);
    for (let i = 0; i < outData.data.length; i += 4) {
      outData.data[i + 3] = Math.round((outData.data[i + 3] * srcData.data[i + 3]) / 255);
    }
    ctx.putImageData(outData, 0, 0);
  }

  return await canvasToPngBlob(out);
}

// ----- submit + poll -----

export type SubmitGenerateInput = {
  providerId: ProviderId;
  prompt: string;
  /** Sprint 5.4 — optional refined version of `prompt` produced by
   *  the chat-based refinement pass. Server forwards both to the
   *  provider; OpenAI substitutes `refinedPrompt` into its prompt
   *  scaffolding while keeping the raw prompt available for logs. */
  refinedPrompt?: string;
  negativePrompt?: string;
  modelId?: string;
  seed?: number;
  /** PNG of the source region. */
  sourceImage: Blob;
  /** PNG of the mask in the *target provider's* convention (caller
   *  has already done any conversion). Optional. */
  maskImage?: Blob;
  /** Character / style anchor images, sent alongside `sourceImage`
   *  when the provider's `supportsReferenceImages`. Order is
   *  preserved end-to-end. Caller is responsible for filtering out
   *  refs when the picked provider doesn't support them. */
  referenceImages?: Blob[];
  /** Optional binary mask the user painted in the MASK tab. Routed as
   *  an extra image[] reference so the model reads it as a soft
   *  edit-region hint (not a hard inpaint boundary). RGB white = focus
   *  the edit, RGB black = leave alone. OpenAI is the only provider
   *  that currently consumes it; others drop it at the route. */
  maskReferenceImage?: Blob;
  /** How long to keep polling before giving up. */
  timeoutMs?: number;
  /** How often to poll status. */
  pollIntervalMs?: number;
};

/** Submit a generation and resolve to the final image blob. */
export async function submitGenerate(input: SubmitGenerateInput): Promise<Blob> {
  const form = new FormData();
  form.set("providerId", input.providerId);
  form.set("prompt", input.prompt);
  if (input.refinedPrompt) form.set("refinedPrompt", input.refinedPrompt);
  if (input.negativePrompt) form.set("negativePrompt", input.negativePrompt);
  if (input.modelId) form.set("modelId", input.modelId);
  if (typeof input.seed === "number") form.set("seed", String(input.seed));
  form.set("sourceImage", input.sourceImage, "source.png");
  if (input.maskImage) form.set("maskImage", input.maskImage, "mask.png");
  if (input.maskReferenceImage) {
    form.set("maskReferenceImage", input.maskReferenceImage, "mask-reference.png");
  }
  // Reference images: repeat the same key. The route reads them with
  // `formData.getAll("referenceImage")` and forwards as an array to
  // the provider. We use an indexed filename for diagnostics — none
  // of the providers care about the name itself, only the bytes.
  if (input.referenceImages && input.referenceImages.length > 0) {
    input.referenceImages.forEach((ref, idx) => {
      form.append("referenceImage", ref, `ref-${idx}`);
    });
  }

  const submit = await fetch(apiUrl("/api/ai/generate"), { method: "POST", body: form });
  if (!submit.ok) {
    const body = await safeJson(submit);
    throw new Error(`generate ${submit.status}: ${body?.error ?? submit.statusText}`);
  }
  const { jobId } = (await submit.json()) as { jobId: string };

  // OpenAI gpt-image-2 multi-image edits (3 image[] entries + long
  // refined prompt + mask reference) can run 60-150s in our use case.
  // The old 120s ceiling cut off legitimate in-flight calls; 300s
  // covers the worst observed runs without letting genuinely broken
  // submits hang forever.
  const timeoutMs = input.timeoutMs ?? 300_000;
  const intervalMs = input.pollIntervalMs ?? 1500;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    await delay(intervalMs);
    const r = await fetch(apiUrl(`/api/ai/status/${encodeURIComponent(jobId)}`));
    if (!r.ok) {
      throw new Error(`status ${r.status}`);
    }
    const status = (await r.json()) as AIJobStatus;
    if (status.kind === "succeeded") {
      const result = await fetch(apiUrl(`/api/ai/result/${encodeURIComponent(jobId)}`));
      if (!result.ok) throw new Error(`result ${result.status}`);
      return await result.blob();
    }
    if (status.kind === "failed") {
      throw new Error(status.reason);
    }
    if (status.kind === "canceled") {
      throw new Error("job was canceled");
    }
  }
  throw new Error(`generate timed out after ${timeoutMs}ms`);
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function safeJson(r: Response): Promise<{ error?: string } | null> {
  try {
    return (await r.json()) as { error?: string };
  } catch {
    return null;
  }
}
