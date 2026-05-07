"use client";

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

import type { AIJobStatus, ModelInfo, ProviderId } from "./types";

export type ProviderAvailability = {
  id: ProviderId;
  displayName: string;
  capabilities: {
    supportsBinaryMask: boolean;
    supportsNegativePrompt: boolean;
    defaultModelId: string;
    models: readonly ModelInfo[];
  };
  available: boolean;
  reason?: string;
};

export async function fetchProviders(): Promise<ProviderAvailability[]> {
  const r = await fetch("/api/ai/providers");
  if (!r.ok) throw new Error(`/api/ai/providers ${r.status}`);
  const data = (await r.json()) as { providers: ProviderAvailability[] };
  return data.providers;
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
  ctx.drawImage(canvas, dx, dy, drawW, drawH);
  return { canvas: out, offset: { x: dx, y: dy, w: drawW, h: drawH } };
}

/**
 * Build the OpenAI edit mask. The output is *always* dimension-matched
 * to the padded source canvas and the mask alpha channel encodes:
 *
 *   - alpha=255 (preserve): outside the layer's footprint — the
 *     padded zone outside `offset`, plus any inside-layer pixels the
 *     user explicitly chose to keep via DecomposeStudio.
 *   - alpha=0 (edit): inside the layer's footprint AND either no user
 *     mask exists (regenerate the whole layer) or the user marked the
 *     pixel for editing.
 *
 * The "inside footprint" map comes from the padded source canvas's
 * own alpha channel — `extractLayerCanvas` triangle-clips the source
 * so its alpha is exactly the layer's shape, including soft edges.
 *
 * This is the key correctness lever: with a tight mask, OpenAI is
 * mathematically constrained to copy the input pixel for any pixel
 * outside the layer (the API spec is explicit about this), so the
 * generated layer can never end up offset, scaled, or surrounded by
 * model-painted background.
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

  // Source alpha tells us where the layer is. We read the entire
  // padded canvas because it carries both the layer's silhouette
  // (from the triangle clip) AND fully-transparent padding outside.
  const srcCtx = paddedSource.getContext("2d");
  if (!srcCtx) throw new Error("2d context unavailable");
  const srcData = srcCtx.getImageData(0, 0, W, H);

  // Optionally rasterize the user's mask into the padded coordinate
  // space, scaling/positioning into `offset`. Anywhere outside the
  // offset (the padded zone) gets alpha=0 by default — we treat that
  // as "user didn't mark", which falls back to footprint behavior.
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

  const outData = outCtx.createImageData(W, H);
  for (let i = 0; i < outData.data.length; i += 4) {
    // RGB is irrelevant to OpenAI but we set it to white to keep the
    // PNG human-debuggable in any viewer that doesn't honor alpha.
    outData.data[i] = 255;
    outData.data[i + 1] = 255;
    outData.data[i + 2] = 255;

    const insideFootprint = srcData.data[i + 3] > 0;
    if (!insideFootprint) {
      // Outside the layer footprint — preserve the (transparent) input
      // pixel. This is what stops OpenAI from painting a background
      // around the layer.
      outData.data[i + 3] = 255;
      continue;
    }

    if (userData) {
      // Inside footprint — user mask decides. Convert convention:
      // DecomposeStudio uses alpha=255 for "edit", OpenAI uses alpha=0.
      outData.data[i + 3] = 255 - userData.data[i + 3];
    } else {
      // Inside footprint, no user mask — let OpenAI edit the whole
      // layer.
      outData.data[i + 3] = 0;
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
   *  time. Carries both the offset where the layer sat and the square
   *  size we padded to (defaults to `OPENAI_TARGET`). The output may
   *  not be at `canvasSize` — we scale offsets to whatever it is. */
  openAIPadding?: {
    offset: { x: number; y: number; w: number; h: number };
    canvasSize?: number;
  };
}): Promise<Blob> {
  const img = await blobToImage(opts.blob);
  const targetW = opts.sourceCanvas.width;
  const targetH = opts.sourceCanvas.height;
  if (!targetW || !targetH) {
    throw new Error("source canvas has zero dimensions");
  }

  const out = document.createElement("canvas");
  out.width = targetW;
  out.height = targetH;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");

  // Step 1: extract the layer region.
  if (opts.openAIPadding) {
    const { offset } = opts.openAIPadding;
    const canvasSize = opts.openAIPadding.canvasSize ?? OPENAI_TARGET;
    // OpenAI picks an output size from the input dims; if the response
    // came back at a different resolution, the saved offset (in input
    // coords) needs to be scaled into output coords.
    const sx = (offset.x / canvasSize) * img.naturalWidth;
    const sy = (offset.y / canvasSize) * img.naturalHeight;
    const sw = (offset.w / canvasSize) * img.naturalWidth;
    const sh = (offset.h / canvasSize) * img.naturalHeight;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH);
  } else {
    // Gemini & friends: scale the whole result to target dims.
    ctx.drawImage(img, 0, 0, targetW, targetH);
  }

  // Step 2: alpha enforcement against the upright source.
  const srcCtx = opts.sourceCanvas.getContext("2d");
  if (srcCtx) {
    const srcData = srcCtx.getImageData(0, 0, targetW, targetH);
    const cropData = ctx.getImageData(0, 0, targetW, targetH);
    for (let i = 0; i < cropData.data.length; i += 4) {
      cropData.data[i + 3] = Math.round((cropData.data[i + 3] * srcData.data[i + 3]) / 255);
    }
    ctx.putImageData(cropData, 0, 0);
  }

  return await canvasToPngBlob(out);
}

// ----- submit + poll -----

export type SubmitGenerateInput = {
  providerId: ProviderId;
  prompt: string;
  negativePrompt?: string;
  modelId?: string;
  seed?: number;
  /** PNG of the source region. */
  sourceImage: Blob;
  /** PNG of the mask in the *target provider's* convention (caller
   *  has already done any conversion). Optional. */
  maskImage?: Blob;
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
  if (input.negativePrompt) form.set("negativePrompt", input.negativePrompt);
  if (input.modelId) form.set("modelId", input.modelId);
  if (typeof input.seed === "number") form.set("seed", String(input.seed));
  form.set("sourceImage", input.sourceImage, "source.png");
  if (input.maskImage) form.set("maskImage", input.maskImage, "mask.png");

  const submit = await fetch("/api/ai/generate", { method: "POST", body: form });
  if (!submit.ok) {
    const body = await safeJson(submit);
    throw new Error(`generate ${submit.status}: ${body?.error ?? submit.statusText}`);
  }
  const { jobId } = (await submit.json()) as { jobId: string };

  const timeoutMs = input.timeoutMs ?? 120_000;
  const intervalMs = input.pollIntervalMs ?? 1500;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    await delay(intervalMs);
    const r = await fetch(`/api/ai/status/${encodeURIComponent(jobId)}`);
    if (!r.ok) {
      throw new Error(`status ${r.status}`);
    }
    const status = (await r.json()) as AIJobStatus;
    if (status.kind === "succeeded") {
      const result = await fetch(`/api/ai/result/${encodeURIComponent(jobId)}`);
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
