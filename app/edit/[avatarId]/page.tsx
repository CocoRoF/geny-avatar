"use client";

import { use, useEffect, useState } from "react";
import { LayersPanel } from "@/components/LayersPanel";
import { PuppetCanvas } from "@/components/PuppetCanvas";
import { ToolsPanel } from "@/components/ToolsPanel";
import type { AdapterLoadInput, AvatarAdapter } from "@/lib/adapters/AvatarAdapter";
import { usePuppetMutations } from "@/lib/avatar/usePuppetMutations";
import { loadPuppet, type PuppetId, type PuppetRow } from "@/lib/persistence/db";
import { disposeBundle, parseBundle } from "@/lib/upload/parseBundle";
import type { ParsedBundle } from "@/lib/upload/types";

export default function EditPage({ params }: { params: Promise<{ avatarId: string }> }) {
  const { avatarId } = use(params);
  const puppetId = avatarId as PuppetId;

  const [bundle, setBundle] = useState<ParsedBundle | null>(null);
  const [puppetRow, setPuppetRow] = useState<PuppetRow | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [adapter, setAdapter] = useState<AvatarAdapter | null>(null);

  // Load the puppet from IndexedDB on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await loadPuppet(puppetId);
        if (cancelled) return;
        if (!result) {
          setLoadError(`puppet ${puppetId} not found in library`);
          return;
        }
        setPuppetRow(result.row);
        const parsed = await parseBundle(result.entries);
        if (cancelled) return;
        if (parsed.ok) {
          setBundle(parsed);
        } else {
          setLoadError(parsed.reason);
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [puppetId]);

  // Free blob URLs when the puppet changes / page unmounts.
  useEffect(() => {
    return () => {
      if (bundle) disposeBundle(bundle);
    };
  }, [bundle]);

  const input: AdapterLoadInput | null = bundle?.ok ? bundle.loadInput : null;

  const { toggleLayer, bulkSetLayerVisibility, playAnimation } = usePuppetMutations(adapter);

  const headerName = puppetRow?.name ?? puppetId.slice(-6);
  const headerStatus = loadError
    ? `error: ${loadError}`
    : !bundle
      ? "loading from library…"
      : !adapter
        ? "loading puppet…"
        : "ready";

  return (
    <main className="grid h-full grid-cols-[1fr_320px] overflow-hidden bg-[var(--color-bg)]">
      <section className="flex min-h-0 min-w-0 flex-col">
        <header className="shrink-0 border-b border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-fg-dim)]">
          <span className="font-mono text-[var(--color-accent)]">edit</span>
          <span className="ml-3">{headerName}</span>
          <span className="ml-3 text-[var(--color-fg-dim)]">· {headerStatus}</span>
          {puppetRow && (
            <span className="ml-3 text-[var(--color-fg-dim)]">
              · {puppetRow.runtime}
              {puppetRow.version ? ` ${puppetRow.version}` : ""}
            </span>
          )}
          <a
            href="/poc/library"
            className="ml-3 rounded border border-[var(--color-border)] px-2 py-0.5 hover:text-[var(--color-fg)]"
          >
            ← library
          </a>
        </header>

        <PuppetCanvas
          input={input}
          onReady={(_avatar, a) => setAdapter(a)}
          onError={(e) => setLoadError(e)}
        />

        {bundle?.ok && bundle.warnings.length > 0 && (
          <div className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-panel)] px-4 py-2 text-xs text-yellow-300">
            <span className="font-medium">warnings ({bundle.warnings.length})</span>:{" "}
            {bundle.warnings.slice(0, 3).join(" · ")}
            {bundle.warnings.length > 3 && " · …"}
          </div>
        )}
      </section>

      <aside className="flex min-h-0 flex-col border-l border-[var(--color-border)]">
        <ToolsPanel onPlayAnimation={playAnimation} />
        <LayersPanel onToggleLayer={toggleLayer} onBulkSet={bulkSetLayerVisibility} />
      </aside>
    </main>
  );
}
