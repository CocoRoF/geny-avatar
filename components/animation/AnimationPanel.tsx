"use client";

import type { Application } from "pixi.js";
import type { AvatarAdapter } from "@/lib/adapters/AvatarAdapter";
import type { Live2DAdapter } from "@/lib/adapters/Live2DAdapter";
import { useCubismMeta } from "@/lib/avatar/cubismMeta";
import { usePuppetAnimationConfig } from "@/lib/avatar/usePuppetAnimationConfig";
import type { DisplayConfig } from "./DisplaySection";
import { DisplaySection } from "./DisplaySection";
import type { EmotionMap } from "./ExpressionsSection";
import { ExpressionsSection } from "./ExpressionsSection";
import type { TapMotions } from "./HitAreasSection";
import { HitAreasSection } from "./HitAreasSection";
import { MotionsSection } from "./MotionsSection";

type Props = {
  /** Same scheme as the other panels — PuppetId or `builtin:<key>`,
   *  `null` while still loading. Stored values are puppet-scoped via
   *  this key (Sprint 8.7). */
  puppetKey: string | null;
  /** Live runtime adapter. We need it to peek at the underlying
   *  model3.json (Sprint 8.2) and to trigger motion / expression
   *  previews from the UI (Sprint 8.4 / 8.5). */
  adapter: AvatarAdapter | null;
  /** Pixi Application — needed by 8.3 (Display section) to compute
   *  the fit-to-screen base factor when applying user kScale / shift. */
  app: Application | null;
};

/**
 * AnimationPanel — Phase 8 sidebar contents for the Animation tab.
 *
 * 8.1 (this sprint) ships only the shell with section headings and
 * "coming soon" copy so the tab switcher has somewhere to land. The
 * follow-up sprints fill out each section:
 *
 *   - 8.3  Display    — kScale + X/Y shift sliders with live preview
 *   - 8.4  Motions    — motion list + ▶ play
 *   - 8.5  Expressions + Emotion map
 *   - 8.6  Hit Areas  (conditional on model3.json having any)
 *   - 8.7  IDB persistence (puppetAnimationConfig store)
 *   - 8.8  buildModelZip schemaVersion v1 → v2
 */
export function AnimationPanel({ puppetKey, adapter, app }: Props) {
  const isLive2D = !!adapter && adapter.runtime === "live2d";
  // Phase 8.2 — pull motion / expression / hit-area metadata off the
  // adapter's model3.json. Returns nulls until the adapter resolves.
  const { meta, loading: metaLoading, error: metaError } = useCubismMeta(adapter);
  // Phase 8.7 — IDB-backed config for the puppet. Sections take their
  // initial values from `config` (frozen at first mount via lazy
  // useState; we key on puppetKey to force a remount on switch) and
  // bubble changes back through `update`, which debounces a 400ms
  // write.
  const { config, loading: configLoading, update } = usePuppetAnimationConfig(puppetKey);

  const onDisplayChange = (next: DisplayConfig) => {
    update({
      display: {
        kScale: next.kScale,
        initialXshift: next.initialXshift,
        initialYshift: next.initialYshift,
      },
      idleMotionGroupName: next.idleMotionGroupName,
    });
  };
  const onEmotionMapChange = (next: EmotionMap) => {
    update({ emotionMap: next });
  };
  const onTapMotionsChange = (next: TapMotions) => {
    update({ tapMotions: next });
  };

  // Spine puppets out of scope for the V1 animation tab — Spine's
  // animation tracks + skins are a different model than Cubism's
  // motions + expressions, and need their own UI design.
  if (!isLive2D) {
    return (
      <div className="flex h-full flex-col gap-3 p-4 text-xs text-[var(--color-fg-dim)]">
        <h2 className="text-[10px] uppercase tracking-widest">animation</h2>
        <p>
          Spine 의 animation tab 은 V1 범위 밖입니다. Spine 은 animation tracks / skins 모델이
          Cubism 의 motion / expression 과 달라 별도 설계가 필요합니다.
        </p>
        <p>
          현재 Spine puppet 은 텍스처 편집 (Edit 탭) + Geny 로 baked export 까지는 정상 사용 가능.
          animation 메타데이터는 Geny 측 디폴트값 적용.
        </p>
      </div>
    );
  }

  // 8.6 — hide hit-areas section entirely when the puppet defines
  // none (Hiyori, ellen_joe, etc.). The cubism manifest spec allows
  // an empty list and most puppets ship that way.
  const hasHitAreas = !!meta && meta.hitAreas.length > 0;

  // 8.7 — sections read initial values via lazy useState; mounting
  // them only after both the manifest *and* the IDB config have
  // resolved makes that lazy init see real data. We re-mount the
  // whole tree on puppetKey change via `key` below.
  const ready = !!meta && !!adapter && !!app && !configLoading;

  return (
    <div className="flex h-full flex-col gap-4 p-4 text-xs text-[var(--color-fg-dim)]">
      {metaError && (
        <p className="rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] text-red-400">
          manifest 읽기 실패: {metaError}
        </p>
      )}
      {(metaLoading || configLoading) && (
        <p className="text-[10px] opacity-60">
          {metaLoading ? "manifest 분석 중…" : "config 불러오는 중…"}
        </p>
      )}

      {ready && meta && adapter && app ? (
        <div key={puppetKey ?? "no-key"} className="flex flex-col gap-4">
          <DisplaySection
            adapter={adapter}
            app={app}
            meta={meta}
            initial={{
              kScale: config.display.kScale,
              initialXshift: config.display.initialXshift,
              initialYshift: config.display.initialYshift,
              idleMotionGroupName: config.idleMotionGroupName,
            }}
            onChange={onDisplayChange}
          />
          <MotionsSection adapter={adapter as Live2DAdapter} meta={meta} />
          <ExpressionsSection
            adapter={adapter as Live2DAdapter}
            meta={meta}
            initial={config.emotionMap as EmotionMap}
            onChange={onEmotionMapChange}
          />
          {hasHitAreas && (
            <HitAreasSection
              adapter={adapter as Live2DAdapter}
              meta={meta}
              initial={config.tapMotions}
              onChange={onTapMotionsChange}
            />
          )}
        </div>
      ) : (
        !metaError && (
          <p className="text-[10px] opacity-50">
            준비 중… (puppet 로딩 + manifest 파싱 + config 로드)
          </p>
        )
      )}
    </div>
  );
}
