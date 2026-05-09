/**
 * OpenAI gpt-image-2 image edits.
 *
 * API ref: https://developers.openai.com/api/docs/guides/image-generation
 *   POST https://api.openai.com/v1/images/edits
 *   Header: Authorization: Bearer $OPENAI_API_KEY
 *   Body: multipart/form-data
 *     model       (string, required)   — "gpt-image-2" / "gpt-image-1.5" / "gpt-image-1" / "dall-e-2"
 *     image       (file, required)     — PNG/JPEG/WebP source
 *     mask        (file, optional)     — PNG with alpha; **alpha=0 = edit zone** (transparent)
 *     prompt      (string, required)   — edit instruction
 *     n           (int, default 1)
 *     size        (string, default "auto") — "1024x1024", "1536x1024", "1024x1536", "2048x2048"
 *     quality     (string, default "auto") — "low" | "medium" | "high" | "auto"
 *     response_format (string, default "b64_json") — "b64_json" | "url"
 *
 * Image constraints:
 *   - max edge 3840px
 *   - both edges multiple of 16
 *   - aspect long:short ≤ 3:1
 *   - total pixels 655,360 – 8,294,400
 *   - image and mask must be same format and same dimensions
 *
 * Mask convention conversion: our DecomposeStudio saves alpha=255 where
 * the user marked "edit me", but OpenAI uses alpha=0 = edit zone. The
 * client (`lib/ai/maskConvert.ts`) inverts before this provider sees
 * the request so server-side stays simple.
 */

import type { ModelInfo } from "../types";
import type { AIProvider, ProviderConfig, ProviderGenerateInput } from "./interface";

const ENDPOINT = "https://api.openai.com/v1/images/edits";

const MODELS: readonly ModelInfo[] = [
  {
    id: "gpt-image-2",
    displayName: "gpt-image-2",
    description: "Latest OpenAI image-edit model. Highest quality of the family.",
  },
  {
    id: "gpt-image-1.5",
    displayName: "gpt-image-1.5",
    description: "Mid-generation refresh between gpt-image-1 and 2.",
  },
  {
    id: "gpt-image-1",
    displayName: "gpt-image-1",
    description: "First production gpt-image edit model.",
  },
  {
    id: "dall-e-2",
    displayName: "DALL·E 2",
    description: "Older edit-only model. Cheaper but lower fidelity.",
  },
];

export const openaiConfig: ProviderConfig = {
  id: "openai",
  displayName: "OpenAI gpt-image",
  capabilities: {
    supportsBinaryMask: true,
    supportsNegativePrompt: false, // gpt-image edits don't carry a separate field
    // gpt-image-2's /v1/images/edits accepts `image[]` arrays — first
    // entry is the masked source, the rest act as character / style
    // refs. Older models like dall-e-2 silently ignore the extras;
    // we let the API decide rather than gating per model id.
    supportsReferenceImages: true,
    defaultModelId: MODELS[0].id,
    models: MODELS,
  },
};

export class OpenAIProvider implements AIProvider {
  readonly config = openaiConfig;

  constructor(private readonly apiKey: string) {
    if (!apiKey) throw new Error("OPENAI_API_KEY is empty");
  }

