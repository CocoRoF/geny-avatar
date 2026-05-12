/**
 * fal.ai FLUX.2 [edit] image-to-image.
 *
 * Why we have this on top of OpenAI gpt-image-2:
 *   - Bulk fan-out is dramatically cheaper. Schnell tier images are
 *     roughly 10× less than gpt-image-2 at "high" quality. For multi-
 *     drawable group regeneration (Phase 3 orchestrator) the savings
 *     are real.
 *   - FLUX.2 takes up to 4 image inputs vs gpt-image-2's 4 — we don't
 *     pick up more headroom for refs but the model's identity
 *     preservation across refs is stronger.
 *   - When gpt-image-2 mask convention bites (anti-aliased bleed at
 *     atlas seams), FLUX.2 sometimes recovers cleaner edges because
 *     it doesn't try to honour the mask as a hard binary.
 *
 * API ref: https://fal.ai/models/fal-ai/flux-2/edit
 *
 * Endpoint pattern (queue API):
 *   POST   https://queue.fal.run/fal-ai/flux-2/edit
 *   GET    https://queue.fal.run/fal-ai/flux-2/edit/requests/{id}/status
 *   GET    https://queue.fal.run/fal-ai/flux-2/edit/requests/{id}
 *
 * Auth: `Authorization: Key $FAL_KEY` header.
 *
 * Input shape (POST body, JSON):
 *   { prompt, image_urls: string[1..4], output_format: "png",
 *     guidance_scale?, num_inference_steps?, seed?, sync_mode? }
 *
 *   image_urls may be public URLs or `data:image/...;base64,` URIs.
 *   We use data URIs so the route doesn't need an upload step. PNG
 *   blobs in the ~1 MB range encode to ~1.4 MB base64 — fine for
 *   the JSON body.
 *
 * Output shape (queue completion):
 *   { images: [{ url, content_type, ... }], seed, ... }
 *
 *   The first image is the result. We GET its url to recover the
 *   final PNG blob.
 *
 * No mask file: flux-2/edit is instruction-following, not inpainting.
 * The source image's alpha channel implicitly carries the silhouette
 * (same as gpt-image-2 in our pipeline), which is enough.
 */

import type { ModelInfo } from "../types";
import type { AIProvider, ProviderConfig, ProviderGenerateInput } from "./interface";

const QUEUE_BASE = "https://queue.fal.run";
const MODEL_PATH = "fal-ai/flux-2/edit";

const MODELS: readonly ModelInfo[] = [
  {
    id: "flux-2-edit",
    displayName: "FLUX.2 [edit]",
    description:
      "BFL's instruction-following image editor. Cheaper bulk runs, stronger identity preservation than gpt-image-2 across multi-ref edits.",
  },
];

export const falaiConfig: ProviderConfig = {
  id: "falai",
  displayName: "fal.ai FLUX.2",
  capabilities: {
    // flux-2/edit is instruction-following — no binary mask channel.
    supportsBinaryMask: false,
    supportsNegativePrompt: false,
    // image_urls accepts the source + refs in a single ordered list,
    // same posture as gpt-image-2's image[] array.
    supportsReferenceImages: true,
    defaultModelId: MODELS[0].id,
    models: MODELS,
  },
};

export class FalAIProvider implements AIProvider {
  readonly config = falaiConfig;

  constructor(private readonly apiKey: string) {
    if (!apiKey) throw new Error("FAL_KEY is empty");
  }

