/**
 * Google Gemini ("Nano Banana") image generation/editing.
 *
 * API ref: https://ai.google.dev/gemini-api/docs/image-generation
 *   POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 *   Header: x-goog-api-key: $GEMINI_API_KEY
 *   Body: { contents: [{ parts: [<text>, <inline_data>...] }],
 *           generationConfig: { responseModalities: ["TEXT", "IMAGE"] } }
 *   Response: candidates[].content.parts[i].inline_data.{mime_type, data}
 *
 * Region-targeted edits use Google's "conversational mask" pattern: the
 * docs explicitly support describing the edit region in text and
 * (optionally) providing a second image whose marked area defines the
 * mask. We do both — the source image as the primary, our DecomposeStudio
 * mask as a secondary reference, and prompt language pointing at it.
 */

import type { ModelInfo } from "../types";
import type { AIProvider, ProviderConfig, ProviderGenerateInput } from "./interface";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * The three Nano Banana variants documented by Google as of writing.
 * Default is the stable "Nano Banana" (gemini-2.5-flash-image) — non-
 * preview, low-latency. Users can pick the preview siblings (Nano
 * Banana 2 / Pro) for newer behavior or higher fidelity.
 */
const MODELS: readonly ModelInfo[] = [
  {
    id: "gemini-2.5-flash-image",
    displayName: "Nano Banana",
    description: "Speed + efficiency. Optimized for high-volume, low-latency tasks.",
  },
  {
    id: "gemini-3.1-flash-image-preview",
    displayName: "Nano Banana 2",
    description:
      "High-efficiency counterpart of Gemini 3 Pro Image. Optimized for speed and bulk developer use cases. Preview.",
  },
  {
    id: "gemini-3-pro-image-preview",
    displayName: "Nano Banana Pro",
    description:
      "Professional asset creation with advanced reasoning ('thinking'). Best at complex instructions and high-fidelity text rendering. Preview.",
  },
];

export const geminiConfig: ProviderConfig = {
  id: "gemini",
  displayName: "Google Gemini (Nano Banana)",
  capabilities: {
    supportsBinaryMask: false,
    supportsNegativePrompt: true,
    defaultModelId: MODELS[0].id,
    models: MODELS,
  },
};

export class GeminiProvider implements AIProvider {
  readonly config = geminiConfig;

  constructor(private readonly apiKey: string) {
    if (!apiKey) throw new Error("GEMINI_API_KEY is empty");
  }

  async generate(input: ProviderGenerateInput): Promise<Blob> {
    const model = input.modelId ?? this.config.capabilities.defaultModelId;

    const sourceB64 = await blobToBase64(input.sourceImage);
    const sourceMime = input.sourceImage.type || "image/png";

    // Build the Gemini `parts` array. Text first (prompt + region
    // instructions), then the source image, then optionally the mask
    // as a second image so the model can read the marked region.
    type Part = { text: string } | { inline_data: { mime_type: string; data: string } };
    const parts: Part[] = [
      { text: this.composePrompt(input) },
      { inline_data: { mime_type: sourceMime, data: sourceB64 } },
    ];
    if (input.maskImage) {
      const maskB64 = await blobToBase64(input.maskImage);
      parts.push({
        inline_data: {
          mime_type: input.maskImage.type || "image/png",
          data: maskB64,
        },
      });
    }

    const body = {
      contents: [{ parts }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
      },
    };

    const url = `${ENDPOINT}/${encodeURIComponent(model)}:generateContent`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "x-goog-api-key": this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await safeText(response);
      throw new Error(`Gemini API ${response.status}: ${truncate(text, 600)}`);
    }

    const data = (await response.json()) as GeminiResponse;
    const out = pickFirstImagePart(data);
    if (!out) {
      throw new Error("Gemini response carried no image part");
    }
    return base64ToBlob(out.data, out.mime_type ?? "image/png");
  }

  /**
   * Compose the Gemini prompt. When a mask is supplied, we explain to
   * the model that a second image carries the region to edit (per the
   * "conversational mask" guidance in Google's docs). When negative
   * prompt is supplied, we append it as a "Avoid: …" suffix.
   */
  private composePrompt(input: ProviderGenerateInput): string {
    const lines: string[] = [];
    if (input.maskImage) {
      lines.push(
        "I'm sending two images. The first is the original. The second is a mask: the opaque pixels (red painted area) mark the region you should edit. Leave everything outside the mask untouched. Match the edit cleanly to the surrounding pixels.",
      );
      lines.push("");
    }
    lines.push(input.prompt.trim());
    if (input.negativePrompt?.trim()) {
      lines.push("");
      lines.push(`Avoid: ${input.negativePrompt.trim()}`);
    }
    return lines.join("\n");
  }
}

// ----- response shape we read -----

type GeminiInlineData = { mime_type?: string; data: string };
type GeminiPart = { text?: string; inline_data?: GeminiInlineData; inlineData?: GeminiInlineData };
type GeminiResponse = {
  candidates?: { content?: { parts?: GeminiPart[] } }[];
};

function pickFirstImagePart(data: GeminiResponse): GeminiInlineData | null {
  const candidates = data.candidates ?? [];
  for (const cand of candidates) {
    const parts = cand.content?.parts ?? [];
    for (const p of parts) {
      // Some SDK builds return camelCase (inlineData), the REST docs use
      // snake_case (inline_data). Accept both.
      const inline = p.inline_data ?? p.inlineData;
      if (inline?.data) return inline;
    }
  }
  return null;
}

// ----- helpers (Node + Web compatible) -----

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  // Node's Buffer is the cheapest path; in Edge runtime / browser fallback
  // to a chunked manual encode to avoid blowing the call stack.
  if (typeof Buffer !== "undefined") {
    return Buffer.from(buf).toString("base64");
  }
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  // biome-ignore lint/suspicious/noExplicitAny: btoa is a global in browser/edge
  return (globalThis as any).btoa(binary);
}

function base64ToBlob(b64: string, mime: string): Blob {
  if (typeof Buffer !== "undefined") {
    const buf = Buffer.from(b64, "base64");
    return new Blob([buf], { type: mime });
  }
  // biome-ignore lint/suspicious/noExplicitAny: atob is a global in browser/edge
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
