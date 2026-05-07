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
import type { AssetOriginNote, AvatarSourceRuntime } from "../avatar/types";
import type { BundleEntry } from "../upload/types";

export type PuppetId = string;
export type AIJobRowId = string;

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

class GenyAvatarDB extends Dexie {
  puppets!: EntityTable<PuppetRow, "id">;
  puppetFiles!: EntityTable<PuppetFileRow, "id">;
  aiJobs!: EntityTable<AIJobRow, "id">;

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
