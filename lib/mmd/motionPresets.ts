"use client";

/**
 * First-party MMD motion presets — the client face of
 * scripts/generate-motion-presets.mjs (which authors the .vmd files
 * into public/motions/ at build-author time).
 *
 * These are our own mathematically-authored motions, so unlike any
 * downloaded VMD they are freely bundleable and every puppet can use
 * them out of the box. The manifest is tiny and fetched lazily the
 * first time the Animation tab's preset block renders.
 */

import { assetUrl } from "../basePath";

export type MotionPreset = {
  id: string;
  file: string;
  label: string;
  description: string;
  seconds: number;
};

let cache: MotionPreset[] | null = null;

export async function fetchMotionPresets(): Promise<MotionPreset[]> {
  if (cache) return cache;
  const res = await fetch(assetUrl("/motions/manifest.json"));
  if (!res.ok) throw new Error(`presets manifest: HTTP ${res.status}`);
  cache = (await res.json()) as MotionPreset[];
  return cache;
}

/** Download one preset's VMD bytes as a File, named `<id>.vmd` so the
 *  stem (= runtime motion name) equals the preset id. */
export async function fetchPresetFile(preset: MotionPreset): Promise<File> {
  const res = await fetch(assetUrl(`/motions/${preset.file}`));
  if (!res.ok) throw new Error(`preset ${preset.id}: HTTP ${res.status}`);
  const blob = await res.blob();
  return new File([blob], `${preset.id}.vmd`, { type: "application/octet-stream" });
}
