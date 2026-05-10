"use client";

import type { Application } from "pixi.js";
import type { AvatarAdapter } from "@/lib/adapters/AvatarAdapter";
import type { Live2DAdapter } from "@/lib/adapters/Live2DAdapter";
import { useCubismMeta } from "@/lib/avatar/cubismMeta";
import { DisplaySection } from "./DisplaySection";
import { ExpressionsSection } from "./ExpressionsSection";
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
export function AnimationPanel({ puppetKey: _puppetKey, adapter, app }: Props) {
  const isLive2D = !!adapter && adapter.runtime === "live2d";
  // Phase 8.2 — pull motion / expression / hit-area metadata off the
  // adapter's model3.json. Returns nulls until the adapter resolves.
  const { meta, loading, error } = useCubismMeta(adapter);

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

  return (
    <div className="flex h-full flex-col gap-4 p-4 text-xs text-[var(--color-fg-dim)]">
      {error && (
        <p className="rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] text-red-400">
          manifest 읽기 실패: {error}
        </p>
      )}
      {loading && <p className="text-[10px] opacity-60">manifest 분석 중…</p>}

      {meta && adapter && app ? (
        <DisplaySection adapter={adapter} app={app} meta={meta} />
      ) : (
        <Section title="display">
          <p className="opacity-50">manifest 분석 중…</p>
        </Section>
      )}
      {meta && adapter ? (
        <MotionsSection adapter={adapter as Live2DAdapter} meta={meta} />
      ) : (
        <Section title="motions">
          <p className="opacity-50">…</p>
        </Section>
      )}
      {meta && adapter ? (
        <ExpressionsSection adapter={adapter as Live2DAdapter} meta={meta} />
      ) : (
        <Section title="expressions">
          <p className="opacity-50">…</p>
        </Section>
      )}
      {hasHitAreas && meta && adapter && (
        <HitAreasSection adapter={adapter as Live2DAdapter} meta={meta} />
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded border border-dashed border-[var(--color-border)] bg-[var(--color-panel)] p-3">
      <h3 className="mb-2 text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
        {title}
      </h3>
      {children}
    </section>
  );
}
