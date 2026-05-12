"use client";

import type { Application } from "pixi.js";

/**
 * Capture the puppet's current rendered pose as a single PNG, sized
 * for use as `image[2]` in AI generate calls.
 *
 * Why this exists: gpt-image-2 receives the *atlas crop* of one
 * drawable as `image[1]`, with no spatial context for what the
 * drawable is part of. Attaching a full-character render alongside
 * lets the model see the face the hair frames, the body the jacket
 * sits on, etc. — improves identity preservation and reduces
 * "redrew this in isolation" failures.
 *
 * "Canonical pose" is a slight misnomer here: we capture the *current*
 * stage state, not a parameter-reset rest pose. Reasons:
 *   - Resetting parameters mid-session would flicker the visible
 *     editor canvas for one frame.
 *   - The user's current view *is* the reference they want the AI to
 *     consider. If they have the mouth half-open while editing hair,
 *     showing the AI the mouth half-open is more faithful than a
 *     reset.
 *   - Phase 2 will revisit this with an offscreen Pixi app + true
 *     canonical reset for reproducible captures.
 *
 * Returned blob is a PNG so it slots directly into the multipart
 * form body as a reference image (provider routes don't care about
 * MIME beyond image/*).
 *
 * Returns `null` when the stage hasn't drawn anything yet (puppet
 * still loading) — caller should skip attaching it rather than
 * abort the whole generate call.
 */
export async function renderPuppetReference(
  app: Application,
  options: { widthPx?: number } = {},
): Promise<Blob | null> {
  const widthPx = options.widthPx ?? 1024;

  // Wait one rAF so any pending overrides / motion frame has landed
  // before we read pixels. Same trick `captureThumbnail` uses.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  const extracted = (await app.renderer.extract.canvas(app.stage)) as HTMLCanvasElement;
  if (!extracted.width || !extracted.height) return null;

  // Downscale to widthPx on the long side. Pixi's stage is already
  // at editor canvas dims (usually 800–1400 wide); 1024 is a comfortable
  // sweet spot — large enough that the AI sees structural detail,
  // small enough that the PNG stays under ~600 KB.
  const scale = Math.min(widthPx / extracted.width, widthPx / extracted.height, 1);
  const w = Math.max(1, Math.round(extracted.width * scale));
  const h = Math.max(1, Math.round(extracted.height * scale));

  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(extracted, 0, 0, w, h);

  return await new Promise<Blob | null>((resolve) => {
    out.toBlob((b) => resolve(b), "image/png");
  });
}
