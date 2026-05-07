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

class GenyAvatarDB extends Dexie {
  puppets!: EntityTable<PuppetRow, "id">;
  puppetFiles!: EntityTable<PuppetFileRow, "id">;
  aiJobs!: EntityTable<AIJobRow, "id">;
  variants!: EntityTable<VariantRow, "id">;

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
}

/** Update fields on an existing puppet (e.g. origin note edited later). */
export async function updatePuppet(
  id: PuppetId,
  patch: Partial<Pick<PuppetRow, "name" | "origin" | "thumbnailBlob">>,
): Promise<void> {
  await db().puppets.update(id, { ...patch, updatedAt: Date.now() });
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
  await db().variants.update(id, { ...patch, updatedAt: Date.now() });
}

export async function deleteVariant(id: VariantRowId): Promise<void> {
  await db().variants.delete(id);
}
