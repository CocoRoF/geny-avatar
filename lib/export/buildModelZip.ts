/**
 * Build a "ready-to-render anywhere" zip — the puppet's original
 * skeleton/manifest/animation files, plus atlas page PNGs that already
 * contain the user's edits baked in. Drop the result into a stock
 * Spine or Cubism viewer and the puppet looks the way it did in our
 * editor (minus our editor-specific concepts like Variants, which are
 * gone — that's the point).
 *
 * What's NOT in this zip (and is intentionally absent):
 *   - avatar.json, overrides/, LICENSE.md — sidecar concepts that only
 *     our editor knows. For round-trip back into the editor with full
 *     fidelity, use `buildExportZip` instead (the "Save to File"
 *     button).
 *   - Variant rows. The output represents one frozen state.
 *
 * Texture page → bundle file matching:
 *   - Cubism: `model3.json`'s `FileReferences.Textures[i]` is the page-
 *     index-i path, relative to the manifest's directory.
 *   - Spine: page names live in the `.atlas` text file. We text-parse
 *     to extract page filenames in order and resolve to bundle paths
 *     by appending the atlas's directory prefix.
 *
 * If the matching can't be resolved for a page (malformed manifest,
 * unusual atlas layout), the original PNG is preserved and a warning
 * is recorded.
 */

import { type Zippable, zipSync } from "fflate";
import type { AvatarAdapter } from "../adapters/AvatarAdapter";
import type { Avatar, LayerId } from "../avatar/types";
import { loadPuppet, type PuppetId } from "../persistence/db";
import type { BundleEntry } from "../upload/types";
import { type BakedAtlasPage, bakeAtlasPages } from "./bakeAtlas";

export type BuildModelZipInput = {
  puppetId: PuppetId;
  adapter: AvatarAdapter;
  avatar: Avatar;
  visibility: Record<LayerId, boolean>;
  masks: Record<LayerId, Blob>;
  textures: Record<LayerId, Blob>;
};

export type BuildModelZipResult = {
  zip: Blob;
  filename: string;
  bytes: number;
  fileCount: number;
  bakedPages: number;
  unmatchedPages: number;
  warnings: string[];
};

export async function buildModelZip(input: BuildModelZipInput): Promise<BuildModelZipResult> {
  const loaded = await loadPuppet(input.puppetId);
  if (!loaded) throw new Error(`puppet ${input.puppetId} not found in library`);
  const { row, entries } = loaded;
  const warnings: string[] = [];

  // Resolve bundlePath ← pageIndex up front so the bake loop knows
  // which file each atlas should land in. Adapter-specific.
  let pagePathByIndex: Map<number, string>;
  if (row.runtime === "live2d") {
    pagePathByIndex = await resolveLive2DTexturePaths(entries, warnings);
  } else if (row.runtime === "spine") {
    pagePathByIndex = await resolveSpineTexturePaths(entries, warnings);
  } else {
    pagePathByIndex = new Map();
  }

  // Map TextureId → bundle path via Avatar.textures.pageIndex.
  const bundlePathByTextureId = new Map<string, string>();
  for (const t of input.avatar.textures) {
    const path = pagePathByIndex.get(t.pageIndex);
    if (path) bundlePathByTextureId.set(t.id, path);
    else warnings.push(`page ${t.pageIndex} (textureId ${t.id}) has no bundle path`);
  }

  // Bake each page into its own PNG.
  const baked = await bakeAtlasPages({
    adapter: input.adapter,
    avatar: input.avatar,
    visibility: input.visibility,
    masks: input.masks,
    textures: input.textures,
  });
  const bakedByPath = new Map<string, BakedAtlasPage>();
  let unmatched = 0;
  for (const page of baked) {
    const path = bundlePathByTextureId.get(page.textureId);
    if (path) bakedByPath.set(path, page);
    else {
      unmatched++;
      warnings.push(
        `baked page ${page.pageIndex} not matched to any bundle path — falling back to original`,
      );
    }
  }

  // Build the output zip: every original file kept, atlas PNGs swapped
  // out for their baked replacements where we have one.
  const zippable: Zippable = {};
  for (const entry of entries) {
    const baked = bakedByPath.get(entry.path);
    const bytes = baked
      ? new Uint8Array(await baked.blob.arrayBuffer()).slice()
      : new Uint8Array(await entry.blob.arrayBuffer()).slice();
    zippable[entry.path] = bytes;
  }

  const zipBytes = zipSync(zippable, { level: 6 });
  const zipBlob = new Blob([new Uint8Array(zipBytes).buffer], { type: "application/zip" });
  const filename = makeFilename(row.name);

  return {
    zip: zipBlob,
    filename,
    bytes: zipBlob.size,
    fileCount: Object.keys(zippable).length,
    bakedPages: baked.length - unmatched,
    unmatchedPages: unmatched,
    warnings,
  };
}

