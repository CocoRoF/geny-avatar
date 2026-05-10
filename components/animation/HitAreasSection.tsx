"use client";

import { useState } from "react";
import type { Live2DAdapter } from "@/lib/adapters/Live2DAdapter";
import type { CubismMeta } from "@/lib/avatar/cubismMeta";

/** One mapping entry: which motion fires when the user taps this hit
 *  area. Both group + index because Geny's tapMotions uses both. */
export type TapMotion = { group: string; index: number };

/** Map of hit-area name → tap motion choice. Mirrors the schemaVersion
 *  2 export shape (Phase 8.8) — Geny's tapMotions has a slightly more
 *  nested format ({ [group]: index }) but we hold flat for the UI and
 *  flatten at export time. */
export type TapMotions = Record<string, TapMotion>;

type Props = {
  adapter: Live2DAdapter;
  meta: CubismMeta;
  initial?: TapMotions;
  onChange?: (next: TapMotions) => void;
};

/**
 * Phase 8.6 — Hit areas → tap motion mapping.
 *
 * Renders one row per HitArea defined in model3.json. Each row's
 * dropdown is the cross product of motion groups × entries plus a
 * "(none)" sentinel that removes the mapping. Selecting an option
 * also triggers the motion as a preview so the user immediately
 * sees what taping that area in Geny will do.
 *
 * When the puppet has no HitAreas (Hiyori / ellen_joe / etc.) the
 * caller renders nothing — see AnimationPanel's gate.
 */
export function HitAreasSection({ adapter, meta, initial, onChange }: Props) {
  const [mapping, setMapping] = useState<TapMotions>(initial ?? {});

  // Flat list of "<group>::<index>" choices for the dropdowns. Encoded
  // as a single string so we can use a native <select> without nested
  // <optgroup> + value-deserialization gymnastics.
  const choices: { value: string; label: string; group: string; index: number }[] = [];
  for (const g of meta.motionGroups) {
    for (const e of g.entries) {
      const label = `${g.name} · ${basename(e.file)}`;
      choices.push({ value: `${g.name}::${e.index}`, label, group: g.name, index: e.index });
    }
  }

  function pickFor(hitAreaName: string, encoded: string) {
    setMapping((prev) => {
      const next: TapMotions = { ...prev };
      if (encoded === "") {
        delete next[hitAreaName];
      } else {
        const sep = encoded.indexOf("::");
        const group = encoded.slice(0, sep);
        const index = Number(encoded.slice(sep + 2));
        next[hitAreaName] = { group, index };
        // Auto-preview so the user feels the assignment immediately.
        adapter.playMotion(group, index);
      }
      onChange?.(next);
      return next;
    });
  }

  return (
    <section className="rounded border border-[var(--color-border)] bg-[var(--color-panel)] p-3">
      <h3 className="mb-2 text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
        hit areas ({meta.hitAreas.length})
      </h3>

      {meta.motionGroups.length === 0 ? (
        <p className="text-[11px] opacity-60">
          motion 그룹이 없어 hit area 매핑을 만들 수 없습니다.
        </p>
      ) : (
        <ul className="space-y-1">
          {meta.hitAreas.map((h) => {
            const current = mapping[h.name];
            const value = current ? `${current.group}::${current.index}` : "";
            return (
              <li key={h.name} className="flex items-center gap-2 text-[10px]">
                <span className="w-24 truncate font-mono text-[var(--color-fg-dim)]" title={h.name}>
                  {h.name}
                </span>
                <span className="text-[var(--color-fg-dim)]">→</span>
                <select
                  value={value}
                  onChange={(e) => pickFor(h.name, e.target.value)}
                  aria-label={`tap motion for ${h.name}`}
                  className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1.5 py-0.5 font-mono text-[10px]"
                >
                  <option value="">(none)</option>
                  {choices.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function basename(path: string): string {
  const ix = path.lastIndexOf("/");
  return ix >= 0 ? path.slice(ix + 1) : path;
}
