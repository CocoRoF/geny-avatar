/**
 * IndexedDB persistence. Stores:
 *
 *   - puppets        — uploaded puppet metadata
 *   - puppetFiles    — raw bundle bytes per puppet
 *   - aiJobs         — successful AI generations per layer (Sprint 3.4)
 *
 * Anything large (texture PNGs, .moc3, generated PNGs) lives in a Blob
 * column — IndexedDB stores Blobs efficiently out-of-line on most
 * engines.
 */

import Dexie, { type EntityTable } from "dexie";
import type { ProviderId } from "../ai/types";
import { ID_PREFIX, newId } from "../avatar/id";
import type {
  AssetOriginNote,
  AvatarSourceRuntime,
  NativeVariantSource,
  VariantApplyData,
} from "../avatar/types";
import type { BundleEntry } from "../upload/types";

export type PuppetId = string;
export type AIJobRowId = string;
export type VariantRowId = string;
export type LayerOverrideRowId = string;
export type ReferenceRowId = string;
export type ComponentLabelsRowId = string;
export type RegionMasksRowId = string;

export type PuppetRow = {
  id: PuppetId;
  name: string;
  runtime: AvatarSourceRuntime;
  version?: string;
  createdAt: number;
  updatedAt: number;
  fileCount: number;
  totalSize: number;
  origin?: AssetOriginNote;
  thumbnailBlob?: Blob;
};

export type PuppetFileRow = {
  /** auto-incremented primary key */
  id?: number;
  puppetId: PuppetId;
  /** path inside the bundle, e.g. "Hiyori.2048/texture_00.png" */
  path: string;
  size: number;
  blob: Blob;
};

/**
 * One AI generation per layer. Only successful jobs land here — the
 * GeneratePanel saves the postprocessed (atlas-ready) blob alongside
 * the exact request params so the user can re-apply or repro later.
 *
 * Keying: `Layer.id` is regenerated on every adapter load, so it
 * cannot be used as a stable history key. We index on
 * `[puppetKey, layerExternalId]` instead — the runtime-native id
 * (Spine slot name, Cubism part id) is stable across reloads, and
 * `puppetKey` is the IDB PuppetId for uploaded puppets or
 * `builtin:${sampleKey}` for built-in samples. History therefore
 * survives page reloads and even browser restarts.
 */
export type AIJobRow = {
  id: AIJobRowId;
  /** Identifies which puppet the job belongs to. Uploaded → IDB
   *  `PuppetId`. Built-in → `"builtin:${sampleKey}"`. */
  puppetKey: string;
  /** Stable runtime id from the adapter (e.g. Spine slot name). */
  layerExternalId: string;
  providerId: ProviderId;
  modelId?: string;
  prompt: string;
  negativePrompt?: string;
  seed?: number;
  /** PNG sized to the layer's upright rect, postprocessed (cropped +
   *  alpha-enforced) and ready to drop into `setLayerOverrides`. */
  resultBlob: Blob;
  /** Bbox signature of the focused region at apply time, for the
   *  multi-region focus flow. Lets the panel filter history per
   *  region (only show entries that came from the same region's
   *  edits). Undefined for single-region applies and for rows
   *  written before this field was added — they only show in the
   *  picker / single-source views. */
  regionSignature?: string;
  createdAt: number;
};

/**
 * A user-saved outfit / part-visibility preset.
 *
 * Phase 4.1 — visibility snapshots only.
 * Phase 4.2 — `applyData` (Spine skin name) + `source` distinguish
 *             user-captured rows from rows imported from a Spine Skin.
 *             Future sprints add color overrides, mask refs, AI texture
 *             refs.
 *
 * Keying mirrors `AIJobRow`: `puppetKey` plus `(layerExternalId → bool)`
 * map. Layer.id is regenerated per load, so visibility is stored against
 * the runtime-stable externalId. Apply walks the live `Avatar.layers`
 * to map externalId back to the current Layer.id.
 *
 * Imported rows carry `(source, sourceExternalId)` so the panel can
 * dedupe a re-import of the same Spine skin even after a rename.
 */
