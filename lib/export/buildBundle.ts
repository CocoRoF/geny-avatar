/**
 * Build a `*.geny-avatar.zip` from the current edit session.
 *
 * Inputs come from three places:
 *   - IndexedDB: the original puppet files + saved Variants
 *   - In-memory store: visibility overrides + masks + AI textures
 *   - The PuppetRow itself: name, runtime, origin
 *
 * Output is one Blob ready for `URL.createObjectURL` + `<a download>`.
 */

import { type Zippable, zipSync } from "fflate";
import type { Layer } from "../avatar/types";
import {
  type AIJobRow,
  listAIJobsForLayer,
  listVariantsForPuppet,
  loadPuppet,
  type PuppetId,
  type PuppetRow,
} from "../persistence/db";
import {
  type ExportedSession,
  type ExportedVariant,
  GENY_AVATAR_BUNDLE_DIR,
  GENY_AVATAR_LICENSE_FILE,
  GENY_AVATAR_MARKER_FILE,
  GENY_AVATAR_MASKS_DIR,
  GENY_AVATAR_SCHEMA_VERSION,
  GENY_AVATAR_TEXTURES_DIR,
  type GenyAvatarExport,
} from "./types";

const EXPORTER_TAG = "geny-avatar/0.1";

export type BuildExportInput = {
  /** IDB id of the puppet being exported. Builtin puppets aren't
   *  supported (they have no IDB row); the caller should hide the
   *  Export button when this isn't an uploaded puppet. */
  puppetId: PuppetId;
  /** Live `Avatar.layers` so we can map the in-memory store's
   *  Layer.id-keyed maps back onto the runtime-stable externalId. */
  layers: ReadonlyArray<Layer>;
  /** Current visibility overrides from the editor store. */
  visibilityOverrides: Record<string, boolean>;
  /** Current per-layer masks from the editor store. */
  layerMasks: Record<string, Blob>;
  /** Current per-layer AI textures from the editor store. */
  layerTextureOverrides: Record<string, Blob>;
};

export type BuildExportResult = {
  zip: Blob;
  filename: string;
  bytes: number;
  fileCount: number;
};

/**
 * Compose every piece into one in-memory zip and return it as a Blob.
 * Throws if the puppet doesn't exist in IDB.
 */
export async function buildExportZip(input: BuildExportInput): Promise<BuildExportResult> {
  const loaded = await loadPuppet(input.puppetId);
  if (!loaded) throw new Error(`puppet ${input.puppetId} not found in library`);
  const { row, entries } = loaded;

  const variants = await listVariantsForPuppet(input.puppetId);

  const idToExternal = new Map<string, string>();
  for (const layer of input.layers) idToExternal.set(layer.id, layer.externalId);

  const visibilityByExternal: Record<string, boolean> = {};
  for (const [layerId, visible] of Object.entries(input.visibilityOverrides)) {
    const ext = idToExternal.get(layerId);
    if (ext) visibilityByExternal[ext] = visible;
  }

  // Map Layer.id-keyed override blobs to externalId-keyed ZIP paths.
  // Iterate in layer order so collisions on duplicate externalIds (which
  // shouldn't occur but are recoverable) keep the first deterministically.
  const masksByExternal: Record<string, Blob> = {};
  const texturesByExternal: Record<string, Blob> = {};
  for (const [layerId, blob] of Object.entries(input.layerMasks)) {
    const ext = idToExternal.get(layerId);
    if (ext) masksByExternal[ext] = blob;
  }
  for (const [layerId, blob] of Object.entries(input.layerTextureOverrides)) {
    const ext = idToExternal.get(layerId);
    if (ext) texturesByExternal[ext] = blob;
  }

  // Build paths in the ZIP. Each path is `<dir>/<encoded externalId>.png`.
  const masksPaths: Record<string, string> = {};
  const texturesPaths: Record<string, string> = {};
  for (const ext of Object.keys(masksByExternal)) {
    masksPaths[ext] = `${GENY_AVATAR_MASKS_DIR}${encodeForPath(ext)}.png`;
  }
  for (const ext of Object.keys(texturesByExternal)) {
    texturesPaths[ext] = `${GENY_AVATAR_TEXTURES_DIR}${encodeForPath(ext)}.png`;
  }

  const exportedVariants: ExportedVariant[] = variants.map((v) => ({
    name: v.name,
    description: v.description,
    visibility: v.visibility,
    applyData: v.applyData,
    source: v.source,
    sourceExternalId: v.sourceExternalId,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  }));

  const session: ExportedSession = {
    visibility: visibilityByExternal,
    masks: masksPaths,
    textures: texturesPaths,
  };

  const exportJson: GenyAvatarExport = {
    schemaVersion: GENY_AVATAR_SCHEMA_VERSION,
    exportedAt: Date.now(),
    exporter: EXPORTER_TAG,
    puppet: {
      name: row.name,
      runtime: row.runtime,
      version: row.version,
      origin: row.origin,
      bundleFiles: entries.map((e) => e.path),
    },
    variants: exportedVariants,
    session,
  };

  // Pull the AI provenance entries to inline into LICENSE.md (best-effort —
  // the LICENSE is informational only and isn't parsed on import).
  const aiJobsByLayer: Map<string, AIJobRow[]> = new Map();
  for (const ext of Object.keys(texturesByExternal)) {
    const jobs = await listAIJobsForLayer(input.puppetId, ext);
    if (jobs.length > 0) aiJobsByLayer.set(ext, jobs);
  }
  const license = renderLicenseMd({ row, exportJson, aiJobsByLayer });

  // ----- materialize the in-memory zip table -----
  const zippable: Zippable = {};
  zippable[GENY_AVATAR_MARKER_FILE] = stringToBytes(JSON.stringify(exportJson, null, 2));
  zippable[GENY_AVATAR_LICENSE_FILE] = stringToBytes(license);

  for (const e of entries) {
    const buf = new Uint8Array(await e.blob.arrayBuffer());
    zippable[`${GENY_AVATAR_BUNDLE_DIR}${e.path}`] = buf;
  }
  for (const [ext, blob] of Object.entries(masksByExternal)) {
    zippable[masksPaths[ext]] = new Uint8Array(await blob.arrayBuffer());
  }
  for (const [ext, blob] of Object.entries(texturesByExternal)) {
    zippable[texturesPaths[ext]] = new Uint8Array(await blob.arrayBuffer());
  }

  const zipBytes = zipSync(zippable, { level: 6 });
  // The Blob ctor's BlobPart typing rejects `Uint8Array<ArrayBufferLike>` in
  // strict TS configs (the ctor wants ArrayBufferView<ArrayBuffer>). Wrap as
  // a fresh Uint8Array over a copied ArrayBuffer to satisfy the type — the
  // copy is one allocation regardless of zip size.
  const zipBlob = new Blob([new Uint8Array(zipBytes).buffer], { type: "application/zip" });
  const filename = makeFilename(row);

  return {
    zip: zipBlob,
    filename,
    bytes: zipBlob.size,
    fileCount: Object.keys(zippable).length,
  };
}

