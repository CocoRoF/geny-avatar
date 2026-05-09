/**
 * SAM (Segment Anything) — domain types for click-driven segmentation.
 *
 * Distinct from the image-edit `AIProvider` family because the
 * input/output shapes don't overlap: SAM consumes an image + a list
 * of click points and returns one or more candidate masks. The
 * generation pipeline never crosses paths with this — the only
 * shared thing is that both ride on the same `REPLICATE_API_TOKEN`.
 *
 * Convention:
 *   - `label: 1` ⇒ foreground (the user wants this point inside the mask)
 *   - `label: 0` ⇒ background (the user wants this point outside)
 * Coordinates are in source-image pixel space (0,0 = top-left).
 */

export type SamPoint = {
  x: number;
  y: number;
  label: 0 | 1;
};

export type SamCandidate = {
  /** Binary mask PNG. White (255) = inside, black (0) = outside.
   *  Matches the convention `editorStore.layerMasks` already uses. */
  maskBlob: Blob;
  /** Model-reported confidence, if the port surfaces one. */
  score?: number;
};

export type SamRequest = {
  /** PNG/JPEG/WebP source — typically a layer's atlas region. */
  imageBlob: Blob;
  points: SamPoint[];
  /** Optional override of the Replicate model id. */
  modelId?: string;
};

export type SamResponse = {
  candidates: SamCandidate[];
  /** Resolved Replicate model id (after env / override). */
  model: string;
  elapsedMs: number;
};
