"use client";

import type { Application } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AvatarAdapter } from "@/lib/adapters/AvatarAdapter";
import type { Live2DAdapter } from "@/lib/adapters/Live2DAdapter";
import type { CubismMeta } from "@/lib/avatar/cubismMeta";

/** Defaults match Geny's model_registry shape so the values exported
 *  in 8.8 line up with the existing live2d-models entries. */
const DEFAULTS = {
  kScale: 0.7,
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
  adapter: AvatarAdapter;
  app: Application;
  meta: CubismMeta;
  /** Initial values (from IDB once 8.7 lands; for 8.3 starts at defaults
   *  on every mount). */
  initial?: Partial<DisplayConfig>;
  /** Notified on every slider movement so a parent (or 8.7's IDB write
   *  hook) can persist. Called with the *full* config. */
  onChange?: (cfg: DisplayConfig) => void;
};

/**
 * Phase 8.3 — Display section of the Animation tab.
 *
 * kScale + X/Y shift sliders drive the puppet's transform live. The
 * sliders multiply / offset on top of PuppetCanvas's fit-to-canvas
 * baseline (recomputed here from the puppet's native size + the
 * current screen). Idle motion group dropdown is a passive picker for
 * now — actually triggering playback lands in 8.4.
 *
 * Local-state-only this sprint; IDB persistence joins in 8.7.
 */
export function DisplaySection({ adapter, app, meta, initial, onChange }: Props) {
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
  // dependency list when the parent passes an inline callback.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Apply kScale + shift to the live display whenever cfg changes.
  // baseFactor is recomputed from the current pixi app.screen × the
  // adapter's native model size, mirroring PuppetCanvas's fit math.
  useEffect(() => {
    if (adapter.runtime !== "live2d") return;
    const display = adapter.getDisplayObject();
    if (!display) return;

    const native = (adapter as Live2DAdapter).getNativeSize?.();
    const baseW = native?.width ?? 800;
    const baseH = native?.height ?? 1200;
    const screen = app.screen;
    const baseFactor = Math.min((screen.width * 0.9) / baseW, (screen.height * 0.9) / baseH);

    // biome-ignore lint/suspicious/noExplicitAny: pixi display surface
    const d = display as any;
    d.scale?.set?.(baseFactor * cfg.kScale);
    d.position?.set?.(screen.width / 2 + cfg.initialXshift, screen.height / 2 + cfg.initialYshift);

    onChangeRef.current?.(cfg);
  }, [adapter, app, cfg]);

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
  }, []);

  return (
    <section className="rounded border border-[var(--color-border)] bg-[var(--color-panel)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
          display
        </h3>
        <button
          type="button"
          onClick={reset}
          className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
          title="kScale / shift 디폴트로 복귀"
        >
          reset
        </button>
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
