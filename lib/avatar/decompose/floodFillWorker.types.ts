/**
 * Shared protocol types between the flood-fill worker and its
 * main-thread client. Lives in a sibling file (rather than inside
 * the worker source) so the worker itself can be plain JS — Next.js
 * emits `.ts` worker URLs with a `.ts` extension under
 * `static/media/`, which is then served with MIME `video/mp2t` (the
 * IANA mapping for MPEG-TS streams). Module-script loaders refuse
 * `video/mp2t` and the worker never instantiates. Keeping the worker
 * as plain JS sidesteps the MIME issue entirely.
 */

export type SampleMode = "alpha" | "luminance" | "rgb";

export interface FloodRequest {
  id: number;
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  seedX: number;
  seedY: number;
  tolerance: number;
  sampleMode: SampleMode;
  /** 1 | 3 | 5 | 11 — window side length used to compute the seed
   *  signature. Larger averages out single-pixel noise. */
  sampleSize: number;
  contiguous: boolean;
  antiAlias: boolean;
}

export interface FloodResponse {
  id: number;
  mask: Uint8ClampedArray;
  area: number;
}
