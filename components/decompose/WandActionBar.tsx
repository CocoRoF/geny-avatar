"use client";

import type { StudioMode } from "@/lib/avatar/decompose/tools";

/**
 * Floating action bar that appears above the canvas whenever a wand
 * selection is active. Photoshop's "Refine Edge" + "Select and Mask"
 * bars are the inspiration: every action the user might want to do
 * with a selection within arm's reach, no menu hunting.
 *
 * Layout decision (per user spec): floats over the canvas, top-
 * centre. The canvas itself owns mouse events; this bar overlays the
 * top edge so the user doesn't have to look at the sidebar for the
 * common selection ops. Sidebar still hosts the deeper controls.
 *
 * Action set:
 *   - Selection area readout (so the user knows roughly what they
 *     just selected)
 *   - Apply (with op label from studio mode)
 *   - Subtract (the opposite op)
 *   - Invert / Grow / Shrink / Feather (the powerful "refine" set)
 *   - Save as Region (split mode only — promotes the selection to a
 *     full-fledged named region with no extra steps)
 *   - Deselect / Clear
 *
 * Keyboard hints render to the right of each button. The studio
 * keyboard handler binds the same shortcuts.
 */
export interface WandActionBarProps {
  area: number;
  studioMode: StudioMode;
  onApplyAdd: () => void;
  onApplyRemove: () => void;
  onInvert: () => void;
  onGrow: () => void;
  onShrink: () => void;
  onFeather: () => void;
  onSaveAsRegion?: () => void; // split mode only
  onDeselect: () => void;
}

export function WandActionBar({
  area,
  studioMode,
  onApplyAdd,
  onApplyRemove,
  onInvert,
  onGrow,
  onShrink,
  onFeather,
  onSaveAsRegion,
  onDeselect,
}: WandActionBarProps) {
  const labels =
    studioMode === "trim"
      ? { add: "Hide", remove: "Reveal" }
      : studioMode === "paint"
        ? { add: "Fill", remove: "Erase" }
        : { add: "Add to region", remove: "Remove" };

  return (
    <div
      role="toolbar"
      aria-label="Selection actions"
      className="pointer-events-auto absolute left-1/2 top-3 z-30 -translate-x-1/2 rounded-lg border border-blue-400/40 bg-[var(--color-panel)]/95 px-2 py-1.5 text-[11px] shadow-lg backdrop-blur-sm"
    >
      <div className="flex items-center gap-1.5">
        {/* Area readout */}
        <div className="flex items-center gap-1.5 border-r border-[var(--color-border)] pr-2">
          <span aria-hidden className="text-base text-blue-300">
            ✦
          </span>
          <div className="flex flex-col leading-tight">
            <span className="text-[var(--color-fg-dim)]">Selection</span>
            <span className="font-mono text-[10px] text-[var(--color-fg)]">
              {area.toLocaleString()} px
            </span>
          </div>
        </div>

        {/* Primary apply ops */}
        <ActionButton
          onClick={onApplyAdd}
          primary
          label={labels.add}
          shortcut="↵"
          title="Apply with the 'add' op (Enter)"
        />
        <ActionButton
          onClick={onApplyRemove}
          label={labels.remove}
          shortcut="⇧↵"
          title="Apply with the 'remove' op (Shift+Enter)"
        />

        <Divider />

        {/* Refine ops */}
        <ActionButton
          onClick={onInvert}
          label="Invert"
          shortcut="⇧I"
          title="Invert selection within layer footprint"
        />
        <ActionButton
          onClick={onGrow}
          label="Grow"
          shortcut="⇧G"
          title="Expand selection by 1 px (morphological dilate)"
        />
        <ActionButton
          onClick={onShrink}
          label="Shrink"
          shortcut="⇧S"
          title="Contract selection by 1 px (morphological erode)"
        />
        <ActionButton
          onClick={onFeather}
          label="Feather"
          shortcut="⇧F"
          title="Soften edges by 2 px Gaussian blur"
        />

        {studioMode === "split" && onSaveAsRegion && (
          <>
            <Divider />
            <ActionButton
              onClick={onSaveAsRegion}
              label="Save as Region"
              shortcut="⇧R"
              title="Promote selection to a named region"
            />
          </>
        )}

        <Divider />

        <ActionButton
          onClick={onDeselect}
          label="Deselect"
          shortcut="Esc"
          variant="ghost"
          title="Clear selection (Esc)"
        />
      </div>
    </div>
  );
}

function ActionButton({
  onClick,
  label,
  shortcut,
  title,
  primary = false,
  variant,
}: {
  onClick: () => void;
  label: string;
  shortcut: string;
  title: string;
  primary?: boolean;
  variant?: "ghost";
}) {
  const base = "flex items-center gap-1 rounded border px-1.5 py-0.5 transition-colors";
  const palette =
    variant === "ghost"
      ? "border-transparent text-[var(--color-fg-dim)] hover:border-[var(--color-border)] hover:text-[var(--color-fg)]"
      : primary
        ? "border-blue-400/60 bg-blue-500/10 text-blue-200 hover:bg-blue-500/20"
        : "border-[var(--color-border)] text-[var(--color-fg-dim)] hover:border-[var(--color-fg-dim)] hover:text-[var(--color-fg)]";
  return (
    <button type="button" onClick={onClick} title={title} className={`${base} ${palette}`}>
      <span>{label}</span>
      <span className="font-mono text-[9px] opacity-70">{shortcut}</span>
    </button>
  );
}

function Divider() {
  return <div className="mx-0.5 h-4 w-px bg-[var(--color-border)]" />;
}
