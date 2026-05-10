"use client";

import { useState } from "react";
import type { Live2DAdapter } from "@/lib/adapters/Live2DAdapter";
import type { CubismMeta } from "@/lib/avatar/cubismMeta";

type Props = {
  adapter: Live2DAdapter;
  meta: CubismMeta;
};

/**
 * Phase 8.4 — Motions section. Lists every motion group from
 * model3.json with each entry's filename + duration metadata, and a
 * ▶ button per entry that triggers `adapter.playMotion(group, index)`
 * with PRIORITY_FORCE so consecutive taps cancel the prior motion.
 *
 * The rightmost cell of each entry shows whether playback was just
 * triggered ("playing") — purely visual feedback, the engine doesn't
 * give us a clean "ended" signal so the chip auto-clears after a
 * fixed timeout (longer than typical motion length).
 */
export function MotionsSection({ adapter, meta }: Props) {
  // Set of "<group>:<index>" strings that recently triggered. We
  // can't introspect the engine's playback state, so we just clear
  // each tag a few seconds after the click.
  const [recentlyPlaying, setRecentlyPlaying] = useState<Set<string>>(new Set());

  function handlePlay(group: string, index: number) {
    const tag = `${group}:${index}`;
    const ok = adapter.playMotion(group, index);
    if (!ok) return;
    setRecentlyPlaying((prev) => {
      const next = new Set(prev);
      next.add(tag);
      return next;
    });
    // Visual flash duration. Real motions are usually 1–5s; 4s covers
    // the common case without hanging "playing" forever on long ones.
    window.setTimeout(() => {
      setRecentlyPlaying((prev) => {
        if (!prev.has(tag)) return prev;
        const next = new Set(prev);
        next.delete(tag);
        return next;
      });
    }, 4000);
  }

  return (
    <section className="rounded border border-[var(--color-border)] bg-[var(--color-panel)] p-3">
      <h3 className="mb-2 text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
        motions ({meta.motionGroups.length} groups,{" "}
        {meta.motionGroups.reduce((s, g) => s + g.entries.length, 0)} entries)
      </h3>

      {meta.motionGroups.length === 0 ? (
        <p className="text-[11px] text-[var(--color-fg-dim)] opacity-60">
          이 puppet 은 motion 이 정의되어 있지 않습니다.
        </p>
      ) : (
        <ul className="space-y-2">
          {meta.motionGroups.map((g) => (
            <li key={g.name}>
              <div className="mb-1 font-mono text-[11px] text-[var(--color-accent)]">
                {g.name}
                <span className="ml-2 text-[10px] text-[var(--color-fg-dim)] opacity-60">
                  {g.entries.length} entries
                </span>
              </div>
              <ul className="space-y-0.5 pl-2">
                {g.entries.map((e) => {
                  const tag = `${g.name}:${e.index}`;
                  const playing = recentlyPlaying.has(tag);
                  return (
                    <li
                      key={tag}
                      className="flex items-center gap-2 rounded px-1.5 py-0.5 text-[10px] hover:bg-[var(--color-bg)]"
                    >
                      <button
                        type="button"
                        onClick={() => handlePlay(g.name, e.index)}
                        className={`rounded border px-1.5 leading-tight ${
                          playing
                            ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                            : "border-[var(--color-border)] text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
                        }`}
                        title={`재생: ${g.name}[${e.index}]`}
                        aria-label={`play ${g.name} ${e.index}`}
                      >
                        ▶
                      </button>
                      <span
                        className="flex-1 truncate font-mono text-[var(--color-fg-dim)]"
                        title={e.file}
                      >
                        {basename(e.file)}
                      </span>
                      {playing && (
                        <span className="font-mono text-[9px] text-[var(--color-accent)]">
                          playing
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function basename(path: string): string {
  const ix = path.lastIndexOf("/");
  return ix >= 0 ? path.slice(ix + 1) : path;
}
