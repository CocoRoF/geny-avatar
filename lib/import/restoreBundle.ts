/**
 * Restore a `*.geny-avatar.zip` exported by `lib/export/buildBundle`.
 *
 * Splits the dropped ZIP into two persistence layers:
 *   1. The original puppet bundle → `savePuppet` (gets a fresh PuppetId)
 *   2. The variants + layer overrides → IDB rows under that new id
 *
 * The caller is expected to navigate to `/edit/<newPuppetId>` after a
 * successful restore — the editor's `useLayerOverridesPersistence`
 * hydrate path will pick up the freshly-written rows.
 *
 * If the ZIP doesn't contain `avatar.json` at the root, `tryRestore`
 * returns `null` so the caller falls back to the regular parseBundle
 * upload path.
 */

import { unzipSync } from "fflate";
import {
  GENY_AVATAR_BUNDLE_DIR,
  GENY_AVATAR_MARKER_FILE,
  GENY_AVATAR_SCHEMA_VERSION,
  type GenyAvatarExport,
} from "../export/types";
import {
  type PuppetId,
  saveLayerOverride,
  savePuppet,
  savePuppetSession,
  saveVariant,
} from "../persistence/db";
import type { BundleEntry } from "../upload/types";

export type RestoreResult = {
  puppetId: PuppetId;
  bundleFiles: number;
  variants: number;
  masks: number;
  textures: number;
  warnings: string[];
};

/**
 * Returns `null` if the ZIP isn't a geny-avatar export (caller should
 * route to the regular puppet bundle parser instead).
 *
 * Throws on a malformed export — schema mismatch, missing referenced
 * files. Callers surface the error to the user; the IDB writes are
 * grouped so a partial restore doesn't leave a half-built puppet
 * behind. (We do a single transaction across savePuppet but variant /
 * override writes happen after; if those fail we still have a usable
 * puppet — better than rolling back the bundle and losing everything.)
 */
export async function tryRestoreGenyAvatarZip(file: File): Promise<RestoreResult | null> {
  if (!file.name.toLowerCase().endsWith(".zip")) return null;

  const buffer = new Uint8Array(await file.arrayBuffer());
  const unzipped = unzipSync(buffer);
  const markerBytes = unzipped[GENY_AVATAR_MARKER_FILE];
  if (!markerBytes) return null;

  let manifest: GenyAvatarExport;
  try {
    manifest = JSON.parse(new TextDecoder().decode(markerBytes)) as GenyAvatarExport;
  } catch (e) {
    throw new Error(`avatar.json is not valid JSON: ${(e as Error).message}`);
  }
  if (manifest.schemaVersion !== GENY_AVATAR_SCHEMA_VERSION) {
    throw new Error(
      `unsupported schemaVersion ${manifest.schemaVersion} (expected ${GENY_AVATAR_SCHEMA_VERSION})`,
    );
  }
  if (!manifest.puppet || !Array.isArray(manifest.puppet.bundleFiles)) {
    throw new Error("avatar.json missing puppet.bundleFiles");
  }

  const warnings: string[] = [];

  // ----- 1) bundle/* → savePuppet -----
  const bundleEntries: BundleEntry[] = [];
  for (const path of manifest.puppet.bundleFiles) {
    const zipPath = `${GENY_AVATAR_BUNDLE_DIR}${path}`;
    const bytes = unzipped[zipPath];
    if (!bytes) {
      warnings.push(`bundle file missing in zip: ${path}`);
      continue;
    }
    const blob = new Blob([new Uint8Array(bytes).buffer], { type: mimeForPath(path) });
    bundleEntries.push({
      name: path.split("/").pop() ?? path,
      path,
      size: bytes.byteLength,
      blob,
    });
  }
  if (bundleEntries.length === 0) {
    throw new Error("zip declared a puppet but contained no bundle files under bundle/");
  }

  const puppetId = await savePuppet({
    name: manifest.puppet.name,
    runtime: manifest.puppet.runtime,
    version: manifest.puppet.version,
    entries: bundleEntries,
    origin: manifest.puppet.origin,
  });

  // ----- 2) variants → IDB -----
  let variantCount = 0;
  for (const v of manifest.variants ?? []) {
    try {
      await saveVariant({
        puppetKey: puppetId,
        name: v.name,
        description: v.description,
        visibility: v.visibility ?? {},
        applyData: v.applyData,
        source: v.source,
        sourceExternalId: v.sourceExternalId,
      });
      variantCount++;
    } catch (e) {
      warnings.push(`variant "${v.name}" failed: ${(e as Error).message}`);
    }
  }

  // ----- 3) masks + AI textures → IDB layerOverrides -----
  let maskCount = 0;
  let textureCount = 0;
  for (const [externalId, zipPath] of Object.entries(manifest.session?.masks ?? {})) {
    const bytes = unzipped[zipPath];
    if (!bytes) {
      warnings.push(`mask file missing: ${zipPath}`);
      continue;
    }
    try {
      await saveLayerOverride({
        puppetKey: puppetId,
        layerExternalId: externalId,
        kind: "mask",
        blob: new Blob([new Uint8Array(bytes).buffer], { type: "image/png" }),
      });
      maskCount++;
    } catch (e) {
      warnings.push(`mask save for ${externalId} failed: ${(e as Error).message}`);
    }
  }
  for (const [externalId, zipPath] of Object.entries(manifest.session?.textures ?? {})) {
    const bytes = unzipped[zipPath];
    if (!bytes) {
      warnings.push(`texture file missing: ${zipPath}`);
      continue;
    }
    try {
      await saveLayerOverride({
        puppetKey: puppetId,
        layerExternalId: externalId,
        kind: "texture",
        blob: new Blob([new Uint8Array(bytes).buffer], { type: "image/png" }),
      });
      textureCount++;
    } catch (e) {
      warnings.push(`texture save for ${externalId} failed: ${(e as Error).message}`);
    }
  }

  // ----- 4) visibility → puppetSessions -----
  if (manifest.session?.visibility && Object.keys(manifest.session.visibility).length > 0) {
    try {
      await savePuppetSession({
        puppetKey: puppetId,
        visibility: manifest.session.visibility,
      });
    } catch (e) {
      warnings.push(`visibility save failed: ${(e as Error).message}`);
    }
  }

  console.info(
    `[restore] puppet=${puppetId.slice(-6)} bundle=${bundleEntries.length} variants=${variantCount} masks=${maskCount} textures=${textureCount}${
      warnings.length > 0 ? ` warnings=${warnings.length}` : ""
    }`,
  );

  return {
    puppetId,
    bundleFiles: bundleEntries.length,
    variants: variantCount,
    masks: maskCount,
    textures: textureCount,
    warnings,
  };
}

function mimeForPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".atlas")) return "text/plain";
  return "application/octet-stream";
}
