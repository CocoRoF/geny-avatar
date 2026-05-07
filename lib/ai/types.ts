/**
 * AI texture generation domain types — provider-agnostic.
 *
 * Concrete providers (Google Gemini, OpenAI gpt-image-2, Replicate SDXL)
 * implement `AIProvider` from `./providers/interface`. The store, the
 * panel, and the API routes only see these shapes.
 */

import type { LayerId, TextureId } from "../avatar/types";

export type AIJobId = string;

export type ProviderId = "gemini" | "openai" | "replicate";

/**
 * Describes a single model available within a provider. UI uses
 * `displayName` for the picker label and `description` for a short
 * explanatory line under it; `id` is the raw model id sent to the API.
 */
export type ModelInfo = {
  id: string;
  displayName: string;
  description?: string;
};

export type AIJobStatus =
  | { kind: "queued" }
  | { kind: "running"; progress?: number }
  | { kind: "succeeded"; resultMime: string }
  | { kind: "failed"; reason: string }
  | { kind: "canceled" };

export type GenerateRequest = {
  /** Target layer — used to locate the atlas region + (optionally) mask. */
  layerId: LayerId;
  /** Snapshot of the source region the AI should edit, encoded as PNG.
   *  The adapter extracts this via `extractLayerCanvas`. */
  sourceImage: Blob;
  /** Optional mask blob from DecomposeStudio. Alpha=255 marks the
   *  "regenerate me" region in our convention; providers that need a
   *  different convention (OpenAI: alpha=0 is edit zone) convert at
   *  the boundary. */
  maskImage?: Blob;
  /** User prompt describing the desired output. */
  prompt: string;
  /** Optional negative prompt — things the model should avoid. */
  negativePrompt?: string;
  /** Reproducibility — same seed + prompt should give the same output. */
  seed?: number;
  /** Optional model override (e.g. user picks Nano Banana Pro vs Flash). */
  modelId?: string;
};

export type AIJob = {
  id: AIJobId;
  layerId: LayerId;
  /** Texture page id at submit time, kept so the result can be
   *  composited back onto the atlas later (Sprint 3.3). */
  textureId: TextureId;
  providerId: ProviderId;
  prompt: string;
  negativePrompt?: string;
  seed?: number;
  modelId?: string;
  status: AIJobStatus;
  createdAt: number;
};
