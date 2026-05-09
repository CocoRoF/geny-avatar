"use client";

import { useMemo, useState } from "react";
import type { AvatarAdapter } from "@/lib/adapters/AvatarAdapter";
import { buildExportZip } from "@/lib/export/buildBundle";
import { buildModelZip } from "@/lib/export/buildModelZip";
import type { PuppetId } from "@/lib/persistence/db";
import { selectLayers, useEditorStore } from "@/lib/store/editor";

type Props = {
  /** IDB id of the puppet being edited. `null` for builtin samples or
   *  pre-autosave uploads — buttons render disabled with a hint. */
  puppetId: PuppetId | null;
  /** Live runtime adapter — required for "export model" because the
   *  bake step asks the adapter for pristine atlas bitmaps and per-
   *  layer triangles. `null` while the puppet is still loading. */
  adapter: AvatarAdapter | null;
  /** Optional className for layout composition in the page header. */
  className?: string;
};

/**
 * Two side-by-side actions in the editor header:
 *
 *   • **save** — build a `*.geny-avatar.zip` containing the original
 *     bundle + sidecar variant rows + per-layer mask / AI-texture
 *     blobs + visibility map. Re-importing it brings the editor back
 *     to the exact session state, including all variants. The
 *     atlases inside this zip are pristine; our editor knows how to
 *     reapply the sidecar overrides at load time.
 *
 *   • **export model** — build a regular puppet zip whose atlas PNGs
 *     have the user's edits *baked in*. AI textures are composited,
 *     mask-erased pixels are wiped, and explicitly-hidden layers'
 *     atlas footprints are erased so any third-party Spine / Cubism
 *     viewer renders the puppet the way our editor showed it. No
 *     Variants survive — this is one frozen state, not a session.
 *
 * Builtin samples don't have an IDB row and so can't be exported in
 * either form; both buttons render disabled with a hint.
 */
export function ExportButton({ puppetId, adapter, className = "" }: Props) {
  const layers = useEditorStore(selectLayers);
  const visibility = useEditorStore((s) => s.visibilityOverrides);
  const layerMasks = useEditorStore((s) => s.layerMasks);
  const layerTextureOverrides = useEditorStore((s) => s.layerTextureOverrides);
  const avatar = useEditorStore((s) => s.avatar);
  const [savingMode, setSavingMode] = useState<"none" | "save" | "model">("none");
  const [error, setError] = useState<string | null>(null);

  const disabled = puppetId === null || savingMode !== "none";
  const modelDisabled = disabled || adapter === null || avatar === null;

  // Same predicate Export Model uses to decide which parts to bake into
  // pose3.json (and counterparts on Spine). Surface it as a tiny chip
  // beside the button + in its title so the user can tell what's
  // currently load-bearing for the export.
  const bakedHideCount = useMemo(
    () =>
      layers.reduce(
        (n, l) => (visibility[l.id] === false && l.defaults.visible === true ? n + 1 : n),
        0,
      ),
    [layers, visibility],
  );
  const maskCount = Object.keys(layerMasks).length;
  const aiTextureCount = Object.keys(layerTextureOverrides).length;

  const saveTitle = puppetId
    ? `Download a .geny-avatar.zip — re-importable session (variants + overrides${
        bakedHideCount + maskCount + aiTextureCount > 0
          ? `, will include: ${bakedHideCount} hide / ${maskCount} mask / ${aiTextureCount} gen`
          : ""
      })`
    : "Save this puppet to the library to enable export";
  const modelTitle = !puppetId
    ? "Save this puppet to the library to enable export"
    : !adapter || !avatar
      ? "Wait for the puppet to finish loading"
      : `Download a runtime-ready .zip — atlas + model patches baked in${
          bakedHideCount + maskCount + aiTextureCount > 0
            ? ` (${bakedHideCount} hide via pose3.json / ${maskCount} mask / ${aiTextureCount} gen on atlas)`
            : ""
        }`;

  async function handleSave() {
    if (!puppetId) return;
    setSavingMode("save");
    setError(null);
    try {
      const result = await buildExportZip({
        puppetId,
        layers,
        visibilityOverrides: visibility,
        layerMasks,
        layerTextureOverrides,
      });
      triggerDownload(result.zip, result.filename);
      console.info(
        `[export:save] ${result.filename} · ${result.fileCount} files · ${(result.bytes / 1024).toFixed(0)} KB`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      console.error("[export:save] failed", e);
    } finally {
      setSavingMode("none");
    }
  }

  async function handleExportModel() {
    if (!puppetId || !adapter || !avatar) return;
    setSavingMode("model");
    setError(null);
    try {
      const result = await buildModelZip({
        puppetId,
        adapter,
        avatar,
        visibility,
        masks: layerMasks,
        textures: layerTextureOverrides,
      });
      if (result.warnings.length > 0) {
        console.warn("[export:model] warnings", result.warnings);
      }
      triggerDownload(result.zip, result.filename);
      console.info(
        `[export:model] ${result.filename} · ${result.fileCount} files · ${(result.bytes / 1024).toFixed(0)} KB · baked=${result.bakedPages}${
          result.unmatchedPages > 0 ? ` unmatched=${result.unmatchedPages}` : ""
        } · hiddenParts=${result.hiddenParts}${
          result.patchedFiles.length > 0 ? ` patched=${result.patchedFiles.length}` : ""
        }`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      console.error("[export:model] failed", e);
    } finally {
      setSavingMode("none");
    }
  }

  const stagedSummary = formatStagedSummary(bakedHideCount, maskCount, aiTextureCount);

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <button
        type="button"
        onClick={() => void handleSave()}
        disabled={disabled}
        title={saveTitle}
        className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-fg-dim)] hover:text-[var(--color-fg)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {savingMode === "save" ? "saving…" : "save"}
      </button>
      <button
        type="button"
        onClick={() => void handleExportModel()}
        disabled={modelDisabled}
        title={modelTitle}
        className="rounded border border-[var(--color-accent)] px-2 py-0.5 text-[var(--color-accent)] hover:bg-[var(--color-accent-dim)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {savingMode === "model" ? "baking…" : "export model"}
      </button>
      {!disabled && stagedSummary && (
        <span
          className="rounded border border-[var(--color-border)] px-1 font-mono text-[10px] text-[var(--color-fg-dim)]"
          title="edits staged for the next export"
        >
          {stagedSummary}
        </span>
      )}
      {error && <span className="text-[10px] text-red-400">{error}</span>}
    </span>
  );
}

function formatStagedSummary(hides: number, masks: number, gens: number): string | null {
  if (hides === 0 && masks === 0 && gens === 0) return null;
  const parts: string[] = [];
  if (hides > 0) parts.push(`${hides} hide`);
  if (masks > 0) parts.push(`${masks} mask`);
  if (gens > 0) parts.push(`${gens} gen`);
  return parts.join(" · ");
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after a tick so the browser has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}
