"use client";

import type { ToolDef, ToolId } from "@/lib/avatar/decompose/tools";
import { TOOLS } from "@/lib/avatar/decompose/tools";

/**
 * Left vertical toolbox — one button per Photoshop-style tool. The
 * SAM tool is hidden in trim mode (it only operates on regions).
 *
 * The component is intentionally presentational: it takes the
 * currently-selected tool ID + a setter, plus the studioMode flag
 * for the `splitOnly` filter, and renders a stack of buttons. The
 * actual key bindings live in DecomposeStudio's effect — the
 * `shortcut` field here is purely the rendered hint chip.
 */
export interface ToolboxProps {
  selectedTool: ToolId;
  onSelectTool: (id: ToolId) => void;
  studioMode: "trim" | "split";
  className?: string;
}

export function Toolbox({ selectedTool, onSelectTool, studioMode, className = "" }: ToolboxProps) {
  const visible = TOOLS.filter((t) => !t.splitOnly || studioMode === "split");
  return (
    <div
      className={`flex w-12 shrink-0 flex-col gap-0.5 border-r border-[var(--color-border)] bg-[var(--color-panel)] py-2 ${className}`}
    >
      {visible.map((tool) => (
        <ToolButton
          key={tool.id}
          tool={tool}
          selected={selectedTool === tool.id}
          onClick={() => onSelectTool(tool.id)}
        />
      ))}
    </div>
  );
}

function ToolButton({
  tool,
  selected,
  onClick,
}: {
  tool: ToolDef;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${tool.label} (${tool.shortcut}) — ${tool.tooltip}`}
      className={`group relative mx-1 flex h-9 items-center justify-center rounded text-[10px] font-medium transition-colors ${
        selected
          ? "bg-[var(--color-accent)]/15 text-[var(--color-accent)] ring-1 ring-[var(--color-accent)]"
          : "text-[var(--color-fg-dim)] hover:bg-[var(--color-bg)] hover:text-[var(--color-fg)]"
      }`}
    >
      <ToolIcon id={tool.id} className="h-4 w-4" />
      <span
        className={`absolute bottom-0.5 right-0.5 font-mono text-[8px] leading-none ${
          selected ? "text-[var(--color-accent)]/80" : "text-[var(--color-fg-dim)]"
        }`}
      >
        {tool.shortcut}
      </span>
    </button>
  );
}

/**
 * Inline SVG icons. Lightweight + no extra dep; each ~ a dozen
 * lines. Drawing convention: 24×24 viewBox, 1.5px stroke, currentColor.
 */
function ToolIcon({ id, className = "" }: { id: ToolId; className?: string }) {
  switch (id) {
    case "move":
      return (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className={className}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M19 9l3 3-3 3M9 19l3 3 3-3M2 12h20M12 2v20" />
        </svg>
      );
    case "brush":
      return (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className={className}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9.06 11.9l8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.07" />
          <path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z" />
        </svg>
      );
    case "eraser":
      return (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className={className}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M16.24 3.56l4.95 4.94c.78.79.78 2.05 0 2.84L12 20.53a4.008 4.008 0 0 1-5.66 0L2.81 17a2.92 2.92 0 0 1-.13-3.83l9.86-9.84a2 2 0 0 1 2.83 0l.87.23z" />
          <path d="M22 21H7M5 11l9 9" />
        </svg>
      );
    case "bucket":
      return (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className={className}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5.7 7.3l8.49-8.49 8.49 8.49-8.49 8.49z" transform="translate(-2 4)" />
          <path d="M5 2L2 5l7 7" />
          <path d="M2 13.5V22h20v-8.5" />
          <circle cx="19" cy="18" r="2" />
        </svg>
      );
    case "wand":
      return (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className={className}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M15 9h0M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5" />
        </svg>
      );
    case "zoom":
      return (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className={className}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35M8 11h6M11 8v6" />
        </svg>
      );
    case "hand":
      return (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className={className}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 11V6a2 2 0 0 0-4 0v5" />
          <path d="M14 10V4a2 2 0 0 0-4 0v6" />
          <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
          <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
        </svg>
      );
    case "sam":
      return (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className={className}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
  }
}
