"use client";

import { useMemo, useState } from "react";
import type { MorphCatalogEntry } from "@/lib/adapters/AvatarAdapter";
import type { MmdAdapter } from "@/lib/adapters/MmdAdapter";
import type { AnimationConfigValue } from "@/lib/avatar/usePuppetAnimationConfig";
import { selectAnimations, useEditorStore } from "@/lib/store/editor";
import { EMOTION_KEYS, type EmotionKey } from "./ExpressionsSection";

/**
 * Animation-tab sections for the MMD runtime. The Cubism sections don't
 * apply (no motion groups / expressions / hit areas / kScale) — MMD's
 * equivalents are morphs, bundled VMD motions, and a 3D camera pose:
 *
 *   - Motions   — bundled .vmd files, ▶ play / ⏹ stop
 *   - Morphs    — weight sliders grouped by the PMX panel byte
 *   - Emotions  — GoEmotion key → morph NAME map (same emotionMap field
 *                 the Cubism section writes; Geny interprets it per
 *                 runtime) + lip-sync morph override
 *   - Camera    — capture the current orbit pose as the default view
 *                 Geny renders the model with
 */

type PanelProps = {
  adapter: MmdAdapter;
  config: AnimationConfigValue;
  onEmotionMapChange: (map: Partial<Record<EmotionKey, string>>) => void;
  onLipSyncMorphChange: (morph: string | undefined) => void;
  onCameraChange: (pose: AnimationConfigValue["mmdCamera"]) => void;
};

const PANEL_LABEL: Record<MorphCatalogEntry["panel"], string> = {
  mouth: "입",
  eye: "눈",
  brow: "눈썹",
  other: "기타",
};
const PANEL_ORDER: MorphCatalogEntry["panel"][] = ["mouth", "eye", "brow", "other"];

export function MmdSectionsPanel({
  adapter,
  config,
  onEmotionMapChange,
  onLipSyncMorphChange,
  onCameraChange,
}: PanelProps) {
  const morphs = useMemo(() => adapter.getMorphCatalog(), [adapter]);
  return (
    <div className="flex flex-col gap-4">
      <MmdMotionsSection adapter={adapter} />
      <MmdEmotionSection
        adapter={adapter}
        morphs={morphs}
        initial={(config.emotionMap ?? {}) as Partial<Record<EmotionKey, string>>}
        initialLipSync={config.lipSyncMorph}
        onChange={onEmotionMapChange}
        onLipSyncChange={onLipSyncMorphChange}
      />
      <MmdCameraSection adapter={adapter} saved={config.mmdCamera} onChange={onCameraChange} />
      <MmdMorphsSection adapter={adapter} morphs={morphs} />
    </div>
  );
}

// ----- motions -----