/**
 * Layer externalIds can carry path-hostile characters (Cubism's
 * `PartArtMesh1#p0` → `#` is fine but `/` would not be). Percent-encode
 * defensively so the ZIP path is portable across OSes.
 */
function encodeForPath(externalId: string): string {
  return encodeURIComponent(externalId);
}

function stringToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function makeFilename(row: PuppetRow): string {
  const base = row.name.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "") || "puppet";
  return `${base}.geny-avatar.zip`;
}

function renderLicenseMd(input: {
  row: PuppetRow;
  exportJson: GenyAvatarExport;
  aiJobsByLayer: Map<string, AIJobRow[]>;
}): string {
  const { row, exportJson, aiJobsByLayer } = input;
  const lines: string[] = [];
  lines.push(`# ${row.name}`);
  lines.push("");
  lines.push("This bundle was exported from **geny-avatar**.");
  lines.push("");
  lines.push(`- Runtime: \`${row.runtime}\`${row.version ? ` ${row.version}` : ""}`);
  lines.push(`- Exported at: ${new Date(exportJson.exportedAt).toISOString()}`);
  if (row.origin) {
    lines.push(`- Origin source: \`${row.origin.source}\``);
    if (row.origin.url) lines.push(`- Origin URL: ${row.origin.url}`);
    if (row.origin.notes) lines.push(`- Origin notes: ${row.origin.notes}`);
  }
  lines.push("");
  lines.push("## Bundle contents");
  lines.push("");
  lines.push(`- \`bundle/\` — original puppet files (${exportJson.puppet.bundleFiles.length})`);
  if (exportJson.variants.length > 0) {
    lines.push(`- \`avatar.json\` — ${exportJson.variants.length} saved variant(s)`);
  }
  const maskCount = Object.keys(exportJson.session.masks).length;
  const texCount = Object.keys(exportJson.session.textures).length;
  if (maskCount > 0) lines.push(`- \`overrides/masks/\` — ${maskCount} hand-painted mask(s)`);
  if (texCount > 0) {
    lines.push(`- \`overrides/textures/\` — ${texCount} AI-generated texture override(s)`);
  }
  if (aiJobsByLayer.size > 0) {
    lines.push("");
    lines.push("## AI provenance");
    lines.push("");
    lines.push("Generated layer textures came from the following requests:");
    lines.push("");
    for (const [externalId, jobs] of aiJobsByLayer) {
      const latest = jobs[0];
      lines.push(
        `- **${externalId}** — ${latest.providerId}${
          latest.modelId ? `/${latest.modelId}` : ""
        } · prompt: \`${truncate(latest.prompt, 120)}\``,
      );
    }
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(
    "Re-import via the geny-avatar upload page (`/poc/upload`); the dropzone auto-detects this format.",
  );
  return lines.join("\n");
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
