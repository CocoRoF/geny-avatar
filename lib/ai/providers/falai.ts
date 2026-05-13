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

/** Per-model endpoint paths on queue.fal.run. */
const FLUX_2_EDIT_PATH = "fal-ai/flux-2/edit";
const FLUX_INPAINTING_PATH = "fal-ai/flux-general/inpainting";

const FLUX_2_EDIT_ID = "flux-2-edit";
const FLUX_INPAINTING_ID = "flux-inpainting";

const MODELS: readonly ModelInfo[] = [
  {
    id: FLUX_2_EDIT_ID,
    displayName: "FLUX.2 [edit]",
    description:
      "Instruction-following editor. Cheap bulk fan-out. Best when you want to describe the change in plain words. Struggles on isolated atlas crops (face hallucination, tendril loss).",
  },
  {
    id: FLUX_INPAINTING_ID,
    displayName: "FLUX.1 inpainting (mask-aware)",
    description:
      "Mask-aware inpainting on FLUX.1 [dev]. Sends a binary mask alongside the source so the model only repaints the silhouette region — best fit for atlas-crop layer editing. Slower and base-model is older than flux-2.",
  },
];

export const falaiConfig: ProviderConfig = {
  id: "falai",
  displayName: "fal.ai FLUX",
  capabilities: {
    // flux-inpainting takes a binary mask; flux-2/edit doesn't. We
    // advertise binary mask support at the provider level because the
    // inpainting model is now part of this provider — UI knows to
    // wire the mask channel when fal.ai is picked. The model branch
    // inside generate() decides whether to actually use it.
    supportsBinaryMask: true,
    supportsNegativePrompt: false,
    // image_urls (flux-2/edit) accepts the source + refs in a single
    // ordered list. flux-inpainting takes a single image_url and a
    // mask_url; reference images aren't honoured there. We still
    // advertise refs at the capability level so the UI keeps the user
    // ref affordances when fal.ai is picked.
    supportsReferenceImages: true,
    defaultModelId: FLUX_2_EDIT_ID,
    models: MODELS,
  },
};

export class FalAIProvider implements AIProvider {
  readonly config = falaiConfig;

  constructor(private readonly apiKey: string) {
    if (!apiKey) throw new Error("FAL_KEY is empty");
  }