export type VariantRow = {
  id: VariantRowId;
  puppetKey: string;
  name: string;
  description?: string;
  /** layerExternalId → visible. Layers absent from this map keep their
   *  current value when the variant is applied (i.e. partial variants
   *  are allowed — useful for "swap shoes only" presets). */
  visibility: Record<string, boolean>;
  /** Runtime-level preset to push through `adapter.applyVariantData`
   *  before visibility (e.g. `{ spineSkin: "casual" }`). Empty when the
   *  variant is purely visibility-driven. */
  applyData?: VariantApplyData;
  /** "user" — captured manually. Otherwise the runtime native source
   *  the row was imported from. Used to dedupe and to label rows in
   *  the panel. */
  source: "user" | NativeVariantSource;
  /** Runtime-native id of the imported preset (e.g. Spine skin name).
   *  Set only when `source !== "user"`; used for re-import dedup. */
  sourceExternalId?: string;
  createdAt: number;
  updatedAt: number;
};

/**
 * Per-layer override blob (DecomposeStudio mask or AI-generated atlas
 * texture) persisted across page reloads. Sprint 4.5 added this so a
 * geny-avatar.zip import can write the user's edits straight to IDB
 * and have the editor pick them up on the next puppet load. Live
 * mutations (mask save, AI apply) also go through here so that edits
 * survive a refresh — same pattern as `aiJobs` / `variants`.
 *
 * Keying mirrors the rest of the per-puppet stores: `puppetKey` plus
 * the runtime-stable `layerExternalId`. `kind` separates the two
 * channels so the upsert path can find/replace either independently.
 */
export type LayerOverrideRow = {
  id: LayerOverrideRowId;
  puppetKey: string;
  layerExternalId: string;
  kind: "mask" | "texture";
  blob: Blob;
  updatedAt: number;
};

/**
 * Whole-puppet session state — the lighter editor channels that don't
 * fit per-layer storage. Today: just visibility overrides. Future
 * additions (active variant id, last-played animation, viewport
 * camera) drop in as new optional fields.
 *
 * One row per `puppetKey`; uses `puppetKey` itself as the primary key
 * so writes are upserts and hydrate is a single `.get()`.
 */
export type PuppetSessionRow = {
  puppetKey: string;
  /** layerExternalId → visible. Identical convention to
   *  `VariantRow.visibility`; a missing layer just keeps its default. */
  visibility: Record<string, boolean>;
  updatedAt: number;
};

/**
 * A user-uploaded reference image attached to a specific puppet. Sprint
 * 5.1 (Phase 5 — gpt-image-2 era). At generate time these blobs are
 * sent to OpenAI's `/v1/images/edits` as additional `image[]` entries
 * after the layer source, so the model can match character / style
 * across edits without IP-Adapter or LoRA. One row per uploaded
 * image; the user can have many per puppet (cost / latency scales
 * with count, surfaced in the panel).
 *
 * Indexed `[puppetKey+createdAt]` so the panel's "list this puppet's
 * references newest-first" query is one go.
 */
export type ReferenceRow = {
  id: ReferenceRowId;
  puppetKey: string;
  /** Display label — defaults to the source filename. The user can
   *  rename via the panel later (TBD; not in 5.1). */
  name: string;
  /** Whatever the user uploaded: PNG/JPEG/WebP. We don't normalize
   *  format — gpt-image-2's multi-image input accepts any of those
   *  on the non-mask reference slots. */
  blob: Blob;
  createdAt: number;
};

/**
 * Sprint E.2 — manually-defined regions for a layer. Each entry is a
 * named, color-tagged binary mask (PNG blob) painted by the user in
 * DecomposeStudio's "split" mode. When present, GeneratePanel uses
 * these instead of running connected-components on the layer's
 * silhouette — letting the user override auto-detect when the
 * silhouette merges things that should be separate, splits things
 * that should be one, or simply needs a clearer semantic boundary.
 *
 * Single row per (puppetKey, layerExternalId). The `regions` array
 * is small (typically 2–5 entries); a single-row schema keeps the
 * write atomic and makes hydration trivial.
 */
export type RegionMaskEntry = {
  /** Stable id within this layer; survives renames. */
  id: string;
  /** User-typed label. */
  name: string;
  /** Hex color tag — also surfaces in GeneratePanel's region tile. */
  color: string;
  /** Source-canvas-sized binary mask PNG. White (alpha>0) = inside,
   *  transparent = outside. */
  maskBlob: Blob;
};

export type RegionMasksRow = {
  id: RegionMasksRowId;
  puppetKey: string;
  layerExternalId: string;
  regions: RegionMaskEntry[];
  updatedAt: number;
};

