"use client";

import type { Application } from "pixi.js";
import { use, useEffect, useState } from "react";
import { LayersPanel } from "@/components/LayersPanel";
import { PuppetCanvas } from "@/components/PuppetCanvas";
import { ToolsPanel } from "@/components/ToolsPanel";
import type { AdapterLoadInput, AvatarAdapter } from "@/lib/adapters/AvatarAdapter";
import { captureThumbnail } from "@/lib/avatar/captureThumbnail";
import { useEditorShortcuts } from "@/lib/avatar/useEditorShortcuts";
import { usePuppetMutations } from "@/lib/avatar/usePuppetMutations";
import { loadPuppet, type PuppetId, type PuppetRow, updatePuppet } from "@/lib/persistence/db";
import { useEditorStore } from "@/lib/store/editor";
import { disposeBundle, parseBundle } from "@/lib/upload/parseBundle";
import type { ParsedBundle } from "@/lib/upload/types";

export default function EditPage({ params }: { params: Promise<{ avatarId: string }> }) {
  const { avatarId } = use(params);
  const puppetId = avatarId as PuppetId;

  const [bundle, setBundle] = useState<ParsedBundle | null>(null);
  const [puppetRow, setPuppetRow] = useState<PuppetRow | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [adapter, setAdapter] = useState<AvatarAdapter | null>(null);
  const [app, setApp] = useState<Application | null>(null);

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

  // Refresh the row's thumbnail every time someone opens the editor —
  // cheap (~10KB webp) and keeps the library card in sync with the
  // current visibility/animation state at last open.
  useEffect(() => {
    if (!app) return;
    let cancelled = false;
    const t = window.setTimeout(async () => {
      try {
        const blob = await captureThumbnail(app);
        if (cancelled || !blob) return;
        await updatePuppet(puppetId, { thumbnailBlob: blob });
      } catch (e) {
        console.warn("[edit] thumbnail capture failed", e);
      }
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [app, puppetId]);

  const input: AdapterLoadInput | null = bundle?.ok ? bundle.loadInput : null;

  const { toggleLayer, bulkSetLayerVisibility, playAnimation, reset, undo, redo } =
    usePuppetMutations(adapter);
  useEditorShortcuts({ undo, redo, reset });
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);

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
          <button
            type="button"
            onClick={undo}
            disabled={!canUndo}
            className="ml-3 rounded border border-[var(--color-border)] px-2 py-0.5 hover:text-[var(--color-fg)] disabled:cursor-not-allowed disabled:opacity-40"
            title="Cmd/Ctrl+Z"
          >
            undo
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={!canRedo}
            className="ml-1 rounded border border-[var(--color-border)] px-2 py-0.5 hover:text-[var(--color-fg)] disabled:cursor-not-allowed disabled:opacity-40"
            title="Cmd/Ctrl+Shift+Z"
          >
            redo
          </button>
          <button
            type="button"
            onClick={reset}
            className="ml-3 rounded border border-[var(--color-border)] px-2 py-0.5 hover:text-[var(--color-fg)]"
            title="r"
          >
            reset
          </button>
          <a
            href="/poc/library"
            className="ml-3 rounded border border-[var(--color-border)] px-2 py-0.5 hover:text-[var(--color-fg)]"
          >
            ← library
          </a>
        </header>

        <PuppetCanvas
          input={input}
          onReady={(_avatar, a, pixiApp) => {
            setAdapter(a);
            setApp(pixiApp);
          }}
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
