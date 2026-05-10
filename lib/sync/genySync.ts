/**
 * Geny library auto-sync.
 *
 * Treats geny-avatar's IndexedDB library as the source of truth for
 * Geny's model registry: any time the user saves something in the
 * editor, we (debounced) re-bake the model zip and push it to Geny via
 * `POST /api/library/sync`. Puppet deletions fire a matching
 * `DELETE /api/library/{id}`. Puppet IDs are the IndexedDB primary
 * keys — Geny dedupes by them, so re-syncs replace the prior entry
 * in place.
 *
 * Why this pulls baking through an indirection (`registerActiveBaker`)
 * instead of letting genySync call `buildModelZip` directly:
 *
 *   - `buildModelZip` needs the *live* runtime state (the Pixi adapter,
 *     the parsed `Avatar` graph, plus the editor-store maps for
 *     visibility/masks/textures). These only exist while the user is
 *     in the editor — they aren't in IndexedDB.
 *   - The sync triggers fire from `lib/persistence/db.ts` write paths,
 *     which run in editor *and* library-page contexts. We can't
 *     reconstruct the runtime state from the library page.
 *   - So the editor page registers a baker callback for its current
 *     puppet on mount; sync triggers call this callback to get a
 *     fresh baked zip. Triggers fired while no baker is registered
 *     (e.g. a library-page rename) skip cleanly — the puppet will
 *     sync the next time the user opens it in the editor.
 *
 * Constraints driving the design:
 *   - geny-avatar must keep working when Geny is offline. All sync
 *     calls are best-effort: failure logs to console but never throws
 *     to the caller.
 *   - Save bursts (multiple variant tweaks in quick succession) collapse
 *     into a single push via a per-puppet debounce timer.
 *   - Stand-alone (non-Geny) deployments skip sync entirely; the
 *     server-side proxy returns 503 and we honor that as a no-op.
 *
 * Public API:
 *   - registerActiveBaker(baker)    — editor calls this on mount; the
 *                                      returned function unregisters.
 *   - schedulePuppetSync(id, opts?) — debounced push (default ~600ms).
 *   - cancelPuppetSync(id)          — drop a pending push.
 *   - syncPuppetNow(id)             — immediate, awaitable.
 *   - removePuppetFromGeny(id)      — fire-and-forget delete.
 */

import type { PuppetId } from "../persistence/db";

const DEFAULT_DEBOUNCE_MS = 600;

/** Bake one puppet into a zip ready for Geny ingest. The active baker
 *  returns null when it can't bake the requested puppet — typically
 *  because the editor is currently displaying a different puppet. */
export type ActiveBaker = (
  puppetId: PuppetId,
) => Promise<{ zip: Blob; filename: string } | null>;

interface PendingPush {
  timer: ReturnType<typeof setTimeout> | null;
  generation: number;
  inflight: Promise<SyncResult> | null;
}

export type SyncResult =
  | { status: "ok"; modelName?: string; bytes?: number }
  | { status: "skipped"; reason: string }
  | { status: "error"; error: string };

const _pending = new Map<PuppetId, PendingPush>();
let _activeBaker: ActiveBaker | null = null;

/** Whether the current build advertises Geny integration. */
function isGenyHost(): boolean {
  if (typeof process === "undefined") return false;
  return process.env.NEXT_PUBLIC_GENY_HOST === "true";
}

/**
 * Editor calls this on mount with a callback that builds a baked zip
 * for the puppet it's currently displaying. Returns an unregister fn —
 * the editor should call it on unmount. Multiple registrations
 * supersede each other (last wins); the editor only edits one puppet
 * at a time so this is fine in practice.
 */
export function registerActiveBaker(baker: ActiveBaker): () => void {
  _activeBaker = baker;
  return () => {
    if (_activeBaker === baker) _activeBaker = null;
  };
}

/**
 * Schedule a debounced push for a puppet. Subsequent calls within the
 * debounce window collapse into one push of the latest IDB state. When
 * Geny mode is off, this is a cheap no-op so callers can wire it
 * unconditionally into IndexedDB write paths.
 */