/**
 * Phase 8.7 — per-puppet animation/display config.
 *
 * One row per puppet (PuppetId or `builtin:<key>`). Holds the four
 * pieces of metadata the editor's Animation tab edits and that
 * Geny's model_registry consumes:
 *
 *   - display tuning (kScale + initial X/Y shift)
 *   - idle motion group name
 *   - emotionMap: GoEmotion → expression NAME (translated to INDEX
 *     at export time in 8.8)
 *   - tapMotions: hit area → { motion group, index }
 *
 * Single-row-per-puppet store keyed by puppetKey, mirroring the
 * `puppetSessions` shape. No compound indexes — each puppet's row
 * is read whole.
 */
export type PuppetAnimationConfigRow = {
  puppetKey: string;
  display: {
    kScale: number;
    initialXshift: number;
    initialYshift: number;
  };
  idleMotionGroupName: string;
  emotionMap: Record<string, string>;
  tapMotions: Record<string, { group: string; index: number }>;
  updatedAt: number;
};

/**
 * Sprint E.1 — per-component naming for multi-region layers.
 *
 * One row per (puppetKey, layerExternalId). The `labels` map keys
 * are component bbox signatures (`${x}_${y}_${w}_${h}`) so a name
 * survives across panel mounts as long as the layer's source canvas
 * produces the same bbox for that component (typical for a static
 * rigged-puppet layer that the user is iterating on).
 *
 * Labels are *only* attached to auto-detected components for now;
 * Sprint E.2/E.3 introduce manually-defined regions which carry
 * their own names inside the region row itself.
 */
export type ComponentLabelsRow = {
  id: ComponentLabelsRowId;
  puppetKey: string;
  layerExternalId: string;
  labels: Record<string, string>;
  updatedAt: number;
};

class GenyAvatarDB extends Dexie {
  puppets!: EntityTable<PuppetRow, "id">;
  puppetFiles!: EntityTable<PuppetFileRow, "id">;
  aiJobs!: EntityTable<AIJobRow, "id">;
  variants!: EntityTable<VariantRow, "id">;
  layerOverrides!: EntityTable<LayerOverrideRow, "id">;
  puppetSessions!: EntityTable<PuppetSessionRow, "puppetKey">;
  puppetReferences!: EntityTable<ReferenceRow, "id">;
  componentLabels!: EntityTable<ComponentLabelsRow, "id">;
  regionMasks!: EntityTable<RegionMasksRow, "id">;
  puppetAnimationConfig!: EntityTable<PuppetAnimationConfigRow, "puppetKey">;

