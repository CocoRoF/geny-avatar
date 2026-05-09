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

const HIDE_MOTION_FILENAME = "geny-hide-init.motion3.json";

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
  /** Number of distinct runtime parts/slots that the export forced to
   *  invisible via model-file modification (motion3.json patches for
   *  Cubism, slot-attachment removal for Spine). 0 when the user
   *  hid nothing. */
  hiddenParts: number;
  /** Files in the bundle whose contents we rewrote (motion3.json,
   *  skeleton.json, model3.json). Useful for diagnostics. */
  patchedFiles: string[];
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

  // Bake each page into its own PNG (mask + AI texture only — visibility
  // hide is handled at the model-file layer below, never via atlas erase,
  // because pixel-level erase introduces sampling artifacts).
  const baked = await bakeAtlasPages({
    adapter: input.adapter,
    avatar: input.avatar,
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

  // Collect runtime-stable ids of layers the user explicitly hid from a
  // default-visible state. These will be forced to invisible via model
  // patches (Cubism: motion3.json PartOpacity curves; Spine: skeleton
  // setup-pose attachment removal). Atlas pixels stay untouched.
  const hiddenPartIds = new Set<string>();
  for (const layer of input.avatar.layers) {
    const current = input.visibility[layer.id];
    if (current !== false) continue;
    if (layer.defaults.visible !== true) continue;
    hiddenPartIds.add(stripPageSuffix(layer.externalId));
  }

  let manifestPatch: { path: string; bytes: Uint8Array } | null = null;
  let patchedReplacements = new Map<string, Uint8Array>();
  let extraFiles: { path: string; bytes: Uint8Array }[] = [];

  if (hiddenPartIds.size > 0 && row.runtime === "live2d") {
    const result = await patchCubismForHide(entries, hiddenPartIds, warnings);
    patchedReplacements = result.replacements;
    extraFiles = result.extraFiles;
    if (result.manifestPatch) manifestPatch = result.manifestPatch;
  } else if (hiddenPartIds.size > 0 && row.runtime === "spine") {
    const result = await patchSpineForHide(entries, hiddenPartIds, warnings);
    patchedReplacements = result.replacements;
  }
  const patchedFiles: string[] = [...patchedReplacements.keys()];
  if (manifestPatch) patchedFiles.push(manifestPatch.path);

  // Build the output zip:
  //   - manifest patch (model3.json with new motion ref) wins over original
  //   - patched motion / skeleton files win over originals
  //   - baked atlas PNGs win over original PNGs
  //   - everything else is copied verbatim
  //   - extra files (newly-generated hide motion) appended at the end
  const zippable: Zippable = {};
  for (const entry of entries) {
    const manifestOverride =
      manifestPatch && manifestPatch.path === entry.path ? manifestPatch.bytes : null;
    const patched = patchedReplacements.get(entry.path);
    const baked = bakedByPath.get(entry.path);
    let bytes: Uint8Array;
    if (manifestOverride) bytes = manifestOverride;
    else if (patched) bytes = patched;
    else if (baked) bytes = new Uint8Array(await baked.blob.arrayBuffer()).slice();
    else bytes = new Uint8Array(await entry.blob.arrayBuffer()).slice();
    zippable[entry.path] = bytes;
  }
  for (const extra of extraFiles) {
    zippable[extra.path] = extra.bytes;
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
    hiddenParts: hiddenPartIds.size,
    patchedFiles,
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

function stripPageSuffix(externalId: string): string {
  const idx = externalId.lastIndexOf("#p");
  return idx < 0 ? externalId : externalId.substring(0, idx);
}

// ----- Cubism model-file patching for hide -----

type CubismPatchResult = {
  replacements: Map<string, Uint8Array>;
  extraFiles: { path: string; bytes: Uint8Array }[];
  manifestPatch: { path: string; bytes: Uint8Array } | null;
};

/**
 * Force a set of Cubism parts to be invisible by patching the puppet's
 * existing motion3.json files: every motion gains one extra Curve per
 * hidden part, with `Target = "PartOpacity"`, the part's id, and a
 * single linear segment holding 0 across the motion's duration. The
 * Cubism Framework reads this curve every frame and multiplies the
 * part's opacity by 0, so the part renders as if its initial opacity
 * were zero — without ever modifying the atlas pixels.
 *
 * The original motion's other curves (parameter values, idle breathing,
 * etc.) stay untouched, so the puppet still animates normally.
 *
 * If the puppet has zero motions we synthesize a tiny `geny-hide-init.
 * motion3.json` that does only the hide curves and add a reference to
 * it in `model3.json`'s `FileReferences.Motions.Idle` — the Framework
 * auto-loops Idle motions, so the hide stays in effect at all times.
 *
 * Curves whose `Id` doesn't match any real part are silently ignored
 * by the Framework, so we don't need to validate that every layer's
 * externalId exists in the moc3 — it's safe to over-include.
 */
async function patchCubismForHide(
  entries: BundleEntry[],
  hiddenPartIds: Set<string>,
  warnings: string[],
): Promise<CubismPatchResult> {
  const replacements = new Map<string, Uint8Array>();
  const extraFiles: { path: string; bytes: Uint8Array }[] = [];
  let manifestPatch: { path: string; bytes: Uint8Array } | null = null;

  const motionFiles = entries.filter((e) => e.path.toLowerCase().endsWith(".motion3.json"));

  if (motionFiles.length > 0) {
    for (const motionEntry of motionFiles) {
      try {
        const text = await motionEntry.blob.text();
        const motion = JSON.parse(text) as Live2DMotionFile;
        const duration = Math.max(motion.Meta?.Duration ?? 1.0, 0.05);
        const newCurves: Live2DCurve[] = [];
        for (const partId of hiddenPartIds) {
          newCurves.push({
            Target: "PartOpacity",
            Id: partId,
            // Single linear segment from (t=0, v=0) to (t=duration, v=0).
            // Format: [t0, v0, segmentTypeCode=0 (linear), t1, v1].
            Segments: [0, 0, 0, duration, 0],
          });
        }
        motion.Curves = (motion.Curves ?? []).concat(newCurves);
        if (!motion.Meta) motion.Meta = {};
        const meta = motion.Meta;
        meta.CurveCount =
          (meta.CurveCount ?? motion.Curves.length - newCurves.length) + newCurves.length;
        meta.TotalSegmentCount = (meta.TotalSegmentCount ?? 0) + newCurves.length;
        meta.TotalPointCount = (meta.TotalPointCount ?? 0) + newCurves.length * 2;
        const patched = JSON.stringify(motion, null, 2);
        replacements.set(motionEntry.path, new TextEncoder().encode(patched));
      } catch (e) {
        warnings.push(`failed to patch motion ${motionEntry.path}: ${(e as Error).message}`);
      }
    }
  } else {
    // No motions in the puppet — synthesize one + reference it from
    // model3.json's Idle group so the Framework auto-plays it.
    const synthesized = synthesizeHideMotion(hiddenPartIds);
    const manifestEntry = entries.find((e) => e.path.toLowerCase().endsWith(".model3.json"));
    if (!manifestEntry) {
      warnings.push("no model3.json — cannot wire synthesized hide motion");
      return { replacements, extraFiles, manifestPatch };
    }
    const manifestDir = pathDirectory(manifestEntry.path);
    const newMotionPath = `${manifestDir}${HIDE_MOTION_FILENAME}`;
    extraFiles.push({
      path: newMotionPath,
      bytes: new TextEncoder().encode(JSON.stringify(synthesized, null, 2)),
    });
    try {
      const text = await manifestEntry.blob.text();
      const manifest = JSON.parse(text) as Live2DManifest;
      if (!manifest.FileReferences) manifest.FileReferences = {};
      const refs = manifest.FileReferences;
      if (!refs.Motions) refs.Motions = {};
      const motions = refs.Motions;
      if (!motions.Idle) motions.Idle = [];
      motions.Idle.unshift({ File: HIDE_MOTION_FILENAME });
      manifestPatch = {
        path: manifestEntry.path,
        bytes: new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
      };
    } catch (e) {
      warnings.push(`failed to patch model3.json motion list: ${(e as Error).message}`);
    }
  }

  return { replacements, extraFiles, manifestPatch };
}

function synthesizeHideMotion(hiddenPartIds: Set<string>): Live2DMotionFile {
  const duration = 1.0;
  const curves: Live2DCurve[] = [];
  for (const partId of hiddenPartIds) {
    curves.push({
      Target: "PartOpacity",
      Id: partId,
      Segments: [0, 0, 0, duration, 0],
    });
  }
  return {
    Version: 3,
    Meta: {
      Duration: duration,
      Fps: 30,
      Loop: true,
      AreBeziersRestricted: true,
      CurveCount: curves.length,
      TotalSegmentCount: curves.length,
      TotalPointCount: curves.length * 2,
      UserDataCount: 0,
      TotalUserDataSize: 0,
    },
    Curves: curves,
  };
}

// ----- Spine model-file patching for hide -----

type SpinePatchResult = {
  replacements: Map<string, Uint8Array>;
};

/**
 * Force a set of Spine slots to render no attachment by editing the
 * skeleton's setup pose. Only the JSON skeleton format is supported —
 * `.skel` is binary and a re-emitter is out of scope. When the puppet
 * only ships a `.skel`, we record a warning and the export still
 * produces a zip, just without the hide patch in effect (so the user
 * gets a clear diagnostic instead of a silently-broken export).
 *
 * For each hidden slot we set `slot.attachment = ""` (the JSON-empty
 * way of saying "no attachment in setup pose"), which the Spine
 * Framework respects across all major runtimes.
 */
async function patchSpineForHide(
  entries: BundleEntry[],
  hiddenSlotNames: Set<string>,
  warnings: string[],
): Promise<SpinePatchResult> {
  const replacements = new Map<string, Uint8Array>();
  const skelEntry = entries.find((e) => e.path.toLowerCase().endsWith(".skel"));
  const jsonEntry = entries.find(
    (e) =>
      e.path.toLowerCase().endsWith(".json") &&
      !e.path.toLowerCase().endsWith(".model3.json") &&
      !e.path.toLowerCase().includes("motion"),
  );

  if (!jsonEntry) {
    if (skelEntry) {
      warnings.push(
        `Spine skeleton is binary (.skel); hide patch needs a JSON skeleton — ${hiddenSlotNames.size} hidden slot(s) will still render in the exported zip. Re-export the puppet from Spine Editor as JSON to enable hide.`,
      );
    } else {
      warnings.push("Spine bundle has no skeleton .json or .skel; can't patch slot attachments");
    }
    return { replacements };
  }

  try {
    const text = await jsonEntry.blob.text();
    const skeleton = JSON.parse(text) as SpineSkeletonJson;
    const slots = skeleton.slots;
    if (!Array.isArray(slots)) {
      warnings.push(`skeleton.json has no slots array — can't patch hide`);
      return { replacements };
    }
    let hits = 0;
    for (const slot of slots) {
      if (typeof slot?.name === "string" && hiddenSlotNames.has(slot.name)) {
        slot.attachment = "";
        hits++;
      }
    }
    if (hits === 0) {
      warnings.push(`no slot names matched the ${hiddenSlotNames.size} hidden layer(s)`);
    }
    const patched = JSON.stringify(skeleton);
    replacements.set(jsonEntry.path, new TextEncoder().encode(patched));
  } catch (e) {
    warnings.push(`failed to patch skeleton.json: ${(e as Error).message}`);
  }

  return { replacements };
}

// ----- minimal type shapes for the JSON files we touch -----

type Live2DManifest = {
  Version?: number;
  FileReferences?: {
    Motions?: Record<string, { File: string }[]>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type Live2DMotionFile = {
  Version?: number;
  Meta?: {
    Duration?: number;
    Fps?: number;
    Loop?: boolean;
    AreBeziersRestricted?: boolean;
    CurveCount?: number;
    TotalSegmentCount?: number;
    TotalPointCount?: number;
    UserDataCount?: number;
    TotalUserDataSize?: number;
  };
  Curves?: Live2DCurve[];
  [key: string]: unknown;
};

type Live2DCurve = {
  Target: string;
  Id: string;
  Segments: number[];
  FadeInTime?: number;
  FadeOutTime?: number;
};

type SpineSkeletonJson = {
  slots?: { name?: string; attachment?: string | null; [key: string]: unknown }[];
  [key: string]: unknown;
};
