"use client";

import { useState } from "react";
import type { LayerId } from "@/lib/avatar/types";
import { useVariants } from "@/lib/avatar/useVariants";
import { selectLayers, useEditorStore } from "@/lib/store/editor";

type Props = {
  /** Stable identifier for the currently-loaded puppet — same scheme as
   *  `LayersPanel`. `null` disables persistence + shows a hint. */
  puppetKey: string | null;
  /** Apply a captured variant: caller pushes the new visibility map
   *  through `bulkSetLayerVisibility` so the store + adapter stay in
   *  sync (variants don't go through history; they're a preset
   *  scrubber). */
  onApplyVisibility: (next: Record<LayerId, boolean>) => void;
};

/**
 * Outfit / part-visibility presets per puppet. Sits above LayersPanel in
 * the right sidebar.
 *
 * Phase 4.1 captures **visibility only**. Color, mask, and AI-texture
 * fields are reserved in the data model but not yet wired here — once
 * 4.2/4.3 add Spine Skin / Live2D group import, the same panel will be
 * the natural surface for them. Capture is "freeze the current visible
 * state"; apply is "set those exact visibilities now". We deliberately
 * don't track an active variant — once the user toggles anything
 * manually after applying, the highlight would lie. The user re-clicks
 * a variant to re-apply if needed.
 */
export function VariantsPanel({ puppetKey, onApplyVisibility }: Props) {
  const layers = useEditorStore(selectLayers);
  const visibility = useEditorStore((s) => s.visibilityOverrides);
  const { variants, capture, apply, rename, remove } = useVariants(puppetKey);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const persistDisabled = puppetKey === null;

  async function commitCapture() {
    const name = draftName.trim();
    if (!name) {
      setCreating(false);
      setDraftName("");
      return;
    }
    await capture(name, visibility, layers);
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
    const next = apply(id, layers);
    if (!next) return;
    onApplyVisibility(next);
  }

  function focusOnMount(el: HTMLInputElement | null) {
    el?.focus();
  }

  return (
    <div className="shrink-0 border-b border-[var(--color-border)] px-4 py-3">
      <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-widest text-[var(--color-fg-dim)]">
        <span>Variants ({variants.length})</span>
        {!persistDisabled && !creating && (
          <button
            type="button"
            onClick={() => {
              setCreating(true);
              setDraftName(`Variant ${variants.length + 1}`);
            }}
            className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-fg-dim)] hover:border-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
            title="Save current visibility as a new variant"
          >
            + capture
          </button>
        )}
      </div>

      {persistDisabled && (
        <p className="text-[11px] text-[var(--color-fg-dim)]">
          Save this puppet to the library to enable variants.
        </p>
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
          No variants yet. Toggle layers to a look you like, then click
          <span className="mx-1 font-mono">+ capture</span>.
        </p>
      )}

      <ul className="space-y-1">
        {variants.map((v) => {
          const layerCount = Object.keys(v.visibility).length;
          const isRenaming = renamingId === v.id;
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
                  title={`Apply "${v.name}" (${layerCount} layers). Double-click to rename.`}
                >
                  {v.name}
                  <span className="ml-2 text-[10px] text-[var(--color-fg-dim)]">{layerCount}</span>
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
