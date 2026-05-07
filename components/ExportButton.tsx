"use client";

import { useState } from "react";
import { buildExportZip } from "@/lib/export/buildBundle";
import type { PuppetId } from "@/lib/persistence/db";
import { selectLayers, useEditorStore } from "@/lib/store/editor";

type Props = {
  /** IDB id of the puppet being edited. `null` for builtin samples or
   *  pre-autosave uploads — button renders disabled with a hint. */
  puppetId: PuppetId | null;
  /** Optional className for layout composition in the page header. */
  className?: string;
};

/**
 * Triggers a `*.geny-avatar.zip` download containing the original
 * bundle + saved variants + current overrides. The zip is built in
 * memory; for big puppets (hundreds of MB) this can take a couple of
 * seconds, so the button shows a spinner state.
 *
 * Builtin samples don't have IDB `puppetFiles` rows, so export is
 * disabled there. The label explains why instead of just being grey.
 */
export function ExportButton({ puppetId, className = "" }: Props) {
  const layers = useEditorStore(selectLayers);
  const visibility = useEditorStore((s) => s.visibilityOverrides);
  const layerMasks = useEditorStore((s) => s.layerMasks);
  const layerTextureOverrides = useEditorStore((s) => s.layerTextureOverrides);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disabled = puppetId === null || busy;
  const label = busy ? "exporting…" : "export";
  const title = puppetId
    ? "Download a .geny-avatar.zip with your edits + variants"
    : "Save this puppet to the library to enable export";

  async function handleClick() {
    if (!puppetId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await buildExportZip({
        puppetId,
        layers,
        visibilityOverrides: visibility,
        layerMasks,
        layerTextureOverrides,
      });
      const url = URL.createObjectURL(result.zip);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke after a tick so the browser has time to start the download.
      setTimeout(() => URL.revokeObjectURL(url), 5_000);
      console.info(
        `[export] ${result.filename} · ${result.fileCount} files · ${(result.bytes / 1024).toFixed(0)} KB`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      console.error("[export] failed", e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={disabled}
        title={title}
        className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-fg-dim)] hover:text-[var(--color-fg)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {label}
      </button>
      {error && <span className="text-[10px] text-red-400">{error}</span>}
    </span>
  );
}
