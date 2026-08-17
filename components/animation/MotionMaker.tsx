"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MmdAdapter } from "@/lib/adapters/MmdAdapter";
import {
  bakeMotion,
  bakePoseHold,
  type Easing,
  type MotionKeyframe,
  POSE_LIBRARY,
  type PoseParams,
  REST_POSE,
} from "@/lib/mmd/motionComposer";
import { addPuppetFiles, type PuppetId } from "@/lib/persistence/db";

/**
 * 모션 제작 — keyframe motion maker. Pose the model with guarded
 * semantic sliders (the probe-validated side-plane laws are baked into
 * the parameter space, so a "backward-bent arm" is unreachable), stack
 * poses on a timeline, preview live, and save a real VMD that rides
 * the normal pipeline (persist → export → Geny idle loop).
 */

const PREVIEW_NAME = " maker-preview"; // thin-space prefix (never a user stem)
const UNSAFE_NAME = /[\\/#%?*:"<>|]|^\./;

type Props = {
  adapter: MmdAdapter;
  puppetKey: string | null;
  motions: string[];
  presetIds: string[];
  onSaved: (stem: string) => void;
};

type SliderRow = {
  label: string;
  get: (p: PoseParams) => number;
  set: (p: PoseParams, v: number) => PoseParams;
  min: number;
  max: number;
};

const clonePose = (p: PoseParams): PoseParams => JSON.parse(JSON.stringify(p));

const GROUPS: { title: string; rows: SliderRow[] }[] = [
  {
    title: "오른팔",
    rows: [
      {
        label: "들기",
        min: 0,
        max: 1,
        get: (p) => p.rightArm.raise,
        set: (p, v) => ({ ...p, rightArm: { ...p.rightArm, raise: v } }),
      },
      {
        label: "벌리기",
        min: -1,
        max: 1,
        get: (p) => p.rightArm.spread,
        set: (p, v) => ({ ...p, rightArm: { ...p.rightArm, spread: v } }),
      },
      {
        label: "팔꿈치",
        min: -1,
        max: 1,
        get: (p) => p.rightArm.elbow,
        set: (p, v) => ({ ...p, rightArm: { ...p.rightArm, elbow: v } }),
      },
    ],
  },
  {
    title: "왼팔",
    rows: [
      {
        label: "들기",
        min: 0,
        max: 1,
        get: (p) => p.leftArm.raise,
        set: (p, v) => ({ ...p, leftArm: { ...p.leftArm, raise: v } }),
      },
      {
        label: "벌리기",
        min: -1,
        max: 1,
        get: (p) => p.leftArm.spread,
        set: (p, v) => ({ ...p, leftArm: { ...p.leftArm, spread: v } }),
      },
      {
        label: "팔꿈치",
        min: -1,
        max: 1,
        get: (p) => p.leftArm.elbow,
        set: (p, v) => ({ ...p, leftArm: { ...p.leftArm, elbow: v } }),
      },
    ],
  },
  {
    title: "머리",
    rows: [
      {
        label: "좌우",
        min: -1,
        max: 1,
        get: (p) => p.head.yaw,
        set: (p, v) => ({ ...p, head: { ...p.head, yaw: v } }),
      },
      {
        label: "끄덕",
        min: -1,
        max: 1,
        get: (p) => p.head.pitch,
        set: (p, v) => ({ ...p, head: { ...p.head, pitch: v } }),
      },
      {
        label: "기울기",
        min: -1,
        max: 1,
        get: (p) => p.head.roll,
        set: (p, v) => ({ ...p, head: { ...p.head, roll: v } }),
      },
    ],
  },
  {
    title: "몸통",
    rows: [
      {
        label: "회전",
        min: -1,
        max: 1,
        get: (p) => p.torso.yaw,
        set: (p, v) => ({ ...p, torso: { ...p.torso, yaw: v } }),
      },
      {
        label: "숙임",
        min: -1,
        max: 1,
        get: (p) => -p.torso.pitch,
        set: (p, v) => ({ ...p, torso: { ...p.torso, pitch: -v } }),
      },
      {
        label: "기울기",
        min: -1,
        max: 1,
        get: (p) => p.torso.roll,
        set: (p, v) => ({ ...p, torso: { ...p.torso, roll: v } }),
      },
    ],
  },
  {
    title: "몸 전체",
    rows: [
      {
        label: "좌우 이동",
        min: -1,
        max: 1,
        get: (p) => p.center.x,
        set: (p, v) => ({ ...p, center: { ...p.center, x: v } }),
      },
      {
        label: "무릎 굽힘",
        min: 0,
        max: 1,
        get: (p) => p.center.dip,
        set: (p, v) => ({ ...p, center: { ...p.center, dip: v } }),
      },
    ],
  },
  {
    title: "표정",
    rows: (["笑い", "にこり", "まばたき", "困る", "あ"] as const).map((name) => ({
      label: { 笑い: "웃는 눈", にこり: "미소", まばたき: "눈 감기", 困る: "곤란", あ: "입 벌림" }[
        name
      ],
      min: 0,
      max: 1,
      get: (p: PoseParams) => p.face[name] ?? 0,
      set: (p: PoseParams, v: number) => ({
        ...p,
        face: { ...p.face, [name]: v },
      }),
    })),
  },
];

let keyCounter = 1;
const newKeyId = () => `k${keyCounter++}`;

export function MotionMakerSection({ adapter, puppetKey, motions, presetIds, onSaved }: Props) {
  const [keys, setKeys] = useState<MotionKeyframe[]>([
    { id: newKeyId(), t: 0, pose: REST_POSE, easing: "smooth" },
  ]);
  const [selectedId, setSelectedId] = useState(keys[0].id);
  const [loopBack, setLoopBack] = useState(true);
  const [saveName, setSaveName] = useState("내 모션");
  const [error, setError] = useState<string | null>(null);
  const [savedStem, setSavedStem] = useState<string | null>(null);
  const [overwriteArmed, setOverwriteArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const previewTimer = useRef<number | null>(null);
  const aliveRef = useRef(true);

  const sorted = useMemo(() => [...keys].sort((a, b) => a.t - b.t), [keys]);
  const selected = keys.find((k) => k.id === selectedId) ?? sorted[0];

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (previewTimer.current !== null) window.clearTimeout(previewTimer.current);
      const state = adapter.getMotionState();
      if (state.name === PREVIEW_NAME) adapter.stopAnimation();
    };
  }, [adapter]);

  function playBytes(bytes: Uint8Array) {
    const buf = new ArrayBuffer(bytes.length);
    new Uint8Array(buf).set(bytes);
    const file = new File([buf], "maker-preview.vmd");
    adapter.addMotionFile(PREVIEW_NAME, file, { ephemeral: true });
    adapter.playAnimation(PREVIEW_NAME);
  }

  /** live pose preview — a 1s static hold of the edited keyframe */
  function schedulePosePreview(pose: PoseParams) {
    if (previewTimer.current !== null) window.clearTimeout(previewTimer.current);
    previewTimer.current = window.setTimeout(() => {
      if (!aliveRef.current) return;
      try {
        playBytes(bakePoseHold(pose));
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }, 180);
  }

  function updateSelectedPose(next: PoseParams) {
    setKeys((prev) => prev.map((k) => (k.id === selected.id ? { ...k, pose: next } : k)));
    setSavedStem(null);
    setOverwriteArmed(false);
    schedulePosePreview(next);
  }

  function updateSelected(patch: Partial<MotionKeyframe>) {
    setKeys((prev) => prev.map((k) => (k.id === selected.id ? { ...k, ...patch } : k)));
    setSavedStem(null);
    setOverwriteArmed(false);
  }

  function addKeyframe() {
    const last = sorted[sorted.length - 1];
    const key: MotionKeyframe = {
      id: newKeyId(),
      t: Number((last.t + 1).toFixed(2)),
      pose: clonePose(selected.pose),
      easing: "smooth",
    };
    setKeys((prev) => [...prev, key]);
    setSelectedId(key.id);
  }

  function removeSelected() {
    if (keys.length <= 1) return;
    setKeys((prev) => prev.filter((k) => k.id !== selected.id));
    const remaining = sorted.filter((k) => k.id !== selected.id);
    setSelectedId(remaining[0]?.id ?? "");
  }

  function playAll() {
    try {
      playBytes(bakeMotion(sorted, { loopBack }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const canPersist = !!puppetKey && !puppetKey.startsWith("builtin:");

  async function save() {
    const stem = saveName.trim().replace(/\.vmd$/i, "");
    if (!stem) {
      setError("저장할 이름을 입력하세요");
      return;
    }
    if (UNSAFE_NAME.test(stem)) {
      setError('이름에 쓸 수 없는 문자가 있습니다 (\\ / # % ? * : " < > | 또는 맨 앞의 점)');
      return;
    }
    const exists = motions.includes(stem) || presetIds.includes(stem);
    if (exists && !overwriteArmed) {
      setOverwriteArmed(true);
      setError(`"${stem}" 이(가) 이미 있습니다 — 한 번 더 누르면 덮어씁니다`);
      return;
    }
    setOverwriteArmed(false);
    setBusy(true);
    setError(null);
    try {
      const bytes = bakeMotion(sorted, { loopBack });
      const buf = new ArrayBuffer(bytes.length);
      new Uint8Array(buf).set(bytes);
      const file = new File([buf], `${stem}.vmd`, { type: "application/octet-stream" });
      if (canPersist && puppetKey) {
        await addPuppetFiles(puppetKey as PuppetId, [
          { name: file.name, path: `motions/${file.name}`, size: file.size, blob: file },
        ]);
      }
      adapter.addMotionFile(stem, file);
      onSaved(stem);
      setSavedStem(stem);
    } catch (e) {
      if (aliveRef.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {/* timeline */}
      <div className="flex flex-wrap items-center gap-1">
        {sorted.map((k, i) => (
          <button
            key={k.id}
            type="button"
            onClick={() => {
              setSelectedId(k.id);
              schedulePosePreview(k.pose);
            }}
            className={`rounded border px-2 py-1 text-[11px] tabular-nums ${
              k.id === selected.id
                ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                : "border-[var(--color-border)] text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
            }`}
            title={`키프레임 ${i + 1} — ${k.t.toFixed(2)}초`}
          >
            {i + 1} · {k.t.toFixed(1)}s
          </button>
        ))}
        <button
          type="button"
          onClick={addKeyframe}
          className="rounded border border-[var(--color-accent)]/60 px-2 py-1 text-[11px] text-[var(--color-accent)]"
          title="현재 포즈를 복사해 다음 키프레임 추가"
        >
          + 키프레임
        </button>
      </div>

      {/* selected keyframe: time · easing · delete */}
      <div className="flex items-center gap-2 text-[11px]">
        <label className="flex items-center gap-1">
          <span className="opacity-70">시간</span>
          <input
            type="number"
            step={0.1}
            min={0}
            value={selected.t}
            onChange={(e) => updateSelected({ t: Math.max(0, Number(e.target.value)) })}
            className="w-16 rounded bg-black/30 px-1 py-0.5 tabular-nums"
          />
          <span className="opacity-50">초</span>
        </label>
        <label className="flex items-center gap-1">
          <span className="opacity-70">이징</span>
          <select
            value={selected.easing}
            onChange={(e) => updateSelected({ easing: e.target.value as Easing })}
            className="rounded bg-black/30 px-1 py-0.5"
          >
            <option value="smooth">부드럽게</option>
            <option value="linear">일정하게</option>
            <option value="sharp-in">빠르게 시작</option>
            <option value="sharp-out">빠르게 끝</option>
          </select>
        </label>
        <button
          type="button"
          onClick={removeSelected}
          disabled={keys.length <= 1}
          className="ml-auto rounded border border-red-400/40 px-2 py-0.5 text-red-300 disabled:opacity-30"
        >
          키 삭제
        </button>
      </div>

      {/* pose library */}
      <div className="flex flex-wrap gap-1">
        {POSE_LIBRARY.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => updateSelectedPose(clonePose(p.pose))}
            className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[11px] text-[var(--color-fg-dim)] hover:text-[var(--color-accent)]"
            title="검증된 포즈로 현재 키프레임 채우기"
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* pose sliders */}
      <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
        {GROUPS.map((g) => (
          <div key={g.title}>
            <p className="mb-0.5 text-[10px] uppercase tracking-widest opacity-60">{g.title}</p>
            {g.rows.map((row) => (
              <label key={row.label} className="flex items-center gap-2 text-[11px]">
                <span className="w-14 shrink-0 opacity-70">{row.label}</span>
                <input
                  type="range"
                  className="min-w-0 flex-1"
                  min={row.min}
                  max={row.max}
                  step={0.01}
                  value={row.get(selected.pose)}
                  onChange={(e) =>
                    updateSelectedPose(row.set(selected.pose, Number(e.target.value)))
                  }
                />
                <span className="w-9 shrink-0 text-right text-[10px] tabular-nums opacity-70">
                  {Math.round(row.get(selected.pose) * 100)}
                </span>
              </label>
            ))}
          </div>
        ))}
      </div>

      {/* transport + save */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={playAll}
          className="rounded border border-white/20 px-2 py-1 text-xs hover:bg-white/10"
        >
          ▶ 전체 재생
        </button>
        <label className="flex items-center gap-1 text-[11px]">
          <input
            type="checkbox"
            checked={loopBack}
            onChange={(e) => setLoopBack(e.target.checked)}
          />
          <span title="마지막에 첫 포즈로 부드럽게 돌아가 루프가 끊기지 않게 합니다">
            루프 이어붙임
          </span>
        </label>
        {canPersist && (
          <>
            <input
              className="min-w-0 flex-1 rounded bg-black/30 px-2 py-1 text-xs"
              value={saveName}
              onChange={(e) => {
                setSaveName(e.target.value);
                setOverwriteArmed(false);
              }}
              placeholder="저장할 모션 이름"
            />
            <button
              type="button"
              className="shrink-0 rounded border border-emerald-400/40 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-400/10 disabled:opacity-40"
              disabled={busy || !saveName.trim()}
              onClick={() => void save()}
            >
              {busy ? "저장 중…" : "모션으로 저장"}
            </button>
          </>
        )}
      </div>
      {savedStem !== null && !error && (
        <p className="text-[10px] text-emerald-300/80">
          &quot;{savedStem}&quot; 저장됨 — 모션 목록에서 재생·아이들 지정할 수 있습니다.
        </p>
      )}
      {error && <p className="text-[10px] text-red-300">{error}</p>}
    </div>
  );
}
