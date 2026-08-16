"use client";

/**
 * Worker-offloaded zip/unzip.
 *
 * The publish/export bakes used fflate's zipSync on the MAIN THREAD —
 * a Chisa-class MMD bundle (~45MB raw) measured ~1.5s of hard main-
 * thread block per bake on a fast machine (multi-second on typical
 * hardware), and the auto-publish pipeline re-bakes on EVERY config
 * change (idle designation, emotion map, camera save…). That is the
 * "browser freezes when I pick a VMD" report. fflate's async variants
 * run the deflate work in Web Workers; the same bundle takes ~0.6s of
 * WALL time with the main thread fully responsive.
 *
 * Compression policy: PNG/JPG/WebP textures and PMX/PMD/VMD binaries
 * are effectively incompressible (a level-6 pass over the 45MB bundle
 * saved only ~14% while costing the whole block) — they're STORED
 * (level 0). Text-ish entries (json/atlas/md) keep level 6.
 */

import { type AsyncZippable, type Unzipped, unzip, zip } from "fflate";

/** Entries that deflate can't meaningfully shrink — store them. */
const STORED_RE = /\.(png|jpe?g|webp|gif|bmp|tga|spa|sph|dds|pmx|pmd|vmd|moc3|zip|wav|mp3|ogg)$/i;

export function zipAsync(files: Record<string, Uint8Array>): Promise<Uint8Array> {
  const wrapped: AsyncZippable = {};
  for (const [path, data] of Object.entries(files)) {
    wrapped[path] = [data, { level: STORED_RE.test(path) ? 0 : 6 }];
  }
  return new Promise((resolve, reject) => {
    zip(wrapped, { level: 6 }, (err, out) => (err ? reject(err) : resolve(out)));
  });
}

export function unzipAsync(data: Uint8Array): Promise<Unzipped> {
  return new Promise((resolve, reject) => {
    unzip(data, (err, out) => (err ? reject(err) : resolve(out)));
  });
}
