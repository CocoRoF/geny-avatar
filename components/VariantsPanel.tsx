"use client";

import { useMemo, useState } from "react";
import type { AvatarAdapter } from "@/lib/adapters/AvatarAdapter";
import type { LayerId, NativeVariant, VariantApplyData } from "@/lib/avatar/types";
import { filterUnimportedNativeVariants, useVariants } from "@/lib/avatar/useVariants";
import { selectLayers, useEditorStore } from "@/lib/store/editor";

type Props = {
  /** Stable identifier for the currently-loaded puppet — same scheme as
   *  `LayersPanel`. `null` disables persistence + shows a hint. */
  puppetKey: string | null;
  /** The runtime adapter for the loaded puppet. Used to enumerate native
   *  presets (Spine Skins) and to read the active preset when capturing
   *  a "user" variant. `null` while the puppet is still loading. */
  adapter: AvatarAdapter | null;
  /** Apply a captured variant: caller pushes both the runtime preset
   *  (Spine skin etc.) and the visibility map through the adapter so
   *  the store / runtime / GPU stay in sync. Visibility goes through
   *  history; preset switching does not (re-apply the previous variant
   *  to revert). */
  onApplyVariant: (bundle: {
    visibility: Record<LayerId, boolean>;
    applyData: VariantApplyData;
  }) => void;
};

/**
 * Outfit / part-visibility presets per puppet. Sits above LayersPanel in
 * the right sidebar.
 *
 * Phase 4.1 added user-captured visibility variants. Phase 4.2 adds
 * "import from puppet" — Spine puppets expose their authored Skins
 * here so a single click materializes one as an IDB variant the user
 * can rename / delete / combine with manual visibility tweaks. Capture
 * also records the active Spine skin (via `adapter.getActiveVariantData`)
 * so a "current look" snapshot survives a skin change later.
 *
 * We deliberately don't track an active variant — once the user toggles
 * anything manually after applying, the highlight would lie. The user
 * re-clicks a variant to re-apply if needed.
 */
