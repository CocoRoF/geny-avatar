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
 * Build the OpenAI mask canvas from our DecomposeStudio mask blob.
 *
 * Conversion:
 *   - DecomposeStudio: alpha=255 means "user marked this region for editing"
 *   - OpenAI:          alpha=0   means "edit this region" (transparent)
 * So we invert the alpha channel.
 *
 * Also pads to the same square as `padToOpenAISquare` so dimensions
 * line up byte-for-byte. Padded zone is opaque (alpha=255) → "preserve",
 * which is what we want — the AI shouldn't paint outside the layer.
 */
export async function buildOpenAIMaskCanvas(
  studioMask: Blob,
  offset: { x: number; y: number; w: number; h: number },
): Promise<HTMLCanvasElement> {
  const img = await blobToImage(studioMask);

  // Step 1: render the original mask onto a canvas matching its native
  // size, then read alpha channel and invert.
  const inv = document.createElement("canvas");
  inv.width = img.naturalWidth || img.width;
  inv.height = img.naturalHeight || img.height;
  const invCtx = inv.getContext("2d");
  if (!invCtx) throw new Error("2d context unavailable");
  invCtx.drawImage(img, 0, 0);
  const data = invCtx.getImageData(0, 0, inv.width, inv.height);
  for (let i = 0; i < data.data.length; i += 4) {
    // OpenAI reads alpha; RGB is irrelevant. Set RGB to white for
    // clarity in case the API or any debug viewer renders it.
    data.data[i] = 255;
    data.data[i + 1] = 255;
    data.data[i + 2] = 255;
    data.data[i + 3] = 255 - data.data[i + 3];
  }
  invCtx.putImageData(data, 0, 0);

  // Step 2: place the inverted mask into a target-sized square. The
  // padded zone is opaque (alpha=255) by default since we paint white
  // first — that means "preserve", so the model only edits inside the
  // original layer footprint.
  const out = document.createElement("canvas");
  out.width = OPENAI_TARGET;
  out.height = OPENAI_TARGET;
  const outCtx = out.getContext("2d");
  if (!outCtx) throw new Error("2d context unavailable");
  outCtx.fillStyle = "rgba(255, 255, 255, 1)";
  outCtx.fillRect(0, 0, out.width, out.height);
  outCtx.drawImage(inv, offset.x, offset.y, offset.w, offset.h);
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
 * layer's upright rect. Two transformations:
 *
 *   1. Crop OpenAI's 1024² padding back to the original layer shape.
 *      The client's `padToOpenAISquare` tracked the offset; we pass
 *      it back in and crop the inner region. Gemini callers omit the
 *      offset and the result just gets scaled to the target dims.
 *
 *   2. Enforce alpha. Inpaint models often return fully-opaque output
 *      even when the source had soft / transparent edges (Cubism mesh
 *      antialiasing, Spine attachment alpha). We multiply the result's
 *      alpha by the upright source canvas's alpha so the pasted
 *      texture never extends past the layer's natural footprint.
 */
export async function postprocessGeneratedBlob(opts: {
  blob: Blob;
  /** Upright source canvas — used for both target dimensions and the
   *  alpha-enforcement reference. */
  sourceCanvas: HTMLCanvasElement;
  /** OpenAI 1024² offset returned by `padToOpenAISquare`. Omit for
   *  providers that don't pad (e.g. Gemini). */
  sourceOffset?: { x: number; y: number; w: number; h: number };
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

  // Step 1: crop padding back out (or just scale).
  if (opts.sourceOffset) {
    ctx.drawImage(
      img,
      opts.sourceOffset.x,
      opts.sourceOffset.y,
      opts.sourceOffset.w,
      opts.sourceOffset.h,
      0,
      0,
      targetW,
      targetH,
    );
  } else {
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
