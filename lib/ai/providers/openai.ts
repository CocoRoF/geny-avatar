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

import type { AIProvider, ProviderConfig, ProviderGenerateInput } from "./interface";

const ENDPOINT = "https://api.openai.com/v1/images/edits";

const MODELS = ["gpt-image-2", "gpt-image-1.5", "gpt-image-1", "dall-e-2"] as const;

export const openaiConfig: ProviderConfig = {
  id: "openai",
  displayName: "OpenAI gpt-image",
  capabilities: {
    supportsBinaryMask: true,
    supportsNegativePrompt: false, // gpt-image edits don't carry a separate field
    defaultModelId: MODELS[0],
    availableModelIds: MODELS,
  },
};

export class OpenAIProvider implements AIProvider {
  readonly config = openaiConfig;

  constructor(private readonly apiKey: string) {
    if (!apiKey) throw new Error("OPENAI_API_KEY is empty");
  }

  async generate(input: ProviderGenerateInput): Promise<Blob> {
    const model = input.modelId ?? this.config.capabilities.defaultModelId;

    const form = new FormData();
    form.set("model", model);
    form.set("prompt", this.composePrompt(input));
    form.set("n", "1");
    form.set("response_format", "b64_json");
    // Default size/quality to "auto" — OpenAI picks something reasonable
    // for the input dimensions. The client will have already resized to
    // a valid 1024-square or similar before submission.
    form.set("size", "auto");
    form.set("quality", "auto");

    // Image and mask must be PNG with matching dims. The client guarantees
    // both via lib/ai/maskConvert.ts before calling /api/ai/generate.
    form.set("image", input.sourceImage, "source.png");
    if (input.maskImage) {
      form.set("mask", input.maskImage, "mask.png");
    }

    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });

    if (!response.ok) {
      const text = await safeText(response);
      throw new Error(`OpenAI API ${response.status}: ${truncate(text, 600)}`);
    }

    const data = (await response.json()) as OpenAIResponse;
    const first = data.data?.[0];
    if (!first) {
      throw new Error("OpenAI response carried no data entry");
    }
    if (typeof first.b64_json === "string") {
      return base64ToBlob(first.b64_json, "image/png");
    }
    if (typeof first.url === "string") {
      const r = await fetch(first.url);
      if (!r.ok) throw new Error(`OpenAI url fetch failed: ${r.status}`);
      return await r.blob();
    }
    throw new Error("OpenAI response carried neither b64_json nor url");
  }

  /**
   * gpt-image-edits has no negative-prompt field, so we splice the
   * negation into the main prompt as a stylistic hint. Keep it short
   * to avoid blowing the prompt budget.
   */
  private composePrompt(input: ProviderGenerateInput): string {
    if (input.negativePrompt?.trim()) {
      return `${input.prompt.trim()}\n\nAvoid: ${input.negativePrompt.trim()}`;
    }
    return input.prompt.trim();
  }
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
