"use client";

import Link from "next/link";
import type { Application } from "pixi.js";
import { use, useEffect, useRef, useState } from "react";
import { AnimationPanel } from "@/components/animation/AnimationPanel";
import { EditorTabBar, useEditorTab } from "@/components/animation/EditorTabBar";
import { ExportButton } from "@/components/ExportButton";
import { HelpModal } from "@/components/HelpModal";
import { LayersPanel } from "@/components/LayersPanel";
import { OnboardingBanner } from "@/components/OnboardingBanner";
import { PuppetCanvas } from "@/components/PuppetCanvas";
import { ReferencesPanel } from "@/components/ReferencesPanel";
import { ToolsPanel } from "@/components/ToolsPanel";
import { VariantsPanel } from "@/components/VariantsPanel";
import type { AdapterLoadInput, AvatarAdapter } from "@/lib/adapters/AvatarAdapter";
import { captureThumbnail } from "@/lib/avatar/captureThumbnail";
import type { Avatar } from "@/lib/avatar/types";
import { useEditorShortcuts } from "@/lib/avatar/useEditorShortcuts";
import { useLayerOverridesPersistence } from "@/lib/avatar/useLayerOverridesPersistence";
import { usePuppetMutations } from "@/lib/avatar/usePuppetMutations";
import { loadPuppet, type PuppetId, type PuppetRow, updatePuppet } from "@/lib/persistence/db";
import { selectLayers, useEditorStore } from "@/lib/store/editor";
import { registerActiveBaker, schedulePuppetSync } from "@/lib/sync/genySync";
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
  // Captured from PuppetCanvas onReady. Needed by the Geny sync baker
  // (see registerActiveBaker effect below) — buildModelZip walks the
  // Avatar graph to map TextureId → bundle path.
  const [avatar, setAvatar] = useState<Avatar | null>(null);
  // Phase 8.1 — sidebar swaps between Edit (texture editing — original
  // panels) and Animation (motion / expression / emotion mapping —
  // populated through 8.3~8.7) based on the URL `?tab=` query.
  const activeTab = useEditorTab();

  /** Sprint 7.1: discoverability surface. `?` key (Shift+/) toggles
   *  the modal, `?` button in the header opens it. Lists shortcuts
   *  + workflow + per-panel intro so a first-timer doesn't need to
   *  bounce between tabs to figure out what's where. */
  const [helpOpen, setHelpOpen] = useState(false);

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

  const { toggleLayer, bulkSetLayerVisibility, applyVariant, playAnimation, reset, undo, redo } =
    usePuppetMutations(adapter);
  useEditorShortcuts({ undo, redo, reset });

  // `?` key toggles help. Same input-focus guard as the existing
  // editor shortcuts hook — typing into a textarea shouldn't pop
  // help. Live with the minor duplication rather than threading
  // help into the shared hook (which has a non-overlapping API).
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
  const visibility = useEditorStore((s) => s.visibilityOverrides);
  const layerMasks = useEditorStore((s) => s.layerMasks);
  const layerTextureOverrides = useEditorStore((s) => s.layerTextureOverrides);
  useLayerOverridesPersistence(adapter ? puppetId : null, layers);

  // ── Geny library auto-sync ───────────────────────────────────────
  // Register the active baker so IDB writes (variants / overrides /
  // animation config) push fresh baked zips to Geny. The baker reads
  // from refs so it always sees the latest editor state without
  // re-registering on every keystroke. Unregisters on unmount.
  const editorStateRef = useRef({
    adapter,
    avatar,
    visibility,
    layerMasks,
    layerTextureOverrides,
  });
  editorStateRef.current = {
    adapter,
    avatar,
    visibility,
    layerMasks,
    layerTextureOverrides,
  };
  useEffect(() => {
    const unregister = registerActiveBaker(async (id) => {
      if (id !== puppetId) return null;
      const s = editorStateRef.current;
      if (!s.adapter || !s.avatar) return null;
      const { buildModelZip } = await import("@/lib/export/buildModelZip");
      const result = await buildModelZip({
        puppetId,
        adapter: s.adapter,
        avatar: s.avatar,
        visibility: s.visibility,
        masks: s.layerMasks,
        textures: s.layerTextureOverrides,
      });
      return { zip: result.zip, filename: result.filename };
    });
    return unregister;
  }, [puppetId]);

  // Initial catch-up sync once the puppet is fully loaded. Library-page
  // uploads / renames don't sync directly (the baker isn't available
  // there), so the first time the user opens a puppet here we push it
  // to Geny so the editor library and Geny's registry line up.
  useEffect(() => {
    if (!adapter || !avatar) return;
    schedulePuppetSync(puppetId);
  }, [puppetId, adapter, avatar]);

  const headerName = puppetRow?.name ?? puppetId.slice(-6);
  const headerStatus = loadError
    ? `error: ${loadError}`
    : !bundle
      ? "loading from library…"
      : !adapter
        ? "loading puppet…"
        : "ready";
  // Surface whether Geny library auto-sync is wired so users know their
  // saves are mirrored. Pure UI affordance — sync runs regardless.
  const isGenyMode = process.env.NEXT_PUBLIC_GENY_HOST === "true";

  return (
    <main className="grid h-full grid-cols-[1fr_320px] overflow-hidden bg-[var(--color-bg)]">
      <section className="flex min-h-0 min-w-0 flex-col">
        <header className="shrink-0 border-b border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-fg-dim)]">
          <EditorTabBar />
          <span className="ml-3">{headerName}</span>
          <span className="ml-3 text-[var(--color-fg-dim)]">· {headerStatus}</span>
          {puppetRow && (
            <span className="ml-3 text-[var(--color-fg-dim)]">
              · {puppetRow.runtime}
              {puppetRow.version ? ` ${puppetRow.version}` : ""}
            </span>
          )}
          {isGenyMode && (
            <span
              className="ml-3 text-[var(--color-fg-dim)]"
              title="라이브러리에 저장되는 즉시 Geny에 자동 동기화됩니다"
            >
              · sync: Geny ↔ Library
            </span>
          )}
          <button
            type="button"
            onClick={undo}
            disabled={!canUndo}
            className="ml-3 rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-fg-dim)] hover:text-[var(--color-fg)] disabled:cursor-not-allowed disabled:opacity-40"
            title="Cmd/Ctrl+Z"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={!canRedo}
            className="ml-1 rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-fg-dim)] hover:text-[var(--color-fg)] disabled:cursor-not-allowed disabled:opacity-40"
            title="Cmd/Ctrl+Shift+Z"
          >
            Redo
          </button>
          <button
            type="button"
            onClick={reset}
            className="ml-3 rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
            title="R"
          >
            Reset
          </button>
          <span className="ml-3">
            <ExportButton puppetId={puppetId} adapter={adapter} />
          </span>
          <Link
            href="/"
            className="ml-3 rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
          >
            ← Library
          </Link>
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className="ml-3 rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
            title="단축키 / 워크플로 / 패널 안내 (?)"
          >
            Help
          </button>
        </header>

        <OnboardingBanner onOpenHelp={() => setHelpOpen(true)} />

        <PuppetCanvas
          input={input}
          onReady={(av, a, pixiApp) => {
            setAvatar(av);
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

      <aside className="flex min-h-0 flex-col overflow-y-auto border-l border-[var(--color-border)]">
        {activeTab === "edit" ? (
          <>
            <ToolsPanel onPlayAnimation={playAnimation} />
            <ReferencesPanel puppetKey={puppetId} />
            <VariantsPanel puppetKey={puppetId} adapter={adapter} onApplyVariant={applyVariant} />
            <LayersPanel
              adapter={adapter}
              puppetKey={puppetId}
              onToggleLayer={toggleLayer}
              onBulkSet={bulkSetLayerVisibility}
            />
          </>
        ) : (
          <AnimationPanel puppetKey={puppetId} adapter={adapter} app={app} />
        )}
      </aside>

      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </main>
  );
}
