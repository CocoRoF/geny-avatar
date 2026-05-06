"use client";

import { useCallback, useEffect, useState } from "react";
import type { AssetOriginNote } from "@/lib/avatar/types";
import { deletePuppet, listPuppets, type PuppetRow, updatePuppet } from "@/lib/persistence/db";

const ORIGIN_OPTIONS: { value: AssetOriginNote["source"]; label: string }[] = [
  { value: "unknown", label: "unknown" },
  { value: "live2d-official", label: "Live2D 공식 샘플" },
  { value: "spine-official", label: "Spine 공식 샘플" },
  { value: "inochi2d-official", label: "Inochi2D 공식" },
  { value: "community", label: "커뮤니티 (서드파티)" },
  { value: "self-made", label: "자체 제작" },
];

export default function LibraryPage() {
  const [puppets, setPuppets] = useState<PuppetRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setPuppets(await listPuppets());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function onDelete(id: string) {
    if (!confirm("Delete this puppet from the library? This can't be undone.")) return;
    try {
      await deletePuppet(id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onOriginChange(id: string, source: AssetOriginNote["source"]) {
    try {
      await updatePuppet(id, { origin: { source } });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <main className="flex h-full flex-col overflow-hidden bg-[var(--color-bg)]">
      <header className="shrink-0 border-b border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-fg-dim)]">
        <span className="font-mono text-[var(--color-accent)]">PoC · Asset Library</span>
        <span className="ml-3">
          {puppets == null
            ? "loading…"
            : `${puppets.length} puppet${puppets.length === 1 ? "" : "s"} saved in IndexedDB`}
        </span>
        <a
          href="/poc/upload"
          className="ml-3 rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
        >
          + upload
        </a>
        {error && <span className="ml-3 text-red-400">error: {error}</span>}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {puppets && puppets.length === 0 && (
          <div className="mx-auto max-w-2xl rounded border border-dashed border-[var(--color-border)] bg-[var(--color-panel)] p-12 text-center text-sm text-[var(--color-fg-dim)]">
            <div className="mb-2 text-[var(--color-fg)]">No puppets saved yet.</div>
            <div>
              Drop a Spine or Cubism bundle on the{" "}
              <a href="/poc/upload" className="text-[var(--color-accent)] underline">
                upload page
              </a>{" "}
              and it'll appear here.
            </div>
          </div>
        )}

        {puppets && puppets.length > 0 && (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {puppets.map((p) => (
              <li
                key={p.id}
                className="flex flex-col rounded border border-[var(--color-border)] bg-[var(--color-panel)]"
              >
                <a
                  href={`/edit/${p.id}`}
                  className="flex flex-1 flex-col p-4 hover:bg-[var(--color-bg)]"
                >
                  <div className="mb-1 flex items-baseline gap-2">
                    <span className="rounded border border-[var(--color-border)] px-1.5 py-0.5 font-mono text-xs text-[var(--color-accent)]">
                      {p.runtime}
                    </span>
                    {p.version && (
                      <span className="font-mono text-xs text-[var(--color-fg-dim)]">
                        {p.version}
                      </span>
                    )}
                    <span className="ml-auto font-mono text-xs text-[var(--color-fg-dim)]">
                      {p.id.slice(-6)}
                    </span>
                  </div>
                  <div className="mb-2 truncate text-base font-medium">{p.name}</div>
                  <div className="text-xs text-[var(--color-fg-dim)]">
                    {p.fileCount} files · {humanBytes(p.totalSize)}
                  </div>
                  <div className="mt-1 text-xs text-[var(--color-fg-dim)]">
                    {formatRelative(p.updatedAt)}
                  </div>
                </a>
                <div className="flex shrink-0 items-center gap-2 border-t border-[var(--color-border)] px-3 py-1.5 text-xs">
                  <span className="text-[var(--color-fg-dim)]">origin:</span>
                  <select
                    value={p.origin?.source ?? "unknown"}
                    onChange={(e) =>
                      onOriginChange(p.id, e.target.value as AssetOriginNote["source"])
                    }
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1.5 py-0.5 text-xs text-[var(--color-fg)] focus:border-[var(--color-accent)] focus:outline-none"
                  >
                    {ORIGIN_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => onDelete(p.id)}
                    className="rounded border border-transparent px-2 py-0.5 text-[var(--color-fg-dim)] hover:border-[var(--color-border)] hover:text-red-400"
                  >
                    delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatRelative(ts: number): string {
  const diffMs = Date.now() - ts;
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}
