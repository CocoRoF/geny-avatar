/**
 * Server-side provider interface. Each backend (Gemini, OpenAI, Replicate)
 * implements `AIProvider` and registers in `./registry`. The API route
 * picks one by id and calls `generate`.
 *
 * Interface is intentionally synchronous-blob: the route's own job
 * tracker handles "running"/"queued" UI states; from the provider's
 * perspective, you await the model and produce a single PNG. Long-running
 * providers (e.g. Replicate prediction polling) loop internally and
 * await a final blob before returning.
 */

import type { ProviderId } from "../types";

export type ProviderCapabilities = {
  /** Provider takes a binary PNG mask describing edit regions.
   *  False for Gemini (which uses text-described regions). */
  supportsBinaryMask: boolean;
  /** Provider supports a separate "negative prompt" field. */
  supportsNegativePrompt: boolean;
  /** Default model id when the user doesn't override. */
  defaultModelId: string;
  /** All model ids exposed in the picker. */
  availableModelIds: readonly string[];
};

export type ProviderConfig = {
  id: ProviderId;
  /** Display name in the UI. */
  displayName: string;
  capabilities: ProviderCapabilities;
};

export type ProviderGenerateInput = {
  /** PNG bytes of the source region. */
  sourceImage: Blob;
  /** PNG bytes of the mask in DecomposeStudio convention
   *  (alpha=255 = "edit this region"). Provider converts internally
   *  if its API uses a different convention. */
  maskImage?: Blob;
  prompt: string;
  negativePrompt?: string;
  seed?: number;
  /** Model override; falls back to `capabilities.defaultModelId`. */
  modelId?: string;
};

export interface AIProvider {
  readonly config: ProviderConfig;
  /**
   * Run a single generation, returning the resulting image as a Blob.
   * Throws with a clear message on API errors so the route can surface
   * them as `{ kind: "failed", reason }`.
   */
  generate(input: ProviderGenerateInput): Promise<Blob>;
}