  constructor() {
    super("geny-avatar");
    this.version(1).stores({
      puppets: "id, runtime, updatedAt",
      puppetFiles: "++id, puppetId, [puppetId+path]",
    });
    // v2: + aiJobs (Sprint 3.4 — per-layer AI generation history).
    // Compound index `[puppetKey+layerExternalId+createdAt]` covers
    // the panel's "history for this layer" query in one go.
    this.version(2).stores({
      puppets: "id, runtime, updatedAt",
      puppetFiles: "++id, puppetId, [puppetId+path]",
      aiJobs: "id, puppetKey, layerExternalId, createdAt, [puppetKey+layerExternalId+createdAt]",
    });
    // v3: + variants (Sprint 4.1 — outfit / part-visibility presets).
    // `[puppetKey+updatedAt]` covers the panel's "list this puppet's
    // variants newest-first" query directly.
    this.version(3).stores({
      puppets: "id, runtime, updatedAt",
      puppetFiles: "++id, puppetId, [puppetId+path]",
      aiJobs: "id, puppetKey, layerExternalId, createdAt, [puppetKey+layerExternalId+createdAt]",
      variants: "id, puppetKey, updatedAt, [puppetKey+updatedAt]",
    });
    // v4: variants gained `applyData` / `source` / `sourceExternalId`
    // (Sprint 4.2 — Spine Skin import). Indexes are unchanged; the
    // upgrade backfills `source: "user"` on rows from v3 so existing
    // captures keep showing as user-made instead of becoming undefined.
    this.version(4)
      .stores({
        puppets: "id, runtime, updatedAt",
        puppetFiles: "++id, puppetId, [puppetId+path]",
        aiJobs: "id, puppetKey, layerExternalId, createdAt, [puppetKey+layerExternalId+createdAt]",
        variants: "id, puppetKey, updatedAt, [puppetKey+updatedAt]",
      })
      .upgrade(async (tx) => {
        await tx
          .table("variants")
          .toCollection()
          .modify((row: Partial<VariantRow>) => {
            if (row.source === undefined) row.source = "user";
          });
      });
    // v5: + layerOverrides (Sprint 4.5 — geny-avatar.zip round-trip
    // and survival of mask / AI-texture edits across page reloads).
    // Compound index `[puppetKey+layerExternalId+kind]` covers
    // upsert ("replace this layer's mask") in one operation; the
    // `[puppetKey+kind]` index covers the editor's "load all
    // overrides for this puppet" hydrate path.
    this.version(5).stores({
      puppets: "id, runtime, updatedAt",
      puppetFiles: "++id, puppetId, [puppetId+path]",
      aiJobs: "id, puppetKey, layerExternalId, createdAt, [puppetKey+layerExternalId+createdAt]",
      variants: "id, puppetKey, updatedAt, [puppetKey+updatedAt]",
      layerOverrides: "id, puppetKey, [puppetKey+layerExternalId+kind], [puppetKey+kind]",
    });
    // v6: + puppetSessions (Sprint 4.5 — visibility round-trip across
    // export/import). One row per puppetKey, used as primary key so
    // upsert is `.put({puppetKey, ...})` and hydrate is `.get()`.
    this.version(6).stores({
      puppets: "id, runtime, updatedAt",
      puppetFiles: "++id, puppetId, [puppetId+path]",
      aiJobs: "id, puppetKey, layerExternalId, createdAt, [puppetKey+layerExternalId+createdAt]",
      variants: "id, puppetKey, updatedAt, [puppetKey+updatedAt]",
      layerOverrides: "id, puppetKey, [puppetKey+layerExternalId+kind], [puppetKey+kind]",
      puppetSessions: "puppetKey, updatedAt",
    });
    // v7: + puppetReferences (Sprint 5.1 — gpt-image-2 multi-image
    // refs). Compound index `[puppetKey+createdAt]` lists a puppet's
    // refs newest-first; the bare `puppetKey` index covers the bulk
    // delete path used when a puppet is removed.
    this.version(7).stores({
      puppets: "id, runtime, updatedAt",
      puppetFiles: "++id, puppetId, [puppetId+path]",
      aiJobs: "id, puppetKey, layerExternalId, createdAt, [puppetKey+layerExternalId+createdAt]",
      variants: "id, puppetKey, updatedAt, [puppetKey+updatedAt]",
      layerOverrides: "id, puppetKey, [puppetKey+layerExternalId+kind], [puppetKey+kind]",
      puppetSessions: "puppetKey, updatedAt",
      puppetReferences: "id, puppetKey, [puppetKey+createdAt]",
    });
    // v8: + componentLabels (Sprint E.1 — per-component naming for
    // multi-region layers). Compound index
    // `[puppetKey+layerExternalId]` is the only access pattern: load
    // the row for "this layer in this puppet" and read / write the
    // labels map. Bare `puppetKey` indexed for cascade delete on
    // puppet removal.
    this.version(8).stores({
      puppets: "id, runtime, updatedAt",
      puppetFiles: "++id, puppetId, [puppetId+path]",
      aiJobs: "id, puppetKey, layerExternalId, createdAt, [puppetKey+layerExternalId+createdAt]",
      variants: "id, puppetKey, updatedAt, [puppetKey+updatedAt]",
      layerOverrides: "id, puppetKey, [puppetKey+layerExternalId+kind], [puppetKey+kind]",
      puppetSessions: "puppetKey, updatedAt",
      puppetReferences: "id, puppetKey, [puppetKey+createdAt]",
      componentLabels: "id, puppetKey, [puppetKey+layerExternalId]",
    });
    // v9: + regionMasks (Sprint E.2 — manually-defined region masks
    // painted in DecomposeStudio's split mode). Same indexing
    // pattern as componentLabels — single-row-per-layer, compound
    // index for the "load this layer's regions" path, bare
    // puppetKey for cascade delete.
    this.version(9).stores({
      puppets: "id, runtime, updatedAt",
      puppetFiles: "++id, puppetId, [puppetId+path]",
      aiJobs: "id, puppetKey, layerExternalId, createdAt, [puppetKey+layerExternalId+createdAt]",
      variants: "id, puppetKey, updatedAt, [puppetKey+updatedAt]",
      layerOverrides: "id, puppetKey, [puppetKey+layerExternalId+kind], [puppetKey+kind]",
      puppetSessions: "puppetKey, updatedAt",
      puppetReferences: "id, puppetKey, [puppetKey+createdAt]",
      componentLabels: "id, puppetKey, [puppetKey+layerExternalId]",
      regionMasks: "id, puppetKey, [puppetKey+layerExternalId]",
    });
    // v10: + puppetAnimationConfig (Phase 8.7 — display tuning,
    // emotionMap, tapMotions, idle group). One row per puppet keyed
    // by puppetKey (PuppetId or "builtin:<key>"). The Animation
    // tab's four sections all read/write through this single row.
    this.version(10).stores({
      puppets: "id, runtime, updatedAt",
      puppetFiles: "++id, puppetId, [puppetId+path]",
      aiJobs: "id, puppetKey, layerExternalId, createdAt, [puppetKey+layerExternalId+createdAt]",
      variants: "id, puppetKey, updatedAt, [puppetKey+updatedAt]",
      layerOverrides: "id, puppetKey, [puppetKey+layerExternalId+kind], [puppetKey+kind]",
      puppetSessions: "puppetKey, updatedAt",
      puppetReferences: "id, puppetKey, [puppetKey+createdAt]",
      componentLabels: "id, puppetKey, [puppetKey+layerExternalId]",
      regionMasks: "id, puppetKey, [puppetKey+layerExternalId]",
      puppetAnimationConfig: "puppetKey, updatedAt",
    });
  }
}

