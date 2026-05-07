"use client";

import { use, useState } from "react";
import { LayersPanel } from "@/components/LayersPanel";
import { PuppetCanvas } from "@/components/PuppetCanvas";
import { ToolsPanel } from "@/components/ToolsPanel";
import { VariantsPanel } from "@/components/VariantsPanel";
import type { AvatarAdapter } from "@/lib/adapters/AvatarAdapter";
import { useEditorShortcuts } from "@/lib/avatar/useEditorShortcuts";
import { useLayerOverridesPersistence } from "@/lib/avatar/useLayerOverridesPersistence";
import { usePuppetMutations } from "@/lib/avatar/usePuppetMutations";
import { findBuiltin } from "@/lib/builtin/samples";
import { selectLayers, useEditorStore } from "@/lib/store/editor";

/**
 * /edit/builtin/<key> — straight-from-vendor sample editor. Skips
 * IndexedDB; the loadInput points at /samples/... static URLs synced
 * from the vendor submodule.
 */
export default function BuiltinEditPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  const sample = findBuiltin(key);

  const [adapter, setAdapter] = useState<AvatarAdapter | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { toggleLayer, bulkSetLayerVisibility, applyVariant, playAnimation, reset, undo, redo } =
    usePuppetMutations(adapter);
  useEditorShortcuts({ undo, redo, reset });

  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);
  const layers = useEditorStore(selectLayers);
  useLayerOverridesPersistence(adapter ? `builtin:${key}` : null, layers);

  if (!sample) {
    return (
      <main className="flex h-full items-center justify-center bg-[var(--color-bg)] text-sm text-[var(--color-fg-dim)]">
        unknown built-in sample: {key}
        <a href="/" className="ml-3 text-[var(--color-accent)] underline">
          home
        </a>
      </main>
    );
  }

  const headerStatus = error ? `error: ${error}` : !adapter ? "loading…" : "ready";

  return (
    <main className="grid h-full grid-cols-[1fr_320px] overflow-hidden bg-[var(--color-bg)]">
      <section className="flex min-h-0 min-w-0 flex-col">
        <header className="shrink-0 border-b border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-fg-dim)]">
          <span className="font-mono text-[var(--color-accent)]">edit · builtin</span>
          <span className="ml-3">{sample.name}</span>
          <span className="ml-3 text-[var(--color-fg-dim)]">
            · {sample.runtime}
            {sample.version ? ` ${sample.version}` : ""}
          </span>
          <span className="ml-3">· {headerStatus}</span>
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
            href="/"
            className="ml-3 rounded border border-[var(--color-border)] px-2 py-0.5 hover:text-[var(--color-fg)]"
          >
            ← home
          </a>
        </header>

        <PuppetCanvas
          input={sample.loadInput}
          onReady={(_avatar, a) => setAdapter(a)}
          onError={(e) => setError(e)}
        />
      </section>

      <aside className="flex min-h-0 flex-col border-l border-[var(--color-border)]">
        <ToolsPanel onPlayAnimation={playAnimation} />
        <VariantsPanel
          puppetKey={`builtin:${key}`}
          adapter={adapter}
          onApplyVariant={applyVariant}
        />
        <LayersPanel
          adapter={adapter}
          puppetKey={`builtin:${key}`}
          onToggleLayer={toggleLayer}
          onBulkSet={bulkSetLayerVisibility}
        />
      </aside>
    </main>
  );
}
