"use client";

import { useMemo, useState } from "react";
import type { AvatarAdapter } from "@/lib/adapters/AvatarAdapter";
import { apiUrl } from "@/lib/basePath";
import type { PuppetId } from "@/lib/persistence/db";
import { selectLayers, useEditorStore } from "@/lib/store/editor";

// 7.6 perf: defer-load fflate + the zip builders until the user actually
// clicks save / export. The builders pull fflate (~28KB) and a chunk of
// our own bake/atlas helpers — none of which is needed for first paint.

// A.3 (Geny integration): when geny-avatar is being run inside the Geny
// docker compose stack, this env var is set to "true" by the avatar-
// editor service env. It enables the third "send to Geny" button which
// writes the baked model zip into the shared /exports volume so Geny's
// backend can import it on the other end.
const IS_IN_GENY = process.env.NEXT_PUBLIC_GENY_HOST === "true";

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
  const [savingMode, setSavingMode] = useState<"none" | "save" | "model" | "send">("none");
  const [error, setError] = useState<string | null>(null);
  const [sendStatus, setSendStatus] = useState<string | null>(null);

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
  // Parts the puppet *already* locks off via its own pose3.json (e.g.
  // from a previous round-trip). These ride along into the next export
  // unchanged — we don't add or remove them. Counting unique part ids
  // (multi-page split duplicates the flag).
  const bakedAlreadyHiddenCount = useMemo(() => {
    const seen = new Set<string>();
    for (const l of layers) {
      if (!l.bakedHidden) continue;
      seen.add(l.externalId.replace(/#p\d+$/, ""));
    }
    return seen.size;
  }, [layers]);
  const maskCount = Object.keys(layerMasks).length;
  const aiTextureCount = Object.keys(layerTextureOverrides).length;

  const totalLoadBearing = bakedHideCount + bakedAlreadyHiddenCount + maskCount + aiTextureCount;
  const saveTitle = puppetId
    ? `Download a .geny-avatar.zip — re-importable session (variants + overrides${
        totalLoadBearing > 0
          ? `, will include: ${bakedHideCount} hide / ${bakedAlreadyHiddenCount} baked / ${maskCount} mask / ${aiTextureCount} gen`
          : ""
      })`
    : "Save this puppet to the library to enable export";
  const modelTitle = !puppetId
    ? "Save this puppet to the library to enable export"
    : !adapter || !avatar
      ? "Wait for the puppet to finish loading"
      : `Download a runtime-ready .zip — atlas + model patches baked in${
          totalLoadBearing > 0
            ? ` (${bakedHideCount} hide via pose3.json / ${bakedAlreadyHiddenCount} already-baked carried over / ${maskCount} mask / ${aiTextureCount} gen on atlas)`
            : ""
        }`;

  async function handleSave() {
    if (!puppetId) return;
    setSavingMode("save");
    setError(null);
    try {
      const { buildExportZip } = await import("@/lib/export/buildBundle");
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
      const { buildModelZip } = await import("@/lib/export/buildModelZip");
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

  // Same baked-model build as `handleExportModel`, but POST the result
  // to the geny-avatar API route that drops it into the shared volume
  // mounted from Geny's docker compose. Geny's backend then sees it
  // appear in /data/baked-imports/ and offers it to install.
  async function handleSendToGeny() {
    if (!puppetId || !adapter || !avatar) return;
    setSavingMode("send");
    setError(null);
    setSendStatus(null);
    try {
      const { buildModelZip } = await import("@/lib/export/buildModelZip");
      const result = await buildModelZip({
        puppetId,
        adapter,
        avatar,
        visibility,
        masks: layerMasks,
        textures: layerTextureOverrides,
      });
      if (result.warnings.length > 0) {
        console.warn("[export:send] warnings", result.warnings);
      }
      const form = new FormData();
      form.append("zip", result.zip, result.filename);
      form.append("filename", result.filename);
      const r = await fetch(apiUrl("/api/send-to-geny"), { method: "POST", body: form });
      if (!r.ok) {
        const body = await r.text().catch(() => "");
        throw new Error(`Geny 전송 실패 (HTTP ${r.status}): ${body || "no body"}`);
      }
      const json = (await r.json()) as { savedAs?: string };
      setSendStatus(`Geny 로 보냈습니다: ${json.savedAs ?? result.filename}`);
      console.info(
        `[export:send] ${result.filename} · ${result.fileCount} files · ${(result.bytes / 1024).toFixed(0)} KB · saved=${json.savedAs ?? "?"}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      console.error("[export:send] failed", e);
    } finally {
      setSavingMode("none");
    }
  }

  const stagedSummary = formatStagedSummary(
    bakedHideCount,
    bakedAlreadyHiddenCount,
    maskCount,
    aiTextureCount,
  );

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
      {IS_IN_GENY && (
        <button
          type="button"
          onClick={() => void handleSendToGeny()}
          disabled={modelDisabled}
          title={
            !puppetId || !adapter || !avatar
              ? "Geny 로 보내려면 puppet 이 라이브러리에 저장되고 로딩이 끝나야 합니다"
              : "Geny 의 VTuber 라이브러리로 baked 모델을 보냅니다 (공유 volume 경유)"
          }
          className="rounded border border-[var(--color-accent)] px-2 py-0.5 text-[var(--color-accent)] hover:bg-[var(--color-accent-dim)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {savingMode === "send" ? "sending…" : "send to Geny"}
        </button>
      )}
      {!disabled && stagedSummary && (
        <span
          className="rounded border border-[var(--color-border)] px-1 font-mono text-[10px] text-[var(--color-fg-dim)]"
          title="edits staged for the next export"
        >
          {stagedSummary}
        </span>
      )}
      {sendStatus && <span className="text-[10px] text-[var(--color-accent)]">{sendStatus}</span>}
      {error && <span className="text-[10px] text-red-400">{error}</span>}
    </span>
  );
}

function formatStagedSummary(
  hides: number,
  baked: number,
  masks: number,
  gens: number,
): string | null {
  if (hides === 0 && baked === 0 && masks === 0 && gens === 0) return null;
  const parts: string[] = [];
  if (hides > 0) parts.push(`${hides} hide`);
  if (baked > 0) parts.push(`${baked} baked`);
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