  async generate(input: ProviderGenerateInput): Promise<Blob> {
    const modelId = input.modelId ?? this.config.capabilities.defaultModelId;
    const { modelPath, body } = await this.buildSubmitBody(modelId, input);

    console.info(
      `[falai] POST ${QUEUE_BASE}/${modelPath}\n` +
        `         model:           ${modelId}\n` +
        `         user prompt:     ${truncate(input.prompt, 200)}\n` +
        `         refined prompt:  ${input.refinedPrompt ? truncate(input.refinedPrompt, 400) : "(none)"}\n` +
        `         composed prompt: ${truncate(String(body.prompt ?? ""), 600)}\n` +
        `         mask:            ${typeof body.mask_url === "string" ? `attached (${(body.mask_url as string).length} char data URI)` : "(none)"}`,
    );

    const submit = await fetch(`${QUEUE_BASE}/${modelPath}`, {
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
    // FLUX.2 Schnell typically finishes in <5 s, FLUX.1 inpainting at
    // 28 steps lands around 10-15 s. 1.5 s cadence balances perceived
    // latency vs API pressure. Hard cap at 3 min — past that the
    // upstream is misbehaving and the user gets a clear failure.
    //
    // Use the URLs the submit response hands back rather than building
    // them from the endpoint path. The actual request_id ends up at a
    // host like `https://queue.fal.run/fal-ai/flux-2/requests/...`
    // (model-family path, not the `.../edit` endpoint that took the
    // submit), and reconstructing it ourselves yields a 405 because
    // the server only honours GETs at the route the submit returned.
    const statusUrl =
      submitted.status_url ?? `${QUEUE_BASE}/${modelPath}/requests/${requestId}/status`;
    const resultUrl = submitted.response_url ?? `${QUEUE_BASE}/${modelPath}/requests/${requestId}`;
    console.info(`[falai] status_url=${statusUrl}\n         response_url=${resultUrl}`);
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

  /**
   * Build the instruction string for flux-2/edit.
   *
   * flux-2/edit is instruction-following but biased toward "complete
   * the character" when handed an isolated atlas crop. Two failure
   * modes observed in this pipeline:
   *
   *   1. **Hallucinated character features.** Hand it a hair-only
   *      atlas crop and it fills the silhouette interior with a face,
   *      eyes, body — interpreting the crop as a character thumbnail
   *      instead of an isolated texture region. The alpha-clip in
   *      postprocess passes those pixels through because they sit
   *      inside the silhouette.
   *   2. **Outline retention.** It reads the silhouette outline as
   *      "the boundary stays" and stamps source-coloured pixels
   *      along the edge even when the intent is a full colour change.
   *
   * The scaffold attacks both:
   *
   *   - Names the input as a texture region, not a thumbnail.
   *   - Forbids adding character features (face / eyes / body /
   *     accessory). Strongest signal flux-2 honours.
   *   - "Edge to edge" instruction for outline replacement.
   *   - Style negation to avoid photoreal drift.
   *   - Reference role disambiguation when refs are attached.
   *
   * The user's intent sits last so the model treats it as the primary
   * instruction, not buried under scaffolding.
   */
  private composePrompt(input: ProviderGenerateInput): string {
    const userIntent = (input.refinedPrompt ?? input.prompt).trim();
    const refs = input.referenceImages ?? [];
    const hasRefs = refs.length > 0;

    const parts: string[] = [
      "[image 1] is an ISOLATED ATLAS TEXTURE REGION (e.g. hair only, jacket only, accessory only) belonging to one drawable of a multi-part Live2D-style 2D rigged puppet. It is NOT a portrait or character thumbnail.",
      "DO NOT add face, eyes, mouth, body, hands, accessories, or any character feature that is not already present in [image 1]. Modify ONLY the pixels of the existing texture region; the rest of the character lives in other drawables and must not leak in.",
    ];
    if (hasRefs) {
      parts.push(
        "Subsequent images (image_urls[1+]) are visual references for desired look only. DO NOT transfer their composition or non-target regions onto [image 1].",
      );
    }
    parts.push(`Edit instruction: ${userIntent.length > 0 ? userIntent : "(none — no-op edit)"}`);
    parts.push(
      "Apply the edit edge to edge: replace the ENTIRE [image 1] silhouette including its outline pixels, not just the interior. The original outline colour must not be preserved when the instruction implies a colour change.",
    );
    parts.push(
      "Style: anime / illustration, soft cel shading. NOT photoreal. NOT 3D. NOT live-action. Output stays an isolated texture region with transparent background — no scene, no character body filled in.",
    );

    return parts.join("\n\n");
  }

  /**
   * Inpainting scaffold — used only for the flux-general/inpainting
   * endpoint. The mask channel handles spatial containment, but the
   * model's prior still wants to "complete" the silhouette into a
   * character (face, body, accessories) when the masked region looks
   * like an isolated atlas crop. The scaffold attacks this directly:
   *
   *   - Names the source as a texture region, not a thumbnail.
   *   - Forbids character features explicitly (strongest negative
   *     signal flux honours).
   *   - Anime / illustration style negation against photoreal drift.
   *   - Keeps the user intent at the end so it reads as the primary
   *     instruction.
   */
  private composeInpaintingPrompt(input: ProviderGenerateInput): string {
    const userIntent = (input.refinedPrompt ?? input.prompt).trim();
    return [
      "The image is one drawable from a multi-part Live2D-style 2D rigged puppet — an ISOLATED ATLAS TEXTURE REGION, NOT a portrait or character thumbnail.",
      "Repaint ONLY the masked region. DO NOT add face, eyes, mouth, body, hands, accessories, or any character feature that is not already present. The grey background outside the mask is just padding; do not bleed colours into it and do not treat the silhouette as a complete character to draw.",
      `Edit instruction: ${userIntent.length > 0 ? userIntent : "(no-op edit — keep the region close to the original)"}`,
      "Style: anime / illustration, soft cel shading. NOT photoreal. NOT 3D. Keep the line weight and shading style of the original.",
    ].join("\n\n");
  }

  /**
   * Build the (endpoint path, JSON body) pair for the picked model.
   * Two paths today; both go through the same submit / poll loop
   * downstream so the wiring stays simple.
   */
  private async buildSubmitBody(
    modelId: string,
    input: ProviderGenerateInput,
  ): Promise<{ modelPath: string; body: Record<string, unknown> }> {
    if (modelId === FLUX_INPAINTING_ID) {
      if (!input.maskImage) {
        // The client (`GeneratePanel`) is expected to derive a mask
        // from the source canvas alpha for the inpainting model so
        // the entire component becomes the edit zone. Hitting this
        // branch means the auto-derive step didn't run — either an
        // older client or a direct API caller.
        throw new Error(
          "fal.ai flux-inpainting requires a binary mask, but none was attached. " +
            "Normally the client derives one from the source alpha. If you're calling " +
            "the API directly, attach `maskImage` as a white-on-black PNG.",
        );
      }
      const imageDataUri = await blobToDataUri(input.sourceImage);
      const maskDataUri = await maskBlobToBinaryDataUri(input.maskImage);
      const promptText = this.composeInpaintingPrompt(input);
      const body: Record<string, unknown> = {
        prompt: promptText,
        image_url: imageDataUri,
        mask_url: maskDataUri,
        // Full repaint inside the mask. Lower values let source colour
        // bleed through, which is the whole problem we're solving.
        strength: 1.0,
        // 28 is the model default; tighter inference saves cost, but
        // anime detail wants the full count. Re-evaluate after eval.
        num_inference_steps: 28,
        guidance_scale: 3.5,
      };
      if (typeof input.seed === "number") body.seed = input.seed;
      return { modelPath: FLUX_INPAINTING_PATH, body };
    }

    // Default: flux-2/edit (instruction-following, no mask).
    const refs = input.referenceImages ?? [];
    const sourceDataUri = await blobToDataUri(input.sourceImage);
    const refDataUris = await Promise.all(refs.map(blobToDataUri));
    const imageUrls = [sourceDataUri, ...refDataUris].slice(0, 4);
    const promptText = this.composePrompt(input);
    const body: Record<string, unknown> = {
      prompt: promptText,
      image_urls: imageUrls,
      output_format: "png",
      enable_safety_checker: false,
    };
    if (typeof input.seed === "number") body.seed = input.seed;
    return { modelPath: FLUX_2_EDIT_PATH, body };
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

/**
 * Encode a mask blob for flux-general/inpainting.
 *
 * Current behaviour: forward the mask bytes verbatim. DecomposeStudio
 * stores masks as PNGs with `alpha=255` marking the edit region; many
 * diffusion inpainters honour either the alpha channel or the RGB
 * luma when picking the edit zone. Forwarding the bytes as-is gets us
 * past the API contract and lets us observe what fal.ai's renderer
 * actually does with the convention.
 *
 * If results show the mask is being interpreted backwards (or ignored
 * outright), the next step is to bake the alpha into RGB on the client
 * (`alpha=255 → white(255,255,255), alpha=0 → black(0,0,0)`) before
 * uploading. We avoid the conversion on the server because Node doesn't
 * have canvas / sharp wired in this project and adding either is a
 * larger commitment than this hotfix wants to make.
 */
async function maskBlobToBinaryDataUri(blob: Blob): Promise<string> {
  return blobToDataUri(blob);
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
