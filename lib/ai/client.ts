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
