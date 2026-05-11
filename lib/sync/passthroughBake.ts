/**
 * Passthrough zip — bundles a puppet from raw IDB entries + a
 * minimal sidecar, with no atlas baking or model-file patching.
 * Used by the Geny sync flow when no active baker is registered
 * (typically because the editor isn't open) so a freshly uploaded
 * puppet can still appear in Geny without the user having to first
 * navigate into the editor.
 *
 * What this gives Geny:
 *   - Original bundle files exactly as they were uploaded
 *   - avatar-editor.json sidecar with the puppet's stable
 *     IndexedDB id + name + runtime + animationConfig
 *
 * What this DOES NOT give Geny:
 *   - Texture-override bakes (paint-mode strokes, AI textures)
 *   - Mask-erased pixels
 *   - Hidden-part patches (pose3.json / motion3.json visibility flags)
 *
 * Those edits live in the editor's runtime state. As soon as the
 * user opens the puppet in the editor again, the registered active
 * baker re-pushes a properly-baked zip via the same sync endpoint,
 * replacing the passthrough version in Geny's registry. Until then
 * Geny renders the pristine bundle — that's the same thing the user
 * would see if they viewed the puppet straight after upload.
 */

import { type Zippable, zipSync } from "fflate";
import { AVATAR_EDITOR_SCHEMA_VERSION, AVATAR_EDITOR_SIDECAR_FILE } from "../export/buildModelZip";
import { loadPuppet, loadPuppetAnimationConfig, type PuppetId } from "../persistence/db";

export interface PassthroughBakeResult {
  zip: Blob;
  filename: string;
  bytes: number;
  fileCount: number;
}

export async function buildPassthroughZip(
  puppetId: PuppetId,
): Promise<PassthroughBakeResult | null> {
  const loaded = await loadPuppet(puppetId);
  if (!loaded) return null;
  const { row, entries } = loaded;

  // Pack the raw bundle entries unchanged.
  const zippable: Zippable = {};
  for (const entry of entries) {
    const ab = await entry.blob.arrayBuffer();
    zippable[entry.path] = new Uint8Array(ab);
  }

  // Sidecar — same shape as buildModelZip's so Geny's install path
  // doesn't care which builder produced the zip. Best-effort on the
  // animation config: if loading throws (e.g. the table doesn't
  // exist yet on a fresh IDB) we just omit the block and Geny
  // applies its defaults.
  let animationConfig: Awaited<ReturnType<typeof loadPuppetAnimationConfig>> = null;
  try {
    animationConfig = await loadPuppetAnimationConfig(puppetId);
  } catch {
    // ignore
  }
  const sidecar: Record<string, unknown> = {
    schemaVersion: AVATAR_EDITOR_SCHEMA_VERSION,
    exporter: `geny-avatar/${row.runtime}/passthrough`,
    exportedAt: Date.now(),
    puppet: {
      id: row.id,
      name: row.name,
      runtime: row.runtime,
      version: row.version,
    },
  };
  if (animationConfig) {
    sidecar.animationConfig = {
      display: animationConfig.display,
      idleMotionGroupName: animationConfig.idleMotionGroupName,
      emotionMap: animationConfig.emotionMap,
      tapMotions: animationConfig.tapMotions,
    };
  }
  zippable[AVATAR_EDITOR_SIDECAR_FILE] = new TextEncoder().encode(
    `${JSON.stringify(sidecar, null, 2)}\n`,
  );

  const bytes = zipSync(zippable, { level: 6 });
  const blob = new Blob([new Uint8Array(bytes).buffer], { type: "application/zip" });
  const safeName = (row.name || "puppet").replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "");
  return {
    zip: blob,
    filename: `${safeName || "puppet"}.zip`,
    bytes: blob.size,
    fileCount: entries.length + 1,
  };
}