let _db: GenyAvatarDB | null = null;

/** Lazy singleton — db is only opened on first access. SSR-safe (we
 *  never read the singleton on the server). */
function db(): GenyAvatarDB {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB not available — db() called on server");
  }
  if (!_db) _db = new GenyAvatarDB();
  return _db;
}

// ----- Geny library auto-sync triggers -----
//
// These run after IndexedDB writes that affect a puppet's exported
// state — they kick `lib/sync/genySync` so Geny's model registry stays
// in lock-step with what the user sees in their library. Dynamic
// imports avoid the circular-init concern (genySync transitively
// imports loadPuppet from this module). All triggers are no-ops in
// stand-alone mode (NEXT_PUBLIC_GENY_HOST !== "true") because the
// sync module short-circuits there.
function _triggerSyncPush(puppetId: string): void {
  if (typeof window === "undefined") return; // SSR safety
  void import("../sync/genySync")
    .then(({ schedulePuppetSync }) => schedulePuppetSync(puppetId))
    .catch((err) => {
      console.warn(`[db] sync push trigger failed for ${puppetId}:`, err);
    });
}
function _triggerSyncRemove(puppetId: string): void {
  if (typeof window === "undefined") return;
  void import("../sync/genySync")
    .then(({ removePuppetFromGeny }) => removePuppetFromGeny(puppetId))
    .catch((err) => {
      console.warn(`[db] sync remove trigger failed for ${puppetId}:`, err);
    });
}

// ----- public API -----

export type SavePuppetInput = {
  name: string;
  runtime: AvatarSourceRuntime;
  version?: string;
  entries: BundleEntry[];
  origin?: AssetOriginNote;
};

/** Save a fresh puppet bundle. Generates a new id; returns it. */
export async function savePuppet(input: SavePuppetInput): Promise<PuppetId> {
  const id = newId(ID_PREFIX.avatar);
  const now = Date.now();
  const totalSize = input.entries.reduce((sum, e) => sum + e.size, 0);

  await db().transaction("rw", db().puppets, db().puppetFiles, async () => {
    await db().puppets.put({
      id,
      name: input.name,
      runtime: input.runtime,
      version: input.version,
      createdAt: now,
      updatedAt: now,
      fileCount: input.entries.length,
      totalSize,
      origin: input.origin,
    });
    for (const entry of input.entries) {
      await db().puppetFiles.add({
        puppetId: id,
        path: entry.path,
        size: entry.size,
        blob: entry.blob,
      });
    }
  });

  _triggerSyncPush(id);
  return id;
}

/** Read every puppet's metadata, newest first. Used by the library page. */
export async function listPuppets(): Promise<PuppetRow[]> {
  return await db().puppets.orderBy("updatedAt").reverse().toArray();
}

