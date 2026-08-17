"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MmdAdapter } from "@/lib/adapters/MmdAdapter";
import { fetchPresetFile, type MotionPreset } from "@/lib/mmd/motionPresets";
import { type MotionEditParams, NEUTRAL_EDIT, transformVmd } from "@/lib/mmd/vmdTransform";
import { addPuppetFiles, type PuppetId } from "@/lib/persistence/db";

/**
 * Motion Studio — in-app motion editor. Pick any motion (built-in
 * preset or an uploaded/saved VMD), shape it with parametric sliders
 * (speed · amplitude overall / arms / head / torso · facial intensity),
 * hear-see it live on the model, and save the result as a NEW motion
 * that rides the normal pipeline (persist → export zip → Geny sync →
 * idle designation). Edits scale each track's deviation from its first
 * keyframe, so the base stance never deforms — see vmdTransform.ts.
 */

const PREVIEW_NAME = " studio-preview"; // thin-space prefix — never collides with a user stem

type SourceRef = { kind: "preset"; preset: MotionPreset } | { kind: "motion"; name: string };

type Props = {
  adapter: MmdAdapter;
  puppetKey: string | null;
  presets: MotionPreset[];
  /** persisted/uploaded motion stems (the studio can edit those too) */
  motions: string[];
  /** a saved studio motion enters the regular motion list */
  onSaved: (stem: string) => void;
};

type SliderSpec = {
  key: keyof MotionEditParams;
  label: string;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
};
const SLIDERS: SliderSpec[] = [
  {
    key: "speed",
    label: "속도",
    min: 0.5,
    max: 1.8,
    step: 0.05,
    format: (v) => `${v.toFixed(2)}×`,
  },
  {
    key: "overall",
    label: "전체 크기",
    min: 0.3,
    max: 1.6,
    step: 0.05,
    format: (v) => `${Math.round(v * 100)}%`,
  },
  {
    key: "arms",
    label: "팔",
    min: 0,
    max: 1.5,
    step: 0.05,
    format: (v) => `${Math.round(v * 100)}%`,
  },
  {
    key: "head",
    label: "머리",
    min: 0,
    max: 1.5,
    step: 0.05,
    format: (v) => `${Math.round(v * 100)}%`,
  },
  {
    key: "torso",
    label: "몸통",
    min: 0,
    max: 1.5,
    step: 0.05,
    format: (v) => `${Math.round(v * 100)}%`,
  },
  {
    key: "face",
    label: "표정 강도",
    min: 0,
    max: 1.3,
    step: 0.05,
    format: (v) => `${Math.round(v * 100)}%`,
  },
];

