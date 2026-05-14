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
    //
    // **image[] ordering — important**:
    //   [1] source (the canvas being edited; `mask` parameter applies
    //       to this entry, when present).
    //   [2] mask reference (when the user painted one in the MASK
    //       tab) — a soft region hint, not a hard inpaint mask. The
    //       FLUX inpaint endpoints we tried earlier read masks as
    //       strict bounds and stamped a full character inside the
    //       silhouette regardless of mask. gpt-image-2's multi-image
    //       pipeline lets us frame the mask as auxiliary guidance via
    //       prompt language instead.
    //   [3..] caller-supplied reference images (style anchor, char
    //       snapshot, etc.).
    //
    form.append("image[]", input.sourceImage, "source.png");
    if (input.maskReferenceImage) {
      form.append("image[]", input.maskReferenceImage, "mask-reference.png");
    }
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
    const hasMaskRef = !!input.maskReferenceImage;
    const totalImages = 1 + (hasMaskRef ? 1 : 0) + refs.length;
    const refStart = hasMaskRef ? 2 : 1;
    console.info(
      `[openai] POST ${ENDPOINT}\n` +
        `         model: ${model}\n` +
        `         image[]: ${totalImages} entries\n` +
        `           [0] source: ${input.sourceImage.size}B (${input.sourceImage.type || "?"})\n` +
        (hasMaskRef && input.maskReferenceImage
          ? `           [1] mask-reference: ${input.maskReferenceImage.size}B — soft edit-region hint\n`
          : "") +
        refs
          .map(
            (r, i) =>
              `           [${i + refStart}] reference: ${r.size}B (${r.type || "?"}) — ride-along anchor`,
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
   * Compose the final prompt for `/v1/images/edits` following
   * gpt-image-2's multi-image best practices, lightly enough to leave
   * the user's intent (or the LLM-refined version of it) in charge.
   *
   * Earlier iterations were over-restrictive: "do not copy any
   * objects / characters / faces / accessories from references" was
   * meant to stop reference identity from spuriously bleeding into
   * an unrelated source slot, but it also blocked the *legitimate*
   * case where the user wanted exactly that — e.g. "[image 1] is a
   * face slot and the reference is the face I want there." The
   * pipeline already alpha-clips every result to [image 1]'s
   * silhouette, so wrong content can't physically land outside the
   * slot's shape. That makes the prompt's job narrower: just tell
   * the model which slot is the canvas, where to look in the
   * references, and what to apply.
   *
   *   1. **Slot map** — `[image 1]` is the canvas, `[image 2..N]`
   *      are visual references. Mention that the renderer clips the
   *      output to [image 1]'s silhouette so the model knows the
   *      shape is fixed without us forbidding content transfer.
   *
   *   2. **User intent under "Edit"** — the user / refined prompt
   *      is wrapped in `Edit [image 1]: ...` to bind the instruction
   *      to the canvas slot.
   *
   *   3. **Preservation hint** — silhouette + crop framing. Short.
   *      We don't enumerate "no faces, no accessories" anymore.
   *
   *   4. **Mask role** — only when a mask blob is attached.
   *
   *   5. **Negative as "Avoid:" tail** — no separate field on this
   *      endpoint.
   */
  private composePrompt(input: ProviderGenerateInput): string {
    const refs = input.referenceImages ?? [];
    const hasRefs = refs.length > 0;
    const hasMask = !!input.maskImage;
    const hasMaskRef = !!input.maskReferenceImage;
    // image[2] is the mask reference when one is attached; the regular
    // refs shift to image[3+]. We rebuild the labels accordingly so the
    // prompt names every slot correctly.
    const refSlotBase = hasMaskRef ? 3 : 2;
    // Refined prompts are instructed not to prepend "Edit [image 1]:"
    // since this method adds it. If the LLM ignored that instruction
    // (it sometimes does — model habit overrides system prompt), strip
    // the leading verb so we don't end up with
    //   Edit [image 1]: Edit [image 1] so the layer matches...
    let userIntent = (input.refinedPrompt ?? input.prompt).trim();
    userIntent = userIntent.replace(/^edit\s*\[?\s*image\s*1\s*\]?\s*[:\-—]\s*/i, "");
    userIntent = userIntent.replace(/^edit\s*\[?\s*image\s*1\s*\]?\s+(?=so\b|to\b|by\b)/i, "");

    const sections: string[] = [];

    // 1. Slot map. Always tells the model what [image 1] *is*; the
    // reference list section only appears when refs are attached.
    sections.push(
      "[image 1] is the canvas to edit — it represents one drawable of a multi-part Live2D-style 2D rigged puppet (skirt, face, hair, accessory, etc.). The render pipeline alpha-clips the output to [image 1]'s silhouette automatically, so don't worry about where the shape ends — focus on what fills it.",
    );
    if (hasMaskRef) {
      sections.push(
        "[image 2] is a binary edit-region HINT painted by the user — WHITE regions mark where the edit should land, BLACK regions are the user's hint to leave the original content alone. Treat this as soft guidance, not a strict boundary: keep [image 1]'s overall composition consistent, but bias the change toward the white pixels. The HINT exists at the same dimensions and alignment as [image 1].",
      );
    }
    if (hasRefs) {
      const refLabels =
        refs.length === 1
          ? `[image ${refSlotBase}]`
          : refs.map((_, i) => `[image ${i + refSlotBase}]`).join(", ");
      sections.push(
        `${refLabels} ${
          refs.length === 1 ? "is a visual reference" : "are visual references"
        } for the desired look. Identify which region of ${
          refs.length === 1 ? "the reference" : "each reference"
        } describes [image 1]'s slot, and apply that region's content there. The last reference, when present, may be a full-character snapshot of the puppet — treat it as spatial context (so you know what [image 1] is part of), not as the style anchor.`,
      );
    }

    // 2. The actual edit instruction
    sections.push(`Edit [image 1]: ${userIntent}`);

    // 3. Preservation — short. Alpha-enforcement does the heavy
    // lifting; we just remind the model the framing stays.
    sections.push(
      "Keep [image 1]'s silhouette and crop framing — the renderer expects the result to fit [image 1]'s exact shape. Maintain the line weight and shading style of the original.",
    );

    // 4. Style negation. Three words save a lot of photoreal drift on
    // anime / illustration puppets per OpenAI's prompting guide.
    sections.push("Style: anime / illustration. NOT photoreal. NOT 3D. NOT live-action.");

    // 5. Mask role
    if (hasMask) {
      sections.push(
        "The mask channel marks the editable region of [image 1]. Pixels outside the mask must come through unchanged.",
      );
    }

    // 6. Negative
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