// ----- runtime-specific resolvers -----

async function resolveLive2DTexturePaths(
  entries: BundleEntry[],
  warnings: string[],
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const manifest = entries.find((e) => e.path.toLowerCase().endsWith(".model3.json"));
  if (!manifest) {
    warnings.push("Cubism bundle has no .model3.json manifest");
    return out;
  }
  const text = await manifest.blob.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    warnings.push(`failed to parse model3.json: ${(e as Error).message}`);
    return out;
  }
  const refs = (json as { FileReferences?: { Textures?: unknown } })?.FileReferences?.Textures;
  if (!Array.isArray(refs)) {
    warnings.push("model3.json missing FileReferences.Textures");
    return out;
  }
  const manifestDir = pathDirectory(manifest.path);
  for (let i = 0; i < refs.length; i++) {
    const rel = refs[i];
    if (typeof rel !== "string") continue;
    const fullPath = joinPaths(manifestDir, rel);
    out.set(i, fullPath);
  }
  return out;
}

async function resolveSpineTexturePaths(
  entries: BundleEntry[],
  warnings: string[],
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const atlasEntry = entries.find((e) => e.path.toLowerCase().endsWith(".atlas"));
  if (!atlasEntry) {
    warnings.push("Spine bundle has no .atlas file");
    return out;
  }
  const text = await atlasEntry.blob.text();
  // Spine atlas page header line: at column 0 (no leading whitespace),
  // and ends with an image extension. Region names that happen to look
  // like filenames are unusual but possible — we bound the search by
  // also requiring the next non-blank line to start with `size:` (the
  // mandatory page metadata field).
  const lines = text.split(/\r?\n/);
  const pageNames: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^[^\s].*\.(png|jpg|jpeg|webp)$/i.test(line.trim()) && line === line.trimStart()) {
      // Look ahead for the size: marker within a few lines.
      let confirmed = false;
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const next = lines[j].trim();
        if (next === "") continue;
        if (next.startsWith("size:")) confirmed = true;
        break;
      }
      if (confirmed) pageNames.push(line.trim());
    }
  }
  if (pageNames.length === 0) {
    warnings.push("could not extract page names from .atlas");
    return out;
  }

  const atlasDir = pathDirectory(atlasEntry.path);
  for (let i = 0; i < pageNames.length; i++) {
    const candidatePath = joinPaths(atlasDir, pageNames[i]);
    // Direct directory match first (fast path).
    if (entries.some((e) => e.path === candidatePath)) {
      out.set(i, candidatePath);
      continue;
    }
    // Fallback: basename match anywhere in the bundle. Helps when the
    // atlas was packaged at the bundle root but the PNG was placed in
    // a subdir or vice versa.
    const lowerName = pageNames[i].toLowerCase();
    const match = entries.find(
      (e) => (e.path.split("/").pop() ?? e.path).toLowerCase() === lowerName,
    );
    if (match) out.set(i, match.path);
    else warnings.push(`atlas page "${pageNames[i]}" not found in bundle`);
  }
  return out;
}

function pathDirectory(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.substring(0, idx + 1) : "";
}

function joinPaths(dir: string, rel: string): string {
  if (!dir) return rel;
  if (rel.startsWith("/")) return rel.slice(1);
  return dir + rel;
}

function makeFilename(rawName: string): string {
  const base = rawName.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "") || "puppet";
  return `${base}.zip`;
}
