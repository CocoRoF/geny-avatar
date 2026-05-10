"use client";

import { useState } from "react";
import type { Live2DAdapter } from "@/lib/adapters/Live2DAdapter";
import type { CubismMeta } from "@/lib/avatar/cubismMeta";

/** Standard Geny / GoEmotions emotion keys. The same set every entry
 *  in `backend/static/live2d-models/model_registry.json` uses, so the
 *  exported `emotionMap` (Phase 8.8) drops straight into Geny's
 *  Live2dModelInfo without translation friction. */
export const EMOTION_KEYS = [
  "neutral",
  "joy",
  "anger",
  "disgust",
  "fear",
  "sadness",
  "surprise",
  "smirk",
] as const;

export type EmotionKey = (typeof EMOTION_KEYS)[number];
/** Mapping is by expression NAME, not index — names are stable across
 *  model edits. The export builder (8.8) translates name → index when
 *  writing the avatar-editor.json schemaVersion 2 payload. */
export type EmotionMap = Partial<Record<EmotionKey, string>>;

type Props = {
  adapter: Live2DAdapter;
  meta: CubismMeta;
  /** Initial value (from IDB once 8.7 lands; for 8.5 starts empty
   *  on every mount). */
  initial?: EmotionMap;
  /** Notified on every dropdown change so a parent / IDB can persist. */
  onChange?: (map: EmotionMap) => void;
};

/**
 * Phase 8.5 — Expressions section + emotion mapping.
 *
 * Top half: list of expressions with ▶ preview buttons. Click sets
 * the expression on the live model, click "clear" to reset.
 *
 * Bottom half: 8-row table mapping each Geny emotion to a chosen
 * expression NAME. The dropdown's options are this puppet's
 * expressions plus an explicit "(none)" sentinel that removes the
 * mapping. Selecting an option also auto-previews so the user sees
 * the joy/anger/sadness candidate immediately.
 */
export function ExpressionsSection({ adapter, meta, initial, onChange }: Props) {
  const [emotionMap, setEmotionMap] = useState<EmotionMap>(initial ?? {});
  const [activeName, setActiveName] = useState<string | null>(null);

  function preview(name: string | null) {
    adapter.setExpression(name);
    setActiveName(name);
  }

  function setEmotion(emotion: EmotionKey, name: string) {
    setEmotionMap((prev) => {
      const next: EmotionMap = { ...prev };
      if (name === "") delete next[emotion];
      else next[emotion] = name;
      onChange?.(next);
      return next;
    });
    if (name) preview(name);
  }

  // Reverse index: expression name → list of emotion keys assigned to it.
  // Surfaced beside each expression so the user can see at a glance
  // which emotions currently route here.
  const reverseMap: Record<string, EmotionKey[]> = {};
  for (const [emo, name] of Object.entries(emotionMap)) {
    if (!name) continue;
    if (!reverseMap[name]) reverseMap[name] = [];
    reverseMap[name].push(emo as EmotionKey);
  }

  return (
    <section className="rounded border border-[var(--color-border)] bg-[var(--color-panel)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
          expressions ({meta.expressions.length})
        </h3>
        {activeName !== null && (
          <button
            type="button"
            onClick={() => preview(null)}
            className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
            title="default 표정으로 복귀"
          >
            clear
          </button>
        )}
      </div>

      {meta.expressions.length === 0 ? (
        <p className="text-[11px] opacity-60">이 puppet 은 expression 이 정의되어 있지 않습니다.</p>
      ) : (
        <ul className="space-y-0.5">
          {meta.expressions.map((e) => {
            const assignedEmotions = reverseMap[e.name] ?? [];
            const isActive = activeName === e.name;
            return (
              <li
                key={e.name}
                className="flex items-center gap-2 rounded px-1.5 py-0.5 text-[10px] hover:bg-[var(--color-bg)]"
              >
                <button
                  type="button"
                  onClick={() => preview(e.name)}
                  className={`rounded border px-1.5 leading-tight ${
                    isActive
                      ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                      : "border-[var(--color-border)] text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
                  }`}
                  title={`미리보기: ${e.name}`}
                  aria-label={`preview ${e.name}`}
                >
                  ▶
                </button>
                <span className="font-mono text-[var(--color-fg)]">{e.name}</span>
                {assignedEmotions.length > 0 && (
                  <span className="ml-auto font-mono text-[9px] text-[var(--color-fg-dim)] opacity-70">
                    {assignedEmotions.join(" · ")}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {meta.expressions.length > 0 && (
        <div className="mt-3 border-t border-[var(--color-border)] pt-3">
          <h4 className="mb-2 text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
            emotion → expression
          </h4>
          <ul className="space-y-1">
            {EMOTION_KEYS.map((emo) => {
              const value = emotionMap[emo] ?? "";
              return (
                <li key={emo} className="flex items-center gap-2 text-[10px]">
                  <span className="w-16 font-mono text-[var(--color-fg-dim)]">{emo}</span>
                  <span className="text-[var(--color-fg-dim)]">→</span>
                  <select
                    value={value}
                    onChange={(ev) => setEmotion(emo, ev.target.value)}
                    aria-label={`expression for ${emo}`}
                    className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1.5 py-0.5 font-mono text-[10px]"
                  >
                    <option value="">(none)</option>
                    {meta.expressions.map((e) => (
                      <option key={e.name} value={e.name}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
