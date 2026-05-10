"use client";

import type { AvatarAdapter } from "@/lib/adapters/AvatarAdapter";

type Props = {
  /** Same scheme as the other panels — PuppetId or `builtin:<key>`,
   *  `null` while still loading. Stored values are puppet-scoped via
   *  this key (Sprint 8.7). */
  puppetKey: string | null;
  /** Live runtime adapter. We need it to peek at the underlying
   *  model3.json (Sprint 8.2) and to trigger motion / expression
   *  previews from the UI (Sprint 8.4 / 8.5). */
  adapter: AvatarAdapter | null;
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
export function AnimationPanel({ puppetKey: _puppetKey, adapter }: Props) {
  const isLive2D = !!adapter && adapter.runtime === "live2d";

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

  return (
    <div className="flex h-full flex-col gap-4 p-4 text-xs text-[var(--color-fg-dim)]">
      <Section title="display">
        <p>kScale · X/Y shift · idle motion group 선택</p>
        <p className="mt-1 text-[10px] opacity-70">8.3 — 다음 sprint</p>
      </Section>
      <Section title="motions">
        <p>motion group / entry 목록 + ▶ 미리보기 + idle 그룹 체크</p>
        <p className="mt-1 text-[10px] opacity-70">8.4 — 다음 sprint</p>
      </Section>
      <Section title="expressions">
        <p>expression 목록 + ▶ 미리보기 + 8 GoEmotions 매핑 매트릭스</p>
        <p className="mt-1 text-[10px] opacity-70">8.5 — 다음 sprint</p>
      </Section>
      <Section title="hit areas">
        <p>model 에 정의된 HitAreas 별 tap motion 매핑 (조건부)</p>
        <p className="mt-1 text-[10px] opacity-70">8.6 — 다음 sprint</p>
      </Section>
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
