/**
 * `*.geny-avatar.zip` round-trip schema.
 *
 * One JSON file at `avatar.json` describes the contents; everything else
 * inside the ZIP is referenced by `path` from there. This keeps the
 * format human-inspectable (open in any zip tool, pretty-print one
 * file) and forward-compatible (unknown fields are preserved through
 * import → re-export).
 *
 * Layout:
 *
 *   my-puppet.geny-avatar.zip
 *   ├─ avatar.json             — `GenyAvatarExport`
 *   ├─ bundle/<path>           — original puppet files, verbatim
 *   ├─ overrides/masks/<eid>.png
 *   ├─ overrides/textures/<eid>.png
 *   └─ LICENSE.md              — origin + AI provenance notes
 *
 * `<eid>` is the layer's runtime-stable externalId, percent-encoded for
 * filesystem safety. Unique per puppet.
 */

import type {
  AssetOriginNote,
  AvatarSourceRuntime,
  NativeVariantSource,
  VariantApplyData,
} from "../avatar/types";

export const GENY_AVATAR_SCHEMA_VERSION = 1 as const;
export const GENY_AVATAR_MARKER_FILE = "avatar.json";
export const GENY_AVATAR_BUNDLE_DIR = "bundle/";
export const GENY_AVATAR_MASKS_DIR = "overrides/masks/";
export const GENY_AVATAR_TEXTURES_DIR = "overrides/textures/";
export const GENY_AVATAR_LICENSE_FILE = "LICENSE.md";

export type GenyAvatarExport = {
  schemaVersion: typeof GENY_AVATAR_SCHEMA_VERSION;
  exportedAt: number;
  exporter: string;

  puppet: {
    name: string;
    runtime: AvatarSourceRuntime;
    version?: string;
    origin?: AssetOriginNote;
    /** Path index of every file in `bundle/`. The actual bytes live at
     *  `bundle/<path>` inside the ZIP. */
    bundleFiles: string[];
  };

  /**
   * Saved variant rows for this puppet. We strip puppetKey + id because
   * both are regenerated on import (the new puppet gets a fresh
   * PuppetId, and each variant gets a fresh row id under that key).
   */
  variants: ExportedVariant[];

  /**
   * The session state at export time — visibility overrides + per-layer
   * mask / AI texture references. Restored on import so the user opens
   * the imported puppet looking exactly like they exported it.
   */
  session: ExportedSession;
};

export type ExportedVariant = {
  name: string;
  description?: string;
  visibility: Record<string, boolean>;
  applyData?: VariantApplyData;
  source: "user" | NativeVariantSource;
  sourceExternalId?: string;
  createdAt: number;
  updatedAt: number;
};

export type ExportedSession = {
  /** layerExternalId → visible. Keyed on externalId (not Layer.id) so
   *  the override survives the post-import adapter reload. */
  visibility: Record<string, boolean>;
  /** layerExternalId → mask PNG path inside the ZIP (overrides/masks/...) */
  masks: Record<string, string>;
  /** layerExternalId → AI-generated texture PNG path inside the ZIP */
  textures: Record<string, string>;
};