export function VariantsPanel({ puppetKey, adapter, onApplyVariant }: Props) {
  const layers = useEditorStore(selectLayers);
  const visibility = useEditorStore((s) => s.visibilityOverrides);
  const { variants, capture, importNative, apply, rename, remove } = useVariants(puppetKey);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [importOpen, setImportOpen] = useState(false);

  const persistDisabled = puppetKey === null;

  // The native list is built fresh each render. SpineAdapter returns a
  // new array each call, but the underlying skin set is stable per
  // puppet load — only mutating when the user adds presets, which we
  // don't currently support.
  const nativeVariants: NativeVariant[] = adapter?.listNativeVariants() ?? [];
  const importable = useMemo(
    () => filterUnimportedNativeVariants(nativeVariants, variants),
    [nativeVariants, variants],
  );

  async function commitCapture() {
    const name = draftName.trim();
    if (!name) {
      setCreating(false);
      setDraftName("");
      return;
    }
    const applyData = adapter?.getActiveVariantData() ?? {};
    await capture(name, visibility, layers, { applyData });
    setCreating(false);
    setDraftName("");
  }

  async function commitRename(id: string) {
    const name = renameDraft.trim();
    if (name) await rename(id, name);
    setRenamingId(null);
    setRenameDraft("");
  }

  function handleApply(id: string) {
    const bundle = apply(id, layers);
    if (!bundle) return;
    onApplyVariant(bundle);
  }

  async function handleImport(native: NativeVariant) {
    await importNative(native);
    setImportOpen(false);
  }

  function focusOnMount(el: HTMLInputElement | null) {
    el?.focus();
  }

  const hasImports = !persistDisabled && importable.length > 0;

  return (
    <div className="shrink-0 border-b border-[var(--color-border)] px-4 py-3">
      <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-widest text-[var(--color-fg-dim)]">
        <span>Variants ({variants.length})</span>
        <div className="flex gap-1">
          {hasImports && !creating && (
            <button
              type="button"
              onClick={() => setImportOpen((v) => !v)}
              className={`rounded border px-2 py-0.5 text-[10px] ${
                importOpen
                  ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                  : "border-[var(--color-border)] text-[var(--color-fg-dim)] hover:border-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
              }`}
              title={`Import from puppet (${importable.length} not yet imported)`}
            >
              from puppet ({importable.length})
            </button>
          )}
          {!persistDisabled && !creating && (
            <button
              type="button"
              onClick={() => {
                setCreating(true);
                setDraftName(`Variant ${variants.length + 1}`);
              }}
              className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-fg-dim)] hover:border-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
              title="Save current state as a new variant"
            >
              + capture
            </button>
          )}
        </div>
      </div>

      {persistDisabled && (
        <p className="text-[11px] text-[var(--color-fg-dim)]">
          Save this puppet to the library to enable variants.
        </p>
      )}

      {importOpen && hasImports && (
        <div className="mb-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5">
          <div className="mb-1 text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
            Native presets
          </div>
          <ul className="space-y-0.5">
            {importable.map((n) => (
              <li key={`${n.source}:${n.externalId}`} className="flex items-center gap-1">
                <span className="flex-1 truncate text-xs text-[var(--color-fg)]">
                  {n.name}
                  <span className="ml-2 text-[10px] text-[var(--color-fg-dim)]">{n.source}</span>
                </span>
                <button
                  type="button"
                  onClick={() => void handleImport(n)}
                  className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-fg-dim)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                >
                  import
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {creating && (
        <div className="mb-2 flex gap-1">
          <input
            type="text"
            ref={focusOnMount}
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void commitCapture();
              if (e.key === "Escape") {
                setCreating(false);
                setDraftName("");
              }
            }}
            className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs"
            placeholder="variant name"
          />
          <button
            type="button"
            onClick={() => void commitCapture()}
            className="rounded border border-[var(--color-accent)] px-2 py-1 text-xs text-[var(--color-accent)]"
          >
            save
          </button>
        </div>
      )}

      {variants.length === 0 && !creating && !persistDisabled && (
        <p className="text-[11px] text-[var(--color-fg-dim)]">
          {nativeVariants.length > 0
            ? "Import a Skin from the puppet, or capture your current visibility."
            : "Toggle layers to a look you like, then click + capture."}
        </p>
      )}

      <ul className="space-y-1">
        {variants.map((v) => {
          const layerCount = Object.keys(v.visibility).length;
          const isRenaming = renamingId === v.id;
          const sourceLabel =
            v.source === "spine-skin" ? "skin" : v.source === "live2d-group" ? "group" : null;
          const skinName = v.applyData?.spineSkin;
          const meta =
            sourceLabel && skinName
              ? `${sourceLabel}:${skinName}`
              : sourceLabel
                ? sourceLabel
                : skinName
                  ? `skin:${skinName}`
                  : null;
          return (
            <li
              key={v.id}
              className="group flex items-center gap-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1"
            >
              {isRenaming ? (
                <input
                  type="text"
                  ref={focusOnMount}
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void commitRename(v.id);
                    if (e.key === "Escape") {
                      setRenamingId(null);
                      setRenameDraft("");
                    }
                  }}
                  onBlur={() => void commitRename(v.id)}
                  className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-0.5 text-xs"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => handleApply(v.id)}
                  onDoubleClick={() => {
                    setRenamingId(v.id);
                    setRenameDraft(v.name);
                  }}
                  className="flex-1 truncate text-left text-xs text-[var(--color-fg)] hover:text-[var(--color-accent)]"
                  title={`Apply "${v.name}" (${layerCount} layer overrides${
                    meta ? ` · ${meta}` : ""
                  }). Double-click to rename.`}
                >
                  {v.name}
                  {meta && (
                    <span className="ml-2 font-mono text-[10px] text-[var(--color-fg-dim)]">
                      {meta}
                    </span>
                  )}
                  {layerCount > 0 && (
                    <span className="ml-2 text-[10px] text-[var(--color-fg-dim)]">
                      {layerCount}
                    </span>
                  )}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Delete variant "${v.name}"?`)) void remove(v.id);
                }}
                className="rounded px-1 text-[10px] text-[var(--color-fg-dim)] opacity-0 group-hover:opacity-100 hover:text-red-400"
                title="Delete variant"
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
