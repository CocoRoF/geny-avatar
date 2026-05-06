"use client";

import { useEffect, useState } from "react";
import { LayersPanel } from "@/components/LayersPanel";
import { PuppetCanvas } from "@/components/PuppetCanvas";
import { ToolsPanel } from "@/components/ToolsPanel";
import { UploadDropzone } from "@/components/UploadDropzone";
import type { AdapterLoadInput, AvatarAdapter } from "@/lib/adapters/AvatarAdapter";
import { useEditorShortcuts } from "@/lib/avatar/useEditorShortcuts";
import { usePuppetMutations } from "@/lib/avatar/usePuppetMutations";
import { type PuppetId, savePuppet } from "@/lib/persistence/db";
import { useEditorStore } from "@/lib/store/editor";
import { disposeBundle, parseBundle } from "@/lib/upload/parseBundle";
import type { ParsedBundle } from "@/lib/upload/types";

export default function UploadPocPage() {
  const [bundle, setBundle] = useState<ParsedBundle | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [adapter, setAdapter] = useState<AvatarAdapter | null>(null);
  const [savedId, setSavedId] = useState<PuppetId | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // Free blob URLs when the bundle changes or the page unmounts.
  useEffect(() => {
    return () => {
      if (bundle) disposeBundle(bundle);
    };
  }, [bundle]);

  const input: AdapterLoadInput | null = bundle?.ok ? bundle.loadInput : null;
  const { toggleLayer, bulkSetLayerVisibility, playAnimation, reset, undo, redo } =
    usePuppetMutations(adapter);
  useEditorShortcuts({ undo, redo, reset });
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);

  async function handleFiles(files: File[]) {
    if (bundle) disposeBundle(bundle);
    setParseError(null);
    setSavedId(null);
    setSaveStatus("idle");
    try {
      const fileInput: File | File[] =
        files.length === 1 && files[0].name.toLowerCase().endsWith(".zip") ? files[0] : files;
      const parsed = await parseBundle(fileInput);
      if (parsed.ok) {
        setBundle(parsed);
        autoSave(parsed, files);
      } else {
        setBundle(null);
        setParseError(parsed.reason);
      }
    } catch (e) {
      setBundle(null);
      setParseError(e instanceof Error ? e.message : String(e));
    }
  }

  async function autoSave(parsed: ParsedBundle, originalFiles: File[]) {
    if (!parsed.ok) return;
    setSaveStatus("saving");
    try {
      const entries = Array.from(parsed.entries.values());
      const inferredName = inferBundleName(originalFiles, entries, parsed.detection.runtime);
      const id = await savePuppet({
        name: inferredName,
        runtime: parsed.detection.runtime,
        version: parsed.detection.version,
        entries,
      });
      setSavedId(id);
      setSaveStatus("saved");
    } catch (e) {
      console.error("[upload] save failed", e);
      setSaveStatus("error");
    }
  }

  function clear() {
    if (bundle) disposeBundle(bundle);
    setBundle(null);
    setParseError(null);
    setAdapter(null);
    setSavedId(null);
    setSaveStatus("idle");
  }

  const headerStatus = parseError
    ? `parse failed: ${parseError}`
    : !bundle
      ? "drop a bundle"
      : !adapter
        ? "loading…"
        : `loaded · ${bundle.ok ? bundle.detection.runtime : ""}`;

  return (
    <main className="grid h-full grid-cols-[1fr_320px] overflow-hidden bg-[var(--color-bg)]">
      <section className="flex min-h-0 min-w-0 flex-col">
        <header className="shrink-0 border-b border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-fg-dim)]">
          <span className="font-mono text-[var(--color-accent)]">PoC · Upload</span>
          <span className="ml-3">{headerStatus}</span>
          {saveStatus !== "idle" && (
            <span
              className={`ml-3 ${
                saveStatus === "saved"
                  ? "text-[var(--color-accent)]"
                  : saveStatus === "error"
                    ? "text-red-400"
                    : "text-[var(--color-fg-dim)]"
              }`}
            >
              · saved={saveStatus}
              {savedId && saveStatus === "saved" && ` (${savedId.slice(-6)})`}
            </span>
          )}
          {bundle && (
            <button
              type="button"
              onClick={clear}
              className="ml-3 rounded border border-[var(--color-border)] px-2 py-0.5 hover:text-[var(--color-fg)]"
            >
              clear
            </button>
          )}
          {bundle && (
            <>
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
                className="ml-1 rounded border border-[var(--color-border)] px-2 py-0.5 hover:text-[var(--color-fg)]"
                title="r"
              >
                reset
              </button>
            </>
          )}
          <a
            href="/poc/library"
            className="ml-3 rounded border border-[var(--color-border)] px-2 py-0.5 hover:text-[var(--color-fg)]"
          >
            library →
          </a>
          {savedId && saveStatus === "saved" && (
            <a
              href={`/edit/${savedId}`}
              className="ml-3 rounded border border-[var(--color-accent)] px-2 py-0.5 text-[var(--color-accent)]"
            >
              open in editor →
            </a>
          )}
        </header>

        <PuppetCanvas
          input={input}
          onReady={(_avatar, a) => setAdapter(a)}
          onError={(e) => setParseError(e)}
          empty={<UploadDropzone onFiles={handleFiles} className="h-72 w-full max-w-2xl" />}
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

function inferBundleName(
  files: File[],
  entries: { name: string; path: string }[],
  runtime: "spine" | "live2d",
): string {
  if (runtime === "live2d") {
    const manifest = entries.find((e) => e.name.toLowerCase().endsWith(".model3.json"));
    if (manifest) return manifest.name.replace(/\.model3\.json$/i, "");
  } else {
    const skel = entries.find((e) => e.name.toLowerCase().endsWith(".skel"));
    if (skel) return skel.name.replace(/\.skel$/i, "");
    const json = entries.find(
      (e) =>
        e.name.toLowerCase().endsWith(".json") && !e.name.toLowerCase().endsWith(".model3.json"),
    );
    if (json) return json.name.replace(/\.json$/i, "");
  }
  const zip = files.find((f) => f.name.toLowerCase().endsWith(".zip"));
  if (zip) return zip.name.replace(/\.zip$/i, "");
  const firstSlash = entries[0]?.path.indexOf("/") ?? -1;
  if (firstSlash > 0) {
    const prefix = entries[0].path.substring(0, firstSlash);
    if (entries.every((e) => e.path.startsWith(`${prefix}/`))) return prefix;
  }
  return runtime === "live2d" ? "Cubism puppet" : "Spine puppet";
}
