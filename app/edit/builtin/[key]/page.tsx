"use client";

import Link from "next/link";
import type { Application } from "pixi.js";
import { use, useEffect, useState } from "react";
import { AnimationPanel } from "@/components/animation/AnimationPanel";
import { EditorTabBar, useEditorTab } from "@/components/animation/EditorTabBar";
import { HelpModal } from "@/components/HelpModal";
import { LayersPanel } from "@/components/LayersPanel";
import { OnboardingBanner } from "@/components/OnboardingBanner";
import { PuppetCanvas } from "@/components/PuppetCanvas";
import { ReferencesPanel } from "@/components/ReferencesPanel";
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
  const [app, setApp] = useState<Application | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  // Phase 8.1 — sidebar swaps between Edit (texture) and Animation
  // (motion / expression mapping) based on `?tab=` query.
  const activeTab = useEditorTab();

  const { toggleLayer, bulkSetLayerVisibility, applyVariant, playAnimation, reset, undo, redo } =
    usePuppetMutations(adapter);
  useEditorShortcuts({ undo, redo, reset });

  // `?` key toggles the help modal — same input-focus guard as the
  // editor shortcuts hook.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "?") return;
      const t = ev.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || t.isContentEditable) return;
      }
      ev.preventDefault();
      setHelpOpen((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);
  const layers = useEditorStore(selectLayers);
  useLayerOverridesPersistence(adapter ? `builtin:${key}` : null, layers);

  if (!sample) {
    return (
      <main className="flex h-full items-center justify-center bg-[var(--color-bg)] text-sm text-[var(--color-fg-dim)]">
        unknown built-in sample: {key}
        <Link href="/" className="ml-3 text-[var(--color-accent)] underline">
          home
        </Link>
      </main>
    );
  }

  const headerStatus = error ? `error: ${error}` : !adapter ? "loading…" : "ready";

  return (
    <main className="grid h-full grid-cols-[1fr_320px] overflow-hidden bg-[var(--color-bg)]">
      <section className="flex min-h-0 min-w-0 flex-col">
        <header className="shrink-0 border-b border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-fg-dim)]">
          <EditorTabBar />
          <span className="ml-3 font-mono text-[var(--color-fg-dim)]">builtin</span>
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
          <Link
            href="/"
            className="ml-3 rounded border border-[var(--color-border)] px-2 py-0.5 hover:text-[var(--color-fg)]"
          >
            ← home
          </Link>
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className="ml-3 rounded border border-[var(--color-border)] px-2 py-0.5 hover:text-[var(--color-fg)]"
            title="단축키 / 워크플로 / 패널 안내 (?)"
          >
            ?
          </button>
        </header>

        <OnboardingBanner onOpenHelp={() => setHelpOpen(true)} />

        <PuppetCanvas
          input={sample.loadInput}
          onReady={(_avatar, a, pixiApp) => {
            setAdapter(a);
            setApp(pixiApp);
          }}
          onError={(e) => setError(e)}
        />
      </section>

      <aside className="flex min-h-0 flex-col overflow-y-auto border-l border-[var(--color-border)]">
        {activeTab === "edit" ? (
          <>
            <ToolsPanel onPlayAnimation={playAnimation} />
            <ReferencesPanel puppetKey={`builtin:${key}`} />
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
          </>
        ) : (
          <AnimationPanel puppetKey={`builtin:${key}`} adapter={adapter} app={app} />
        )}
      </aside>

      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </main>
  );
}