  async generate(input: ProviderGenerateInput): Promise<Blob> {
    const refs = input.referenceImages ?? [];
    // First entry is the source. flux-2/edit reads the edit subject
    // from image_urls[0] and treats the rest as visual references in
    // the same way gpt-image-2 does.
    const sourceDataUri = await blobToDataUri(input.sourceImage);
    const refDataUris = await Promise.all(refs.map(blobToDataUri));
    const imageUrls = [sourceDataUri, ...refDataUris].slice(0, 4);

    const promptText = (input.refinedPrompt ?? input.prompt).trim();

    const body: Record<string, unknown> = {
      prompt: promptText,
      image_urls: imageUrls,
      output_format: "png",
      enable_safety_checker: false,
    };
    if (typeof input.seed === "number") body.seed = input.seed;

    console.info(
      `[falai] POST ${QUEUE_BASE}/${MODEL_PATH}\n` +
        `         image_urls: ${imageUrls.length} entries (1 source + ${imageUrls.length - 1} refs)\n` +
        `         user prompt:     ${truncate(input.prompt, 200)}\n` +
        `         refined prompt:  ${input.refinedPrompt ? truncate(input.refinedPrompt, 400) : "(none)"}`,
    );

    const submit = await fetch(`${QUEUE_BASE}/${MODEL_PATH}`, {
      method: "POST",
      headers: {
        Authorization: `Key ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!submit.ok) {
      const text = await safeText(submit);
      console.warn(`[falai] submit error ${submit.status}: ${truncate(text, 600)}`);
      throw new Error(`fal.ai submit ${submit.status}: ${truncate(text, 400)}`);
    }
    const submitted = (await submit.json()) as FalSubmitResponse;
    if (!submitted.request_id) {
      throw new Error("fal.ai submit response missing request_id");
    }
    const requestId = submitted.request_id;
    console.info(`[falai] queued request_id=${requestId}`);

    // Poll status until COMPLETED. fal.ai recommends 1–2 s intervals;
    // FLUX.2 Schnell typically finishes in <5 s, FLUX.2 Dev/Pro in
    // 15–30 s, so a 1.5 s cadence balances perceived latency vs API
    // pressure. Hard cap at 3 min — past that the upstream is
    // misbehaving and the user gets a clear failure.
    const statusUrl = `${QUEUE_BASE}/${MODEL_PATH}/requests/${requestId}/status`;
    const resultUrl = `${QUEUE_BASE}/${MODEL_PATH}/requests/${requestId}`;
    const startedAt = Date.now();
    const timeoutMs = 180_000;
    const pollMs = 1500;

    while (Date.now() - startedAt < timeoutMs) {
      await delay(pollMs);
      const s = await fetch(statusUrl, {
        headers: { Authorization: `Key ${this.apiKey}` },
      });
      if (!s.ok) {
        const text = await safeText(s);
        console.warn(`[falai] status ${s.status}: ${truncate(text, 400)}`);
        // Transient 5xx — keep polling. Hard 4xx — bail.
        if (s.status >= 400 && s.status < 500) {
          throw new Error(`fal.ai status ${s.status}: ${truncate(text, 200)}`);
        }
        continue;
      }
      const state = (await s.json()) as FalStatusResponse;
      if (state.status === "COMPLETED") {
        break;
      }
      if (state.status === "FAILED" || state.status === "CANCELED") {
        throw new Error(`fal.ai job ${state.status.toLowerCase()}: request_id=${requestId}`);
      }
      // IN_QUEUE / IN_PROGRESS — keep polling.
    }

    const r = await fetch(resultUrl, {
      headers: { Authorization: `Key ${this.apiKey}` },
    });
    if (!r.ok) {
      const text = await safeText(r);
      throw new Error(`fal.ai result ${r.status}: ${truncate(text, 400)}`);
    }
    const result = (await r.json()) as FalResultResponse;
    const first = result.images?.[0];
    if (!first?.url) {
      throw new Error("fal.ai result missing images[0].url");
    }
    const elapsed = Date.now() - startedAt;
    console.info(`[falai] completed in ${elapsed}ms → ${first.url}`);

    // fal.media URLs are publicly accessible — no auth header needed.
    const blob = await fetch(first.url).then((res) => {
      if (!res.ok) throw new Error(`fal.media fetch ${res.status}`);
      return res.blob();
    });
    console.info(`[falai] result blob: ${blob.size} bytes`);
    return blob;
  }
}

type FalSubmitResponse = {
  request_id?: string;
  status_url?: string;
  response_url?: string;
};

type FalStatusResponse = {
  status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "CANCELED";
  queue_position?: number;
};

type FalResultResponse = {
  images?: { url?: string; content_type?: string; width?: number; height?: number }[];
  seed?: number;
};

async function blobToDataUri(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const mime = blob.type || "image/png";
  // Node 18+ runtime in Next.js server routes — `Buffer` is global. The
  // browser path never reaches this provider (registry is server-only).
  const b64 = Buffer.from(buf).toString("base64");
  return `data:${mime};base64,${b64}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function safeText(r: Response): Promise<string> {
  try {
    return await r.text();
  } catch {
    return "<unreadable response body>";
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}
