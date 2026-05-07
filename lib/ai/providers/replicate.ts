/**
 * Replicate provider — **shape only** in Sprint 3.2.
 *
 * Replicate's prediction API returns a `prediction` id that the client
 * polls until the model finishes; SDXL workflows take 20–60s and the
 * polling loop / retry / cancel semantics are non-trivial. We're
 * intentionally deferring the full wiring until self-hosted ComfyUI
 * lands, since both will share the same long-running-job machinery.
 *
 * This file ships:
 *   - the provider config (model list with display names + descriptions),
 *     so the GeneratePanel picker exposes Replicate as a real option
 *   - a `generate()` that throws a clear "shape-only stub" message
 *
 * The thrown error surfaces in the UI's failure state so the user
 * understands why the picker entry exists but produces nothing.
 */

import type { ModelInfo } from "../types";
import type { AIProvider, ProviderConfig, ProviderGenerateInput } from "./interface";

const MODELS: readonly ModelInfo[] = [
  {
    id: "stability-ai/sdxl",
    displayName: "SDXL (text → image)",
    description: "SDXL base. Generates from prompt only — no source / mask conditioning.",
  },
  {
    id: "stability-ai/sdxl-inpainting",
    displayName: "SDXL Inpainting",
    description:
      "SDXL with inpainting head. Mask-aware region-targeted edits. Closest analog to OpenAI's image-edits.",
  },
  {
    id: "lucataco/sdxl-controlnet",
    displayName: "SDXL + ControlNet (canny)",
    description:
      "SDXL conditioned on a canny edge map. Best at preserving silhouette while changing texture / style. Pair with mesh silhouette in a future sprint.",
  },
];

export const replicateConfig: ProviderConfig = {
  id: "replicate",
  displayName: "Replicate (SDXL family)",
  capabilities: {
    supportsBinaryMask: true,
    supportsNegativePrompt: true,
    defaultModelId: MODELS[1].id, // SDXL Inpainting — closest mapping to our flow
    models: MODELS,
  },
};

export class ReplicateProvider implements AIProvider {
  readonly config = replicateConfig;

  constructor(apiKey: string) {
    if (!apiKey) throw new Error("REPLICATE_API_TOKEN is empty");
    // Key is intentionally not stored — the stub never makes outbound
    // calls. The full implementation will retain it.
  }

  async generate(_input: ProviderGenerateInput): Promise<Blob> {
    // The provider's shape is wired (registry recognizes it, picker
    // surfaces it), but the polling loop that actually drives a
    // Replicate prediction to completion lives in a future sprint
    // alongside the ComfyUI integration. Surface that to the user.
    throw new Error(
      "Replicate provider is shape-only in Sprint 3.2. Full prediction-polling " +
        "pipeline is deferred until self-hosted ComfyUI lands; until then please " +
        "use Gemini or OpenAI for actual generation.",
    );
  }
}