export function MotionStudioSection({ adapter, puppetKey, presets, motions, onSaved }: Props) {
  const [sourceKey, setSourceKey] = useState<string>("");
  const [params, setParams] = useState<MotionEditParams>(NEUTRAL_EDIT);
  const [saveName, setSaveName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(0);
  // source bytes cache — sliders re-transform without re-fetching
  const sourceBytesRef = useRef<Uint8Array | null>(null);
  const sourceKeyRef = useRef<string>("");
  const previewTimer = useRef<number | null>(null);

  const sources: { key: string; label: string; ref: SourceRef }[] = useMemo(() => {
    const p = presets.map((preset) => ({
      key: `preset:${preset.id}`,
      label: `${preset.label} (내장)`,
      ref: { kind: "preset", preset } as SourceRef,
    }));
    const m = motions.map((name) => ({
      key: `motion:${name}`,
      label: name,
      ref: { kind: "motion", name } as SourceRef,
    }));
    return [...p, ...m];
  }, [presets, motions]);

  const source = sources.find((s) => s.key === sourceKey) ?? null;
  const dirty = useMemo(
    () =>
      (Object.keys(NEUTRAL_EDIT) as (keyof MotionEditParams)[]).some(
        (k) => params[k] !== NEUTRAL_EDIT[k],
      ),
    [params],
  );

  useEffect(() => {
    // switching source resets edits and the byte cache
    sourceBytesRef.current = null;
    sourceKeyRef.current = sourceKey;
    setParams(NEUTRAL_EDIT);
    setError(null);
    const s = sources.find((x) => x.key === sourceKey);
    if (s) {
      const base = s.ref.kind === "preset" ? s.ref.preset.id : s.ref.name;
      setSaveName(`${base}-커스텀`);
    }
  }, [sourceKey, sources]);

  async function loadSourceBytes(ref: SourceRef): Promise<Uint8Array> {
    if (sourceBytesRef.current) return sourceBytesRef.current;
    let file: File | null = null;
    if (ref.kind === "preset") file = await fetchPresetFile(ref.preset);
    else file = adapter.getMotionFile(ref.name);
    if (!file) throw new Error("모션 파일을 찾을 수 없습니다");
    const bytes = new Uint8Array(await file.arrayBuffer());
    sourceBytesRef.current = bytes;
    return bytes;
  }

  async function buildFile(name: string): Promise<File> {
    if (!source) throw new Error("모션을 먼저 선택하세요");
    const bytes = await loadSourceBytes(source.ref);
    const out = transformVmd(bytes, params);
    const buf = new ArrayBuffer(out.length);
    new Uint8Array(buf).set(out);
    return new File([buf], `${name}.vmd`, { type: "application/octet-stream" });
  }

  /** live preview — debounced so slider drags don't re-encode per tick */
  function schedulePreview(next: MotionEditParams) {
    setParams(next);
    if (previewTimer.current !== null) window.clearTimeout(previewTimer.current);
    previewTimer.current = window.setTimeout(() => {
      void (async () => {
        try {
          if (!source) return;
          const bytes = await loadSourceBytes(source.ref);
          // guard: source switched while fetching
          if (sourceKeyRef.current !== sourceKey) return;
          const out = transformVmd(bytes, next);
          const buf = new ArrayBuffer(out.length);
          new Uint8Array(buf).set(out);
          const file = new File([buf], "studio-preview.vmd");
          adapter.addMotionFile(PREVIEW_NAME, file);
          adapter.playAnimation(PREVIEW_NAME);
          setError(null);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      })();
    }, 220);
  }

  async function previewNow() {
    schedulePreview(params);
  }

  const canPersist = !!puppetKey && !puppetKey.startsWith("builtin:");

  async function save() {
    const stem = saveName.trim().replace(/\.vmd$/i, "");
    if (!stem) {
      setError("저장할 이름을 입력하세요");
      return;
    }
    if (/[\\/]/.test(stem)) {
      setError("이름에 경로 문자는 쓸 수 없습니다");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const file = await buildFile(stem);
      if (canPersist && puppetKey) {
        await addPuppetFiles(puppetKey as PuppetId, [
          { name: file.name, path: `motions/${file.name}`, size: file.size, blob: file },
        ]);
      }
      adapter.addMotionFile(stem, file);
      onSaved(stem);
      setSavedTick((t) => t + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // leaving the studio (unmount) stops a still-looping preview
  useEffect(() => {
    return () => {
      if (previewTimer.current !== null) window.clearTimeout(previewTimer.current);
      const state = adapter.getMotionState();
      if (state.name === PREVIEW_NAME) adapter.stopAnimation();
    };
  }, [adapter]);

  return (
    <section>
      <h3
        className="mb-2 text-[10px] uppercase tracking-widest"
        title="모션을 골라 속도·크기·표정을 조절해 나만의 모션으로 저장합니다. 저장된 모션은 일반 모션과 똑같이 export/아이들 지정에 쓸 수 있습니다."
      >
        모션 스튜디오
      </h3>
      <div className="flex flex-col gap-2 rounded border border-white/10 bg-white/[0.03] p-2">
        <select
          className="w-full rounded bg-black/30 px-2 py-1 text-xs"
          value={sourceKey}
          onChange={(e) => setSourceKey(e.target.value)}
        >
          <option value="">편집할 모션 선택…</option>
          {sources.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>

        {source && (
          <>
            {SLIDERS.map((spec) => (
              <label key={spec.key} className="flex items-center gap-2 text-[11px]">
                <span className="w-16 shrink-0 opacity-70">{spec.label}</span>
                <input
                  type="range"
                  className="min-w-0 flex-1"
                  min={spec.min}
                  max={spec.max}
                  step={spec.step}
                  value={params[spec.key]}
                  onChange={(e) =>
                    schedulePreview({ ...params, [spec.key]: Number(e.target.value) })
                  }
                />
                <span className="w-12 shrink-0 text-right tabular-nums opacity-80">
                  {spec.format(params[spec.key])}
                </span>
              </label>
            ))}

            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded border border-white/20 px-2 py-1 text-xs hover:bg-white/10"
                onClick={() => void previewNow()}
              >
                ▶ 미리보기
              </button>
              <button
                type="button"
                className="rounded border border-white/20 px-2 py-1 text-xs hover:bg-white/10 disabled:opacity-40"
                disabled={!dirty}
                onClick={() => schedulePreview(NEUTRAL_EDIT)}
              >
                초기화
              </button>
            </div>

            {canPersist && (
              <div className="flex items-center gap-2">
                <input
                  className="min-w-0 flex-1 rounded bg-black/30 px-2 py-1 text-xs"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  placeholder="저장할 모션 이름"
                />
                <button
                  type="button"
                  className="shrink-0 rounded border border-emerald-400/40 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-400/10 disabled:opacity-40"
                  disabled={busy || !saveName.trim()}
                  onClick={() => void save()}
                >
                  {busy ? "저장 중…" : "내 모션으로 저장"}
                </button>
              </div>
            )}
            {savedTick > 0 && !error && (
              <p className="text-[10px] text-emerald-300/80">
                저장됨 — 모션 목록에서 재생·아이들 지정할 수 있습니다.
              </p>
            )}
          </>
        )}
        {error && <p className="text-[10px] text-red-300">{error}</p>}
      </div>
    </section>
  );
}