/** Load a puppet's metadata + all its files, ready to feed into the
 *  upload-replay path. */
export async function loadPuppet(
  id: PuppetId,
): Promise<{ row: PuppetRow; entries: BundleEntry[] } | null> {
  const row = await db().puppets.get(id);
  if (!row) return null;
  const fileRows = await db().puppetFiles.where("puppetId").equals(id).toArray();
  const entries: BundleEntry[] = fileRows.map((f) => ({
    name: f.path.split("/").pop() ?? f.path,
    path: f.path,
    size: f.size,
    blob: f.blob,
  }));
  return { row, entries };
}

/** Delete a puppet and all its files. */
export async function deletePuppet(id: PuppetId): Promise<void> {
  await db().transaction("rw", db().puppets, db().puppetFiles, async () => {
    await db().puppets.delete(id);
    await db().puppetFiles.where("puppetId").equals(id).delete();
  });
  _triggerSyncRemove(id);
}

/** Update fields on an existing puppet (e.g. origin note edited later). */
export async function updatePuppet(
  id: PuppetId,
  patch: Partial<Pick<PuppetRow, "name" | "origin" | "thumbnailBlob">>,
): Promise<void> {
  await db().puppets.update(id, { ...patch, updatedAt: Date.now() });
  _triggerSyncPush(id);
}

// ----- AI jobs (Sprint 3.4) -----

export type SaveAIJobInput = Omit<AIJobRow, "id" | "createdAt">;

/** Persist a successful AI generation. Returns the new row id. */
export async function saveAIJob(input: SaveAIJobInput): Promise<AIJobRowId> {
  const id = newId(ID_PREFIX.job);
  await db().aiJobs.put({
    id,
    puppetKey: input.puppetKey,
    layerExternalId: input.layerExternalId,
    providerId: input.providerId,
    modelId: input.modelId,
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
    seed: input.seed,
    resultBlob: input.resultBlob,
    regionSignature: input.regionSignature,
    createdAt: Date.now(),
  });
  return id;
}

/**
 * History for a single layer, newest first. Empty array when none.
 * Lookup is keyed on the stable `(puppetKey, layerExternalId)` pair so
 * results survive page reloads.
 */
export async function listAIJobsForLayer(
  puppetKey: string,
  layerExternalId: string,
): Promise<AIJobRow[]> {
  return await db()
    .aiJobs.where("[puppetKey+layerExternalId+createdAt]")
    .between([puppetKey, layerExternalId, Dexie.minKey], [puppetKey, layerExternalId, Dexie.maxKey])
    .reverse()
    .toArray();
}

export async function deleteAIJob(id: AIJobRowId): Promise<void> {
  await db().aiJobs.delete(id);
}

// ----- Variants (Sprint 4.1) -----

export type SaveVariantInput = {
  puppetKey: string;
  name: string;
  description?: string;
  visibility: Record<string, boolean>;
  applyData?: VariantApplyData;
  source?: "user" | NativeVariantSource;
  sourceExternalId?: string;
};

/** Persist a freshly captured variant. Returns the new row id. */
export async function saveVariant(input: SaveVariantInput): Promise<VariantRowId> {
  const id = newId(ID_PREFIX.variant);
  const now = Date.now();
  await db().variants.put({
    id,
    puppetKey: input.puppetKey,
    name: input.name,
    description: input.description,
    visibility: input.visibility,
    applyData: input.applyData,
    source: input.source ?? "user",
    sourceExternalId: input.sourceExternalId,
    createdAt: now,
    updatedAt: now,
  });
  _triggerSyncPush(input.puppetKey);
  return id;
}

/**
 * All variants for a puppet, newest first. Returns `[]` when no variants
 * exist yet — never throws on a missing puppet.
 */
export async function listVariantsForPuppet(puppetKey: string): Promise<VariantRow[]> {
  return await db()
    .variants.where("[puppetKey+updatedAt]")
    .between([puppetKey, Dexie.minKey], [puppetKey, Dexie.maxKey])
    .reverse()
    .toArray();
}

/** Update the user-editable fields. `updatedAt` is bumped automatically. */
export async function updateVariant(
  id: VariantRowId,
  patch: Partial<Pick<VariantRow, "name" | "description" | "visibility">>,
): Promise<void> {
  const before = await db().variants.get(id);
  await db().variants.update(id, { ...patch, updatedAt: Date.now() });
  if (before?.puppetKey) _triggerSyncPush(before.puppetKey);
}

