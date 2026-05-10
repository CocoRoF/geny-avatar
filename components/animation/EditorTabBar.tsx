"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

export type EditorTab = "edit" | "animation";

const TABS: { id: EditorTab; label: string; title: string }[] = [
  { id: "edit", label: "Edit", title: "텍스처 편집 — 레이어 / decompose / generate" },
  { id: "animation", label: "Animation", title: "애니메이션 — motion / expression / emotion 매핑" },
];

/**
 * Reads the active editor tab from the `?tab=` query string. Falls
 * back to `edit` so existing bookmarks (no query param) keep their
 * behavior. Centralized so the two editor pages
 * (`/edit/[avatarId]` + `/edit/builtin/[key]`) and any animation-tab
 * children can read the same value without redundant URL parsing.
 */
export function useEditorTab(): EditorTab {
  const params = useSearchParams();
  const raw = params.get("tab");
  return raw === "animation" ? "animation" : "edit";
}

/**
 * Header chip pair that switches between the Edit and Animation tabs.
 * State lives in the URL (`?tab=animation`) so the choice survives
 * refresh + can be linked.
 *
 * Phase 8.1 of the editor animation tab plan
 * (docs/plan/09_editor_animation_tab.md). Subsequent sprints fill out
 * the Animation panel; this sprint only adds the switcher + a stub.
 */
export function EditorTabBar({ className = "" }: { className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const active = useEditorTab();

  const switchTo = useCallback(
    (tab: EditorTab) => {
      const next = new URLSearchParams(params.toString());
      if (tab === "edit") {
        next.delete("tab");
      } else {
        next.set("tab", tab);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname, params],
  );

  return (
    <span
      className={`inline-flex overflow-hidden rounded border border-[var(--color-border)] ${className}`}
    >
      {TABS.map((t) => {
        const selected = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => switchTo(t.id)}
            title={t.title}
            className={`px-2 py-0.5 text-xs ${
              selected
                ? "bg-[var(--color-accent)] text-[var(--color-bg)]"
                : "text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </span>
  );
}