function MmdMotionsSection({ adapter }: { adapter: MmdAdapter }) {
  const animations = useEditorStore(selectAnimations);
  const [playing, setPlaying] = useState<string | null>(null);
  if (animations.length === 0) return null;
  return (
    <section>
      <h3 className="mb-2 text-[10px] uppercase tracking-widest">Motions (VMD)</h3>
      <div className="flex flex-wrap gap-1">
        {animations.map((a) => (
          <button
            key={a.name}
            type="button"
            onClick={() => {
              adapter.playAnimation(a.name);
              setPlaying(a.name);
            }}
            className={`rounded border px-2 py-1 text-xs ${
              playing === a.name
                ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                : "border-[var(--color-border)] text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
            }`}
          >
            ▶ {a.name}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            adapter.stopAnimation();
            setPlaying(null);
          }}
          className="rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
        >
          ⏹ 정지 (idle 복귀)
        </button>
      </div>
    </section>
  );
}

// ----- emotions + lip-sync -----

type EmotionSectionProps = {
  adapter: MmdAdapter;
  morphs: MorphCatalogEntry[];
  initial: Partial<Record<EmotionKey, string>>;
  initialLipSync: string | undefined;
  onChange: (map: Partial<Record<EmotionKey, string>>) => void;
  onLipSyncChange: (morph: string | undefined) => void;
};

function MmdEmotionSection({
  adapter,
  morphs,
  initial,
  initialLipSync,
  onChange,
  onLipSyncChange,
}: EmotionSectionProps) {
  const [emotionMap, setEmotionMap] = useState(initial);
  const [lipSync, setLipSync] = useState(initialLipSync ?? "");
  const [previewMorph, setPreviewMorph] = useState<string | null>(null);

  const mouthMorphs = morphs.filter((m) => m.panel === "mouth");

  function preview(name: string | null) {
    if (previewMorph && previewMorph !== name) adapter.setParameter(`morph:${previewMorph}`, 0);
    if (name) adapter.setParameter(`morph:${name}`, 1);
    setPreviewMorph(name);
  }

  function setEmotion(emotion: EmotionKey, name: string) {
    setEmotionMap((prev) => {
      const next = { ...prev };
      if (name === "") delete next[emotion];
      else next[emotion] = name;
      onChange(next);
      return next;
    });
    preview(name === "" ? null : name);
  }

  return (
    <section>
      <h3 className="mb-2 text-[10px] uppercase tracking-widest">Emotion map</h3>
      <p className="mb-2 text-[10px] opacity-60">
        Geny 감정 → 모프 매핑. 선택 시 즉시 미리보기됩니다 (다시 &quot;(없음)&quot; 선택으로 해제).
      </p>
      <table className="w-full text-xs">
        <tbody>
          {EMOTION_KEYS.map((emo) => (
            <tr key={emo}>
              <td className="py-0.5 pr-2 font-mono text-[10px] text-[var(--color-fg-dim)]">
                {emo}
              </td>
              <td>
                <select
                  value={emotionMap[emo] ?? ""}
                  onChange={(e) => setEmotion(emo, e.target.value)}
                  className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-0.5 text-xs"
                >
                  <option value="">(없음)</option>
                  {morphs.map((m) => (
                    <option key={m.name} value={m.name}>
                      [{PANEL_LABEL[m.panel]}] {m.name}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
          <tr>
            <td
              className="py-0.5 pr-2 font-mono text-[10px] text-[var(--color-fg-dim)]"
              title="TTS 음성 볼륨을 이 모프에 실어 입을 움직입니다. (자동)은 「あ」 계열을 찾습니다."
            >
              lip-sync
            </td>
            <td>
              <select
                value={lipSync}
                onChange={(e) => {
                  setLipSync(e.target.value);
                  onLipSyncChange(e.target.value === "" ? undefined : e.target.value);
                }}
                className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-0.5 text-xs"
              >
                <option value="">(자동 — あ 계열)</option>
                {mouthMorphs.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}
                  </option>
                ))}
              </select>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

// ----- camera -----

type CameraSectionProps = {
  adapter: MmdAdapter;
  saved: AnimationConfigValue["mmdCamera"];
  onChange: (pose: AnimationConfigValue["mmdCamera"]) => void;
};

function MmdCameraSection({ adapter, saved, onChange }: CameraSectionProps) {
  const [stored, setStored] = useState(saved);
  return (
    <section>
      <h3 className="mb-2 text-[10px] uppercase tracking-widest">Camera</h3>
      <p className="mb-2 text-[10px] opacity-60">
        캔버스에서 드래그(회전) / 휠(줌) / 우클릭 드래그(이동)로 구도를 잡고 저장하세요. 저장된
        구도가 Geny 라이브 아바타의 기본 뷰가 됩니다.
      </p>
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          onClick={() => {
            const pose = adapter.getCameraPose();
            if (pose) {
              setStored(pose);
              onChange(pose);
            }
          }}
          className="rounded border border-[var(--color-accent)]/60 px-2 py-1 text-xs text-[var(--color-accent)]"
        >
          현재 구도를 기본 뷰로 저장
        </button>
        <button
          type="button"
          disabled={!stored}
          onClick={() => stored && adapter.applyCameraPose(stored)}
          className="rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-fg-dim)] hover:text-[var(--color-fg)] disabled:opacity-40"
        >
          저장된 뷰 보기
        </button>
        <button
          type="button"
          onClick={() => adapter.resetCamera()}
          className="rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
        >
          자동 구도로 리셋
        </button>
      </div>
      {stored && (
        <p className="mt-1 font-mono text-[10px] opacity-50">
          saved: r={stored.radius.toFixed(1)} · target=({stored.targetX.toFixed(1)},{" "}
          {stored.targetY.toFixed(1)}, {stored.targetZ.toFixed(1)})
        </p>
      )}
    </section>
  );
}

// ----- morph sliders -----

function MmdMorphsSection({
  adapter,
  morphs,
}: {
  adapter: MmdAdapter;
  morphs: MorphCatalogEntry[];
}) {
  // Local weight state — the adapter is the source of truth for the
  // render; this map only drives the slider positions.
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [openPanel, setOpenPanel] = useState<MorphCatalogEntry["panel"] | null>("mouth");

  const grouped = useMemo(() => {
    const g = new Map<MorphCatalogEntry["panel"], MorphCatalogEntry[]>();
    for (const p of PANEL_ORDER) g.set(p, []);
    for (const m of morphs) g.get(m.panel)?.push(m);
    return g;
  }, [morphs]);

  function setWeight(name: string, w: number) {
    adapter.setParameter(`morph:${name}`, w);
    setWeights((prev) => ({ ...prev, [name]: w }));
  }

  function resetAll() {
    for (const [name, w] of Object.entries(weights)) {
      if (w !== 0) adapter.setParameter(`morph:${name}`, 0);
    }
    setWeights({});
  }

  if (morphs.length === 0) return null;

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[10px] uppercase tracking-widest">Morphs ({morphs.length})</h3>
        <button
          type="button"
          onClick={resetAll}
          className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
        >
          모두 0
        </button>
      </div>
      {PANEL_ORDER.map((panel) => {
        const list = grouped.get(panel) ?? [];
        if (list.length === 0) return null;
        const open = openPanel === panel;
        return (
          <div key={panel} className="mb-1">
            <button
              type="button"
              onClick={() => setOpenPanel(open ? null : panel)}
              className="w-full rounded border border-[var(--color-border)] px-2 py-1 text-left text-xs text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
            >
              {open ? "▾" : "▸"} {PANEL_LABEL[panel]} ({list.length})
            </button>
            {open && (
              <div className="mt-1 flex flex-col gap-1 pl-1">
                {list.map((m) => (
                  <label key={m.name} className="flex items-center gap-2 text-xs">
                    <span className="w-28 shrink-0 truncate" title={m.name}>
                      {m.name}
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={weights[m.name] ?? 0}
                      onChange={(e) => setWeight(m.name, Number(e.target.value))}
                      className="min-w-0 flex-1"
                    />
                    <span className="w-8 shrink-0 text-right font-mono text-[10px]">
                      {(weights[m.name] ?? 0).toFixed(2)}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
