/**
 * Library auto-publish.
 *
 * Whenever the IndexedDB library is written to (new upload, rename,
 * variant save, layer override, animation config) we — debounced —
 * bake a model zip for the changed puppet and POST it to a generic
 * `/api/library/sync` route. That route writes the zip to a
 * configured output directory (in deployed builds the docker volume
 * shared with Geny; in stand-alone hobby use it's just a folder on
 * disk). A matching `DELETE /api/library/{id}` unlinks the zip on
 * puppet delete. No HTTP coupling with any specific consumer —
 * Geny just happens to mount the same volume and mirror its
 * contents into its model registry.
 *
 * Two zip-building paths:
 *
 *   1. **Active baker** — `buildModelZip` from the editor. Needs
 *      the live Pixi adapter, parsed Avatar graph, and editor-store
 *      maps for visibility / masks / texture overrides. Produces a
 *      runtime-ready baked zip (atlas pages composited, model
 *      patches applied). The editor page registers its baker on
 *      mount via `registerActiveBaker`.
 *
 *   2. **Passthrough** — `buildPassthroughZip` from raw IDB
 *      entries + sidecar. No runtime state needed. Used whenever
 *      the active baker isn't available — typically right after a
 *      library-page upload, or when the editor is open on a
 *      different puppet. The downstream consumer sees the puppet
 *      immediately; if the user later opens it in the editor and
 *      tweaks anything, the active baker re-pushes with the bake
 *      applied and the consumer's puppet-id-based dedup keeps
 *      things tidy.
 *
 * Either way the resulting zip goes through the same
 * `POST /api/library/sync` route and downstream dedupes by
 * `puppet.id` from `avatar-editor.json`.
 *
 * Constraints:
 *   - geny-avatar must keep working in stand-alone mode (no consumer
 *     volume mounted). All publish calls are best-effort: failures
 *     log to console but never throw to the caller.
 *   - Save bursts (multiple variant tweaks in quick succession) collapse
 *     into a single push via a per-puppet debounce timer.
 *   - Builds without `NEXT_PUBLIC_AUTO_PUBLISH` skip the route call
 *     entirely; the route itself short-circuits when its target dir
 *     isn't configured.
 *
 * Public API:
 *   - registerActiveBaker(baker)       — editor calls this on mount;
 *                                         returns an unregister fn.
 *   - schedulePuppetPublish(id, opts?) — debounced push (~600ms).
 *   - cancelPuppetPublish(id)          — drop a pending push.
 *   - publishPuppetNow(id)             — immediate, awaitable.
 *   - removePuppetFromLibrary(id)      — fire-and-forget delete.
 */

import { apiUrl } from "../basePath";
import type { PuppetId } from "../persistence/db";
import { buildPassthroughZip } from "./passthroughBake";

const DEFAULT_DEBOUNCE_MS = 600;

/** Bake one puppet into a zip ready for Geny ingest. The active baker
 *  returns null when it can't bake the requested puppet — typically
 *  because the editor is currently displaying a different puppet. */
export type ActiveBaker = (puppetId: PuppetId) => Promise<{ zip: Blob; filename: string } | null>;

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

/** Whether the current build has auto-publish wired. Both env names
 *  are honoured for backward compat: `NEXT_PUBLIC_AUTO_PUBLISH` is
 *  the new generic name, `NEXT_PUBLIC_GENY_HOST` is the legacy flag
 *  from before this feature was generalised away from Geny-specific
 *  naming. Existing deploy compose files set the latter; new
 *  consumers can use either. */
