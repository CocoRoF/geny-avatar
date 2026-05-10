"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CubismMeta } from "@/lib/avatar/cubismMeta";
import { useViewportStore } from "@/lib/store/viewport";

const DEFAULTS = {
  kScale: 1.0,
  xShift: 0,
  yShift: 0,
};

const SCALE_MIN = 0.1;
const SCALE_MAX = 2.0;
const SHIFT_MIN = -400;
const SHIFT_MAX = 400;

export type DisplayConfig = {
  kScale: number;
  initialXshift: number;
  initialYshift: number;
  idleMotionGroupName: string;
};

type Props = {
  meta: CubismMeta;
  /** Initial values from IDB (Phase 8.7). Lazy useState; the parent
   *  re-mounts via key={puppetKey} when the puppet changes. */
  initial?: Partial<DisplayConfig>;
  /** Notified on every change. Parent persists to IDB + bubble for
   *  export. */
  onChange?: (cfg: DisplayConfig) => void;
};

/**
 * Phase 8.3 + post-Phase-8 viewport rework — Display section.
 *
 * The slider state is intentionally additive on top of PuppetCanvas's
 * pan/zoom: the user can wheel-zoom into the canvas to inspect detail
 * AND independently dial in kScale, since they represent different
 * intents (viewing convenience vs. what Geny will use at runtime).
 *
 * We don't touch the Pixi display directly anymore — PuppetCanvas
 * subscribes to `useViewportStore.intrinsic` and recomposes the
 * transform on every change. Same goes for shift sliders.
 */
export function DisplaySection({ meta, initial, onChange }: Props) {
  const setIntrinsic = useViewportStore((s) => s.setIntrinsic);
  const resetUserView = useViewportStore((s) => s.resetUserView);

  const [cfg, setCfg] = useState<DisplayConfig>(() => {
    const idleFromMeta =
      meta.motionGroups.find((g) => /^idle$/i.test(g.name))?.name ??
      meta.motionGroups[0]?.name ??
      "";
    return {
      kScale: initial?.kScale ?? DEFAULTS.kScale,
      initialXshift: initial?.initialXshift ?? DEFAULTS.xShift,
      initialYshift: initial?.initialYshift ?? DEFAULTS.yShift,
      idleMotionGroupName: initial?.idleMotionGroupName ?? idleFromMeta,
    };
  });

  // Latest onChange in a ref so the apply effect doesn't churn the
  // dep list when the parent passes an inline callback.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Push the puppet-intrinsic transform into the viewport store on
  // every cfg change. PuppetCanvas's subscriber picks it up and
  // recomputes scale + position.
  useEffect(() => {
    setIntrinsic({
      kScale: cfg.kScale,
      shiftX: cfg.initialXshift,
      shiftY: cfg.initialYshift,
    });
    onChangeRef.current?.(cfg);
  }, [cfg, setIntrinsic]);

  const update = useCallback(<K extends keyof DisplayConfig>(key: K, value: DisplayConfig[K]) => {
    setCfg((prev) => ({ ...prev, [key]: value }));
  }, []);

  const reset = useCallback(() => {
    setCfg((prev) => ({
      ...prev,
      kScale: DEFAULTS.kScale,
      initialXshift: DEFAULTS.xShift,
      initialYshift: DEFAULTS.yShift,
    }));
    resetUserView();
  }, [resetUserView]);

  return (
    <section className="rounded border border-[var(--color-border)] bg-[var(--color-panel)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
          display
        </h3>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={resetUserView}
            className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
            title="확대 / 이동만 초기화 (kScale/shift 유지)"
          >
            fit
          </button>
          <button
            type="button"
            onClick={reset}
            className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
            title="kScale / shift / 확대 / 이동 모두 디폴트로"
          >
            reset
          </button>
        </div>
      </div>

      <Slider
        label="kScale"
        value={cfg.kScale}
        min={SCALE_MIN}
        max={SCALE_MAX}
        step={0.01}
        onChange={(v) => update("kScale", v)}
      />
      <Slider
        label="X shift"
        value={cfg.initialXshift}
        min={SHIFT_MIN}
        max={SHIFT_MAX}
        step={1}
        onChange={(v) => update("initialXshift", v)}
      />
      <Slider
        label="Y shift"
        value={cfg.initialYshift}
        min={SHIFT_MIN}
        max={SHIFT_MAX}
        step={1}
        onChange={(v) => update("initialYshift", v)}
      />

      <div className="mt-3">
        {meta.motionGroups.length === 0 ? (
          <p className="text-[10px] opacity-60">motion 그룹 없음</p>
        ) : (
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
              idle motion group
            </span>
            <select
              value={cfg.idleMotionGroupName}
              onChange={(e) => update("idleMotionGroupName", e.target.value)}
              className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs"
            >
              {meta.motionGroups.map((g) => (
                <option key={g.name} value={g.name}>
                  {g.name} · {g.entries.length} entries
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <p className="mt-3 text-[10px] text-[var(--color-fg-dim)] opacity-60">
        canvas 에서 드래그 = 이동, 휠 = 커서 기준 확대/축소 (양쪽 탭 모두). kScale/shift 는 Geny 에
        export 되는 puppet 의 기본값이고, 확대/이동은 편집 시 보기 편의입니다.
      </p>
    </section>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="mt-2">
      <div className="mb-0.5 flex items-baseline justify-between text-[11px]">
        <span className="text-[var(--color-fg-dim)]">{label}</span>
        <span className="font-mono text-[var(--color-fg)]">
          {step >= 1 ? value.toFixed(0) : value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--color-accent)]"
      />
      <div className="flex justify-between font-mono text-[9px] text-[var(--color-fg-dim)] opacity-60">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}