export async function deleteVariant(id: VariantRowId): Promise<void> {
  const before = await db().variants.get(id);
  await db().variants.delete(id);
  if (before?.puppetKey) _triggerSyncPush(before.puppetKey);
}

// ----- Layer overrides (Sprint 4.5) -----

export type SaveLayerOverrideInput = {
  puppetKey: string;
  layerExternalId: string;
  kind: "mask" | "texture";
  blob: Blob;
};

/**
 * Upsert a layer override blob. Reuses an existing row's id when one
 * already exists for `(puppetKey, layerExternalId, kind)` so the row
 * count stays bounded and lookups stay O(1) per layer.
 */
export async function saveLayerOverride(
  input: SaveLayerOverrideInput,
): Promise<LayerOverrideRowId> {
  const existing = await db()
    .layerOverrides.where("[puppetKey+layerExternalId+kind]")
    .equals([input.puppetKey, input.layerExternalId, input.kind])
    .first();
  const id = existing?.id ?? newId(ID_PREFIX.override);
  await db().layerOverrides.put({
    id,
    puppetKey: input.puppetKey,
    layerExternalId: input.layerExternalId,
    kind: input.kind,
    blob: input.blob,
    updatedAt: Date.now(),
  });
  _triggerSyncPush(input.puppetKey);
  return id;
}

export async function deleteLayerOverride(
  puppetKey: string,
  layerExternalId: string,
  kind: "mask" | "texture",
): Promise<void> {
  await db()
    .layerOverrides.where("[puppetKey+layerExternalId+kind]")
    .equals([puppetKey, layerExternalId, kind])
    .delete();
  _triggerSyncPush(puppetKey);
}

/** All overrides of a given kind for one puppet, used for hydrate-on-load. */
export async function listLayerOverridesForPuppet(
  puppetKey: string,
  kind: "mask" | "texture",
): Promise<LayerOverrideRow[]> {
  return await db().layerOverrides.where("[puppetKey+kind]").equals([puppetKey, kind]).toArray();
}

/** Wipe every override for a puppet. Used by tests + future delete UI. */
export async function deleteAllLayerOverridesForPuppet(puppetKey: string): Promise<void> {
  await db().layerOverrides.where("puppetKey").equals(puppetKey).delete();
}

// ----- Puppet sessions (visibility) (Sprint 4.5) -----

export async function getPuppetSession(puppetKey: string): Promise<PuppetSessionRow | undefined> {
  return await db().puppetSessions.get(puppetKey);
}

export async function savePuppetSession(input: {
  puppetKey: string;
  visibility: Record<string, boolean>;
}): Promise<void> {
  await db().puppetSessions.put({
    puppetKey: input.puppetKey,
    visibility: input.visibility,
    updatedAt: Date.now(),
  });
}

export async function deletePuppetSession(puppetKey: string): Promise<void> {
  await db().puppetSessions.delete(puppetKey);
}

// ----- Puppet references (Sprint 5.1) -----

export type SaveReferenceInput = {
  puppetKey: string;
  name: string;
  blob: Blob;
};

/**
 * Save one user-uploaded reference image. Returns the new row id so
 * the panel can highlight the freshly added entry. We don't dedupe
 * on filename — the user might upload the same name with different
 * content, and dedupe would silently drop the new one.
 */
export async function saveReference(input: SaveReferenceInput): Promise<ReferenceRowId> {
  const id = newId(ID_PREFIX.reference);
  await db().puppetReferences.put({
    id,
    puppetKey: input.puppetKey,
    name: input.name,
    blob: input.blob,
    createdAt: Date.now(),
  });
  return id;
}

/**
 * All references attached to a puppet, newest first. Returns `[]` when
 * the puppet has none — never throws on missing puppet.
 */
export async function listReferencesForPuppet(puppetKey: string): Promise<ReferenceRow[]> {
  return await db()
    .puppetReferences.where("[puppetKey+createdAt]")
    .between([puppetKey, Dexie.minKey], [puppetKey, Dexie.maxKey])
    .reverse()
    .toArray();
}

export async function deleteReference(id: ReferenceRowId): Promise<void> {
  await db().puppetReferences.delete(id);
}