  async generate(input: ProviderGenerateInput): Promise<Blob> {
    const model = input.modelId ?? this.config.capabilities.defaultModelId;
    const refs = input.referenceImages ?? [];

    const composedPromptText = this.composePrompt(input);
    const form = new FormData();
    form.set("model", model);
    form.set("prompt", composedPromptText);
    form.set("n", "1");
    // Image and mask must be PNG with matching dims. The client guarantees
    // both via lib/ai/client.ts (padToOpenAISquare + buildOpenAIMaskCanvas)
    // before calling /api/ai/generate. We deliberately omit `size`,
    // `quality`, and `response_format`: the live edits endpoint
    // validates these strictly per-model and 400s on values that the
    // public docs *show* as valid for some siblings (e.g. gpt-image-2
    // rejects `quality: "auto"` even though gpt-image-1 docs list it).
    // Defaults pick a sensible size from the input dims and return
    // b64_json, which is what we want.
    //
    // Multi-image: the docs use `image[]` array notation
    //   curl -F "image[]=@a.png" -F "image[]=@b.png" ...
    // The first entry is the one the mask is applied to. We always put
    // the layer source there; reference images come after as character
    // / style anchors. fetch's FormData repeats the key for arrays, so
    // a single `image` key with multiple appends would be ambiguous —
    // we use the explicit `image[]` notation for safety.
    form.append("image[]", input.sourceImage, "source.png");
    refs.forEach((ref, idx) => {
      const ext = blobExtension(ref);
      form.append("image[]", ref, `reference-${idx}.${ext}`);
    });
    if (input.maskImage) {
      form.set("mask", input.maskImage, "mask.png");
    }

    const startedAt = Date.now();
    // Server-side structured log — visible in the next.js dev terminal.
    // Mirrors the client-side [ai/submit] group so the operator can
    // correlate request shape end-to-end without trusting the network
    // panel.
    console.info(
      `[openai] POST ${ENDPOINT}\n` +
        `         model: ${model}\n` +
        `         image[]: ${1 + refs.length} entries\n` +
        `           [0] source: ${input.sourceImage.size}B (${input.sourceImage.type || "?"})\n` +
        refs
          .map(
            (r, i) =>
              `           [${i + 1}] reference: ${r.size}B (${r.type || "?"}) — ride-along anchor`,
          )
          .join("\n") +
        (refs.length > 0 ? "\n" : "") +
        `         mask: ${input.maskImage ? `${input.maskImage.size}B (applied to image[0])` : "(none)"}\n` +
        `         user prompt:     ${truncate(input.prompt, 200)}\n` +
        `         composed prompt: ${truncate(composedPromptText, 600)}`,
    );

    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });

    const elapsed = Date.now() - startedAt;
    console.info(`[openai] response ${response.status} in ${elapsed}ms`);

    if (!response.ok) {
      const text = await safeText(response);
      console.warn(`[openai] error body: ${truncate(text, 1000)}`);
      throw new Error(`OpenAI API ${response.status}: ${truncate(text, 600)}`);
    }

    const data = (await response.json()) as OpenAIResponse;
    const first = data.data?.[0];
    if (!first) {
      throw new Error("OpenAI response carried no data entry");
    }
    if (typeof first.b64_json === "string") {
      const blob = base64ToBlob(first.b64_json, "image/png");
      console.info(`[openai] result blob: ${blob.size} bytes (b64_json path)`);
      return blob;
    }
    if (typeof first.url === "string") {
      const r = await fetch(first.url);
      if (!r.ok) throw new Error(`OpenAI url fetch failed: ${r.status}`);
      const blob = await r.blob();
      console.info(`[openai] result blob: ${blob.size} bytes (url path)`);
      return blob;
    }
    throw new Error("OpenAI response carried neither b64_json nor url");
  }

  /**
   * Compose the final prompt for `/v1/images/edits` using gpt-image-2's
   * documented best practices for multi-image input.
   *
   * The earlier version gave the user prompt first then bolted on a
   * one-line ref hint. That left the model guessing which input was
   * the canvas vs which was a style anchor — when the user typed
   * "make this look like the reference", the model often pasted the
   * reference's content (faces, accessories) into the result instead
   * of just matching its palette / lighting.
   *
   * The structured composition below is grounded in the
   * gpt-image-2.art prompting guide:
   *
   *   1. **Slot map first** — explicitly label `[image 1]` as the
   *      texture canvas and `[image 2..N]` as style-only references.
   *      Spells out "do not copy content" so the model can't conflate
   *      the two roles even with ambiguous user wording.
   *
   *   2. **User intent under an explicit "Edit" verb** — the user
   *      prompt is wrapped in `Edit [image 1]: ...` so it's clear
   *      which image gets modified.
   *
   *   3. **Preservation block** — silhouette, geometry, composition,
   *      and (when no mask is supplied) "any pixels not affected by
   *      the requested edit". The guide is emphatic that without
   *      explicit preserves the model reinterprets the whole scene.
   *
   *   4. **Mask role hint** — when a mask is present, restate that
   *      pixels outside the mask must come through unchanged. This
   *      reinforces the convention image[0]-with-mask and isolates
   *      the model's freedom to the marked region.
   *
   *   5. **Negative prompt as "Avoid:" tail** — no separate field on
   *      this endpoint; suffix is the documented workaround.
   *
   * If the caller passed `refinedPrompt` (from the LLM refinement
   * pipeline), it replaces the user prompt slot. The other scaffolding
   * still wraps it so even a refined prompt benefits from the
   * preservation / role-separation language.
   */
  private composePrompt(input: ProviderGenerateInput): string {
    const refs = input.referenceImages ?? [];
    const hasRefs = refs.length > 0;
    const hasMask = !!input.maskImage;
    const userIntent = (input.refinedPrompt ?? input.prompt).trim();

    const sections: string[] = [];

    // 1. Slot map (only meaningful when refs are attached)
    if (hasRefs) {
      const refLabels =
        refs.length === 1 ? "[image 2]" : refs.map((_, i) => `[image ${i + 2}]`).join(", ");
      sections.push(
        `Inputs: [image 1] is the texture canvas to edit. ${refLabels} ${
          refs.length === 1
            ? "is a style and character reference"
            : "are style and character references"
        } — extract palette, lighting, line quality, material rendering, and identity cues, but do NOT copy any objects, characters, faces, accessories, or scene content from ${
          refs.length === 1 ? "it" : "them"
        } into the result. The reference content must not appear inside [image 1]'s output.`,
      );
    }

    // 2. The actual edit instruction
    sections.push(`Edit [image 1]: ${userIntent}`);

    // 3. Preservation
    const preservation = [
      "the silhouette and outline of [image 1]",
      "the geometry, pose, and proportions",
      "the composition and crop framing",
    ];
    if (!hasMask) {
      preservation.push("any pixels in [image 1] not affected by the requested edit");
    }
    sections.push(`Preserve exactly: ${preservation.join("; ")}.`);

    // 4. Mask role
    if (hasMask) {
      sections.push(
        "The mask channel marks the editable region of [image 1]. Pixels outside the mask must come through unchanged.",
      );
    }

    // 5. Negative
    if (input.negativePrompt?.trim()) {
      sections.push(`Avoid: ${input.negativePrompt.trim()}`);
    }

    return sections.join("\n\n");
  }
}

function blobExtension(blob: Blob): string {
  const t = blob.type.toLowerCase();
  if (t === "image/png") return "png";
  if (t === "image/jpeg" || t === "image/jpg") return "jpg";
  if (t === "image/webp") return "webp";
  if (t === "image/gif") return "gif";
  return "png"; // fall back; OpenAI accepts PNG/JPEG/WebP for ref slots
}

type OpenAIResponse = {
  data?: { b64_json?: string; url?: string }[];
};

function base64ToBlob(b64: string, mime: string): Blob {
  if (typeof Buffer !== "undefined") {
    const buf = Buffer.from(b64, "base64");
    return new Blob([buf], { type: mime });
  }
  // biome-ignore lint/suspicious/noExplicitAny: atob is a runtime global
  const binary = (globalThis as any).atob(b64) as string;
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

async function safeText(r: Response): Promise<string> {
  try {
    return await r.text();
  } catch {
    return "<unreadable response body>";
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
