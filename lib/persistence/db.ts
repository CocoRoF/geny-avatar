/**
 * IndexedDB persistence for uploaded puppet bundles. Two stores:
 *
 *   - puppets: one row per saved puppet, with metadata (name, runtime,
 *     timestamps, file count, total size, optional origin note and
 *     thumbnail).
 *
 *   - puppetFiles: one row per file in the bundle, holding the path
 *     and the raw Blob. Indexed on puppetId so loadPuppet can fetch
 *     all files of a puppet in a single where-clause.
 *
 * Anything large (texture PNGs, .moc3) lives in puppetFiles.blob — the
 * row is persisted as a Blob, which IndexedDB stores efficiently
 * out-of-line on most engines.
 */

import Dexie, { type EntityTable } from "dexie";
import { ID_PREFIX, newId } from "../avatar/id";
import type { AssetOriginNote, AvatarSourceRuntime } from "../avatar/types";
import type { BundleEntry } from "../upload/types";

export type PuppetId = string;

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

class GenyAvatarDB extends Dexie {
  puppets!: EntityTable<PuppetRow, "id">;
  puppetFiles!: EntityTable<PuppetFileRow, "id">;

  constructor() {
    super("geny-avatar");
    this.version(1).stores({
      puppets: "id, runtime, updatedAt",
      puppetFiles: "++id, puppetId, [puppetId+path]",
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