export async function deleteAllReferencesForPuppet(puppetKey: string): Promise<void> {
  await db().puppetReferences.where("puppetKey").equals(puppetKey).delete();
}

// ----- componentLabels (Sprint E.1) -----

/**
 * Look up the saved label map for a single layer. Returns the row's
 * `labels` dictionary keyed by component bbox signature, or `{}` if
 * no row exists yet for this layer.
 */
export async function loadComponentLabels(
  puppetKey: string,
  layerExternalId: string,
): Promise<Record<string, string>> {
  const row = await db()
    .componentLabels.where("[puppetKey+layerExternalId]")
    .equals([puppetKey, layerExternalId])
    .first();
  return row?.labels ?? {};
}

/**
 * Upsert the entire label map for a layer in one go. The submit
 * pipeline doesn't need partial updates — the panel rebuilds the
 * full map on every edit and replaces the row.
 */
export async function saveComponentLabels(input: {
  puppetKey: string;
  layerExternalId: string;
  labels: Record<string, string>;
}): Promise<void> {
  const existing = await db()
    .componentLabels.where("[puppetKey+layerExternalId]")
    .equals([input.puppetKey, input.layerExternalId])
    .first();
  const now = Date.now();
  if (existing) {
    await db().componentLabels.update(existing.id, {
      labels: input.labels,
      updatedAt: now,
    });
  } else {
    await db().componentLabels.put({
      id: newId(ID_PREFIX.componentLabel),
      puppetKey: input.puppetKey,
      layerExternalId: input.layerExternalId,
      labels: input.labels,
      updatedAt: now,
    });
  }
}

export async function deleteAllComponentLabelsForPuppet(puppetKey: string): Promise<void> {
  await db().componentLabels.where("puppetKey").equals(puppetKey).delete();
}

// ----- regionMasks (Sprint E.2) -----

/**
 * Look up the saved manual regions for a layer. Returns the regions
 * array directly, or `[]` if no row exists yet for this layer.
 */
export async function loadRegionMasks(
  puppetKey: string,
  layerExternalId: string,
): Promise<RegionMaskEntry[]> {
  const row = await db()
    .regionMasks.where("[puppetKey+layerExternalId]")
    .equals([puppetKey, layerExternalId])
    .first();
  return row?.regions ?? [];
}

/**
 * Upsert the entire region list for a layer. DecomposeStudio's split
 * mode rebuilds the array on every save (rename / paint / add /
 * delete) and replaces the row; partial updates aren't needed.
 */
export async function saveRegionMasks(input: {
  puppetKey: string;
  layerExternalId: string;
  regions: RegionMaskEntry[];
}): Promise<void> {
  const existing = await db()
    .regionMasks.where("[puppetKey+layerExternalId]")
    .equals([input.puppetKey, input.layerExternalId])
    .first();
  const now = Date.now();
  if (existing) {
    await db().regionMasks.update(existing.id, {
      regions: input.regions,
      updatedAt: now,
    });
  } else {
    await db().regionMasks.put({
      id: newId(ID_PREFIX.regionMask),
      puppetKey: input.puppetKey,
      layerExternalId: input.layerExternalId,
      regions: input.regions,
      updatedAt: now,
    });
  }
}

export async function deleteRegionMasks(puppetKey: string, layerExternalId: string): Promise<void> {
  await db()
    .regionMasks.where("[puppetKey+layerExternalId]")
    .equals([puppetKey, layerExternalId])
    .delete();
}

export async function deleteAllRegionMasksForPuppet(puppetKey: string): Promise<void> {
  await db().regionMasks.where("puppetKey").equals(puppetKey).delete();
}

// ── Puppet animation config (Phase 8.7) ─────────────────────────────

export async function loadPuppetAnimationConfig(
  puppetKey: string,
): Promise<PuppetAnimationConfigRow | null> {
  const row = await db().puppetAnimationConfig.get(puppetKey);
  return row ?? null;
}

export async function savePuppetAnimationConfig(
  input: Omit<PuppetAnimationConfigRow, "updatedAt">,
): Promise<void> {
  await db().puppetAnimationConfig.put({
    ...input,
    updatedAt: Date.now(),
  });
  _triggerSyncPush(input.puppetKey);
}

export async function deletePuppetAnimationConfig(puppetKey: string): Promise<void> {
  await db().puppetAnimationConfig.delete(puppetKey);
  _triggerSyncPush(puppetKey);
}
