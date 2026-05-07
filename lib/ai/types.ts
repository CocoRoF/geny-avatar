/**
 * AI texture generation domain types.
 *
 * Decoupled from any provider (Replicate, HuggingFace, self-hosted
 * ComfyUI). The runtime picks an `AIProvider` implementation; everything
 * upstream — the panel, the store, IDB cache — only sees these shapes.
 */

import type { LayerId, TextureId } from "../avatar/types";

export type AIJobId = string;

export type AIJobStatus =
  | { kind: "queued" }
  | { kind: "running"; progress?: number }
  | { kind: "succeeded"; resultBlob: Blob }
  | { kind: "failed"; reason: string }
  | { kind: "canceled" };

export type GenerateRequest = {
  /** Target layer — used to locate the atlas region + (optionally) mask. */
  layerId: LayerId;
  /** Snapshot of the source region the AI should inpaint into, encoded
   *  as PNG. The adapter extracts this via `extractLayerCanvas`. */
  sourceImage: Blob;
  /** Optional mask blob from DecomposeStudio. Alpha=255 marks "regenerate
   *  here", alpha=0 marks "leave alone". Falls back to "regenerate the
   *  whole layer footprint" when missing. */
  maskImage?: Blob;
  /** User prompt describing the desired output. */
  prompt: string;
  /** Optional negative prompt — things the model should avoid. */
  negativePrompt?: string;
  /** Reproducibility — same seed + prompt should give the same output. */
  seed?: number;
};

export type AIJob = {
  id: AIJobId;
  layerId: LayerId;
  /** Snapshot of the texture page at submit time so the result can be
   *  composited back even if the page later changes. */
  textureId: TextureId;
  prompt: string;
  negativePrompt?: string;
  seed?: number;
  status: AIJobStatus;
  createdAt: number;
};

/**
 * Pluggable backend. Sprint 3.1 lands a Replicate implementation;
 * future sprints can swap in HuggingFace / self-hosted ComfyUI without
 * changing UI code.
 */
export interface AIProvider {
  /** Submit a job. Returns a handle the panel can poll. */
  generate(req: GenerateRequest): Promise<{ jobId: AIJobId }>;
  /** Read current status. Long-polling wrapper, retries, backoff etc.
   *  live in the caller. */
  status(jobId: AIJobId): Promise<AIJobStatus>;
  /** Best-effort cancel. Some providers don't support — return false. */
  cancel?(jobId: AIJobId): Promise<boolean>;
}
