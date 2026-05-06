"use client";

import { selectAnimations, useEditorStore } from "@/lib/store/editor";

type Props = {
  /** Called when an animation chip is clicked. Caller updates the store
   *  + tells the adapter to play. */
  onPlayAnimation: (name: string) => void;
};

/**
 * Top of the right panel — animation selector. Color sliders / blend
 * controls land in 1.4b once color overrides are wired into the store.
 */
export function ToolsPanel({ onPlayAnimation }: Props) {
  const animations = useEditorStore(selectAnimations);
  const active = useEditorStore((s) => s.playingAnimation);

  if (animations.length === 0) return null;

  return (
    <div className="shrink-0 border-b border-[var(--color-border)] px-4 py-3">
      <div className="mb-2 text-xs uppercase tracking-widest text-[var(--color-fg-dim)]">
        Animations
      </div>
      <div className="flex flex-wrap gap-1">
        {animations.map((a) => {
          const isActive = a.name === active;
          return (
            <button
              key={a.name}
              type="button"
              onClick={() => onPlayAnimation(a.name)}
              className={`rounded border px-2 py-1 text-xs transition-colors ${
                isActive
                  ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                  : "border-[var(--color-border)] text-[var(--color-fg-dim)] hover:border-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
              }`}
            >
              {a.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
