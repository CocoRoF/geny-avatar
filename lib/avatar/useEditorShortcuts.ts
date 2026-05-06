"use client";

import { useEffect } from "react";

type Handlers = {
  undo?: () => void;
  redo?: () => void;
  reset?: () => void;
};

/**
 * Editor-wide keyboard shortcuts. Skips when focus is on a text input /
 * textarea / contenteditable so search boxes and other text fields keep
 * working as users expect.
 *
 *   Cmd/Ctrl+Z         — undo
 *   Cmd/Ctrl+Shift+Z   — redo (also Cmd/Ctrl+Y)
 *   r                  — reset overrides
 */
export function useEditorShortcuts({ undo, redo, reset }: Handlers) {
  useEffect(() => {
    function onKeyDown(ev: KeyboardEvent) {
      // ignore when typing into a text field
      const target = ev.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
      }

      const mod = ev.metaKey || ev.ctrlKey;

      if (mod && ev.key.toLowerCase() === "z") {
        ev.preventDefault();
        if (ev.shiftKey) redo?.();
        else undo?.();
        return;
      }
      if (mod && ev.key.toLowerCase() === "y") {
        ev.preventDefault();
        redo?.();
        return;
      }
      if (!mod && ev.key.toLowerCase() === "r") {
        ev.preventDefault();
        reset?.();
        return;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo, reset]);
}