export function schedulePuppetSync(
  puppetId: PuppetId,
  opts: { debounceMs?: number } = {},
): void {
  if (!isGenyHost()) return;
  if (typeof window === "undefined") return; // SSR safety

  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const existing = _pending.get(puppetId) ?? {
    timer: null,
    generation: 0,
    inflight: null,
  };
  if (existing.timer) clearTimeout(existing.timer);
  const generation = existing.generation + 1;
  existing.generation = generation;
  existing.timer = setTimeout(() => {
    existing.timer = null;
    existing.inflight = _bakeAndPush(puppetId).catch((err) => ({
      status: "error" as const,
      error: err instanceof Error ? err.message : String(err),
    }));
    void existing.inflight.finally(() => {
      const current = _pending.get(puppetId);
      if (current && current.generation === generation && !current.timer) {
        current.inflight = null;
      }
    });
  }, debounceMs);
  _pending.set(puppetId, existing);
}

/** Cancel a pending debounced push (used during deletion). */
export function cancelPuppetSync(puppetId: PuppetId): void {
  const pending = _pending.get(puppetId);
  if (pending?.timer) {
    clearTimeout(pending.timer);
    pending.timer = null;
  }
}

/**
 * Synchronously trigger an awaitable push (no debounce). Use for
 * explicit "sync now" actions or for tests.
 */
export async function syncPuppetNow(puppetId: PuppetId): Promise<SyncResult> {
  if (!isGenyHost()) {
    return { status: "skipped", reason: "geny mode not enabled" };
  }
  cancelPuppetSync(puppetId);
  return _bakeAndPush(puppetId);
}

/**
 * Tell Geny to drop its registry entry for this puppet. Fire-and-
 * forget: failures only surface as console warnings.
 */
export async function removePuppetFromGeny(puppetId: PuppetId): Promise<SyncResult> {
  if (!isGenyHost()) {
    return { status: "skipped", reason: "geny mode not enabled" };
  }
  cancelPuppetSync(puppetId);
  try {
    const resp = await fetch(`/api/library/${encodeURIComponent(puppetId)}`, {
      method: "DELETE",
    });
    // Geny's library_delete is idempotent — always 200 with a body
    // describing what was actually removed (registry entry + any
    // matching inbox / installed zips). 5xx still bubbles up as a
    // warning so operators see proxy / backend issues; 503 from the
    // proxy means the deploy isn't in Geny mode (no-op skip).
    if (resp.status === 503) {
      return { status: "skipped", reason: "geny proxy returned 503" };
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      console.warn(
        `[geny-sync] remove failed status=${resp.status} body=${text.slice(0, 300)}`,
      );
      return { status: "error", error: `HTTP ${resp.status}` };
    }
    return { status: "ok" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[geny-sync] remove threw for ${puppetId}: ${msg}`);
    return { status: "error", error: msg };
  }
}

/** Internal: ask the active baker for a zip and POST it. Skips when no
 *  baker is registered (e.g., user is on the library page and not
 *  editing) — the puppet will sync the next time it's opened. */
async function _bakeAndPush(puppetId: PuppetId): Promise<SyncResult> {
  const baker = _activeBaker;
  if (!baker) {
    return {
      status: "skipped",
      reason: "no active baker (open the puppet in the editor to sync)",
    };
  }

  let baked: { zip: Blob; filename: string } | null;
  try {
    baked = await baker(puppetId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[geny-sync] baker threw for ${puppetId}: ${msg}`);
    return { status: "error", error: msg };
  }
  if (!baked) {
    // Baker can't service this puppet right now (most often because
    // the editor is showing a different puppet). Try again later when
    // the editor catches up.
    return {
      status: "skipped",
      reason: "active baker declined this puppet (different puppet open?)",
    };
  }

  const fd = new FormData();
  fd.append("zip", new File([baked.zip], baked.filename, { type: "application/zip" }));

  try {
    const resp = await fetch("/api/library/sync", { method: "POST", body: fd });
    if (resp.status === 503) {
      return { status: "skipped", reason: "geny proxy returned 503" };
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      console.warn(
        `[geny-sync] push failed status=${resp.status} body=${text.slice(0, 300)}`,
      );
      return { status: "error", error: `HTTP ${resp.status}: ${text.slice(0, 200)}` };
    }
    const body = (await resp.json()) as {
      model?: { name?: string };
      status?: string;
    };
    return { status: "ok", modelName: body.model?.name, bytes: baked.zip.size };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[geny-sync] push threw for ${puppetId}: ${msg}`);
    return { status: "error", error: msg };
  }
}
