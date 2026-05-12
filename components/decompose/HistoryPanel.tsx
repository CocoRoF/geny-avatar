"use client";

import type { HistoryEntry } from "@/lib/avatar/decompose/useHistory";

/**
 * Sidebar history list — Photoshop's History panel, one click per
 * action. Baseline row is always present at the top; every action
 * appends a new row below. The current state is highlighted; rows
 * past it appear dimmed (those are the redo candidates).
 *
 * Clicking a row jumps directly to that state. Ctrl+Z / Ctrl+Shift+Z
 * are handled by the studio's keydown handler — the buttons in the
 * panel header offer the same actions for mouse-only users.
 *
 * The list is bounded at 30 entries by the underlying hook; older
 * entries fold into the baseline so the undo chain never breaks,
 * the visible row count just stays capped.
 */
export interface HistoryPanelProps {
  entries: ReadonlyArray<HistoryEntry>;
  pointer: number;
  canUndo: boolean;
  canRedo: boolean;
  onGoto: (index: number) => void;
  onUndo: () => void;
  onRedo: () => void;
}

export function HistoryPanel({
  entries,
  pointer,
  canUndo,
  canRedo,
  onGoto,
  onUndo,
  onRedo,
}: HistoryPanelProps) {
  return (
    <div className="mb-3 flex min-h-0 flex-col rounded border border-[var(--color-border)] p-2">
      <div className="mb-1 flex items-center justify-between">
        <div className="uppercase tracking-widest text-[10px] text-[var(--color-fg)]">
          History
          <span className="ml-1 normal-case text-[var(--color-fg-dim)]">({entries.length}/30)</span>
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
            className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-fg-dim)] hover:text-[var(--color-fg)] disabled:cursor-not-allowed disabled:opacity-30"
          >
            ↶ Undo
          </button>
          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            title="Redo (Ctrl+Shift+Z)"
            className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-fg-dim)] hover:text-[var(--color-fg)] disabled:cursor-not-allowed disabled:opacity-30"
          >
            ↷ Redo
          </button>
        </div>
      </div>
      <ul className="max-h-[40vh] space-y-0 overflow-y-auto pr-0.5 text-[11px]">
        <HistoryRow
          label="Open (baseline)"
          isCurrent={pointer === -1}
          isFuture={pointer > -1}
          onClick={() => onGoto(-1)}
        />
        {entries.map((e, i) => (
          <HistoryRow
            key={e.id}
            label={e.label}
            isCurrent={pointer === i}
            isFuture={pointer < i}
            onClick={() => onGoto(i)}
          />
        ))}
      </ul>
      <div className="mt-1.5 border-t border-[var(--color-border)] pt-1.5 text-[10px] leading-relaxed text-[var(--color-fg-dim)]">
        <span className="font-mono text-[var(--color-accent)]">Ctrl+Z</span> 뒤로 ·{" "}
        <span className="font-mono text-[var(--color-accent)]">Ctrl+Shift+Z</span> 앞으로 · 클릭 =
        점프
      </div>
    </div>
  );
}

function HistoryRow({
  label,
  isCurrent,
  isFuture,
  onClick,
}: {
  label: string;
  isCurrent: boolean;
  /** True when this entry is AHEAD of the current pointer (i.e.,
   *  a redo candidate). Dimmed so the user can tell it's a "ghost"
   *  state. */
  isFuture: boolean;
  onClick: () => void;
}) {
  const palette = isCurrent
    ? "bg-[var(--color-accent)]/15 text-[var(--color-accent)] border-l-2 border-[var(--color-accent)]"
    : isFuture
      ? "text-[var(--color-fg-dim)] opacity-50 border-l-2 border-transparent"
      : "text-[var(--color-fg)] border-l-2 border-transparent hover:bg-[var(--color-bg)]";
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`flex w-full items-center gap-1.5 rounded-r px-1.5 py-0.5 text-left ${palette}`}
      >
        <span className="font-mono text-[9px] w-3 shrink-0">{isCurrent ? "▸" : " "}</span>
        <span className="truncate">{label}</span>
      </button>
    </li>
  );
}