function isPublishEnabled(): boolean {
  if (typeof process === "undefined") return false;
  return (
    process.env.NEXT_PUBLIC_AUTO_PUBLISH === "true" || process.env.NEXT_PUBLIC_GENY_HOST === "true"
  );
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
export function schedulePuppetPublish(
  puppetId: PuppetId,
  opts: { debounceMs?: number } = {},
): void {
  if (!isPublishEnabled()) return;
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
    existing.inflight = _bakeAndPublish(puppetId).catch((err) => ({
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
export function cancelPuppetPublish(puppetId: PuppetId): void {
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
export async function publishPuppetNow(puppetId: PuppetId): Promise<SyncResult> {
  if (!isPublishEnabled()) {
    return { status: "skipped", reason: "auto-publish disabled" };
  }
  cancelPuppetPublish(puppetId);
  return _bakeAndPublish(puppetId);
}

/**
 * Tell Geny to drop its registry entry for this puppet. Fire-and-
 * forget: failures only surface as console warnings.
 */
export async function removePuppetFromLibrary(puppetId: PuppetId): Promise<SyncResult> {
  if (!isPublishEnabled()) {
    return { status: "skipped", reason: "auto-publish disabled" };
  }
  cancelPuppetPublish(puppetId);
  try {
    const resp = await fetch(apiUrl(`/api/library/${encodeURIComponent(puppetId)}`), {
      method: "DELETE",
    });
    // Geny's library_delete is idempotent — always 200 with a body
    // describing what was actually removed (registry entry + any
    // matching inbox / installed zips). 5xx still bubbles up as a
    // warning so operators see proxy / backend issues; 503 from the
    // proxy means the deploy isn't in Geny mode (no-op skip).
    if (resp.status === 503) {
      return { status: "skipped", reason: "publish target unconfigured (503)" };
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      console.warn(`[auto-publish] remove failed status=${resp.status} body=${text.slice(0, 300)}`);
      return { status: "error", error: `HTTP ${resp.status}` };
    }
    // Clear the catch-up bookkeeping for this puppet so a re-upload
    // with the same name doesn't think it's already synced.
    try {
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(`auto-publish:lastPushedAt:${puppetId}`);
      }
    } catch {
      // ignore
    }
    return { status: "ok" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[auto-publish] remove threw for ${puppetId}: ${msg}`);
    return { status: "error", error: msg };
  }
}

/** Internal: produce a zip for the puppet (prefer the active baker
 *  for a properly-baked output, fall back to a passthrough bundle
 *  of raw IDB entries + sidecar when no baker is available) and
 *  POST it. The fallback path means a freshly-uploaded puppet
 *  appears in Geny immediately, without the user having to open the
 *  editor first. Re-opening the editor later re-pushes with full
 *  bake, transparently replacing the passthrough entry. */
async function _bakeAndPublish(puppetId: PuppetId): Promise<SyncResult> {
  let baked: { zip: Blob; filename: string } | null = null;
  const baker = _activeBaker;

  if (baker) {
    try {
      baked = await baker(puppetId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Don't bail on the whole sync — fall through to the passthrough
      // path so the puppet still lands in Geny even if the baker hit
      // an edge case (missing adapter, mid-mount race, etc.).
      console.warn(
        `[auto-publish] baker threw for ${puppetId}: ${msg} (falling back to passthrough)`,
      );
      baked = null;
    }
  }

  if (!baked) {
    // No baker (typical on the library page after a fresh upload),
    // baker declined (different puppet open), or baker threw. Build
    // a passthrough zip from raw IDB entries so Geny gets the
    // pristine bundle right away.
    try {
      const pass = await buildPassthroughZip(puppetId);
      if (!pass) {
        return { status: "error", error: `puppet ${puppetId} not found in library` };
      }
      baked = { zip: pass.zip, filename: pass.filename };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[auto-publish] passthrough failed for ${puppetId}: ${msg}`);
      return { status: "error", error: msg };
    }
  }

  const fd = new FormData();
  fd.append("zip", new File([baked.zip], baked.filename, { type: "application/zip" }));

  try {
    const resp = await fetch(apiUrl("/api/library/sync"), { method: "POST", body: fd });
    if (resp.status === 503) {
      return { status: "skipped", reason: "publish target unconfigured (503)" };
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      console.warn(`[auto-publish] push failed status=${resp.status} body=${text.slice(0, 300)}`);
      return { status: "error", error: `HTTP ${resp.status}: ${text.slice(0, 200)}` };
    }
    const body = (await resp.json()) as {
      model?: { name?: string };
      status?: string;
    };
    // Record the successful push so the library-page catch-up effect
    // doesn't re-push this puppet on the next page load. Best-effort —
    // localStorage failures (private mode, quota) don't break sync.
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(`auto-publish:lastPushedAt:${puppetId}`, String(Date.now()));
      }
    } catch {
      // ignore
    }
    return { status: "ok", modelName: body.model?.name, bytes: baked.zip.size };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[auto-publish] push threw for ${puppetId}: ${msg}`);
    return { status: "error", error: msg };
  }
}
