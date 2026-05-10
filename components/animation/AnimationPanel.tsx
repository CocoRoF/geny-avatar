"use client";

import type { AvatarAdapter } from "@/lib/adapters/AvatarAdapter";
import { useCubismMeta } from "@/lib/avatar/cubismMeta";

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

  // Counts visible per section so users can see at a glance whether
  // the puppet has any motions / expressions / hit areas before the
  // detailed UI lands in 8.3~8.6.
  const motionGroupCount = meta?.motionGroups.length ?? 0;
  const motionEntryCount = meta?.motionGroups.reduce((sum, g) => sum + g.entries.length, 0) ?? 0;
  const expressionCount = meta?.expressions.length ?? 0;
  const hitAreaCount = meta?.hitAreas.length ?? 0;

  return (
    <div className="flex h-full flex-col gap-4 p-4 text-xs text-[var(--color-fg-dim)]">
      {error && (
        <p className="rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] text-red-400">
          manifest 읽기 실패: {error}
        </p>
      )}
      {loading && <p className="text-[10px] opacity-60">manifest 분석 중…</p>}

      <Section title="display">
        <p>kScale · X/Y shift · idle motion group 선택</p>
        <p className="mt-1 text-[10px] opacity-70">8.3 — 다음 sprint</p>
      </Section>
      <Section
        title={`motions${meta ? ` (${motionGroupCount} groups, ${motionEntryCount} entries)` : ""}`}
      >
        {meta ? (
          motionGroupCount === 0 ? (
            <p className="opacity-60">이 puppet 은 motion 이 정의되어 있지 않습니다.</p>
          ) : (
            <ul className="space-y-1">
              {meta.motionGroups.map((g) => (
                <li key={g.name} className="font-mono text-[11px]">
                  <span className="text-[var(--color-accent)]">{g.name}</span>
                  <span className="ml-2 opacity-60">{g.entries.length} entries</span>
                </li>
              ))}
            </ul>
          )
        ) : (
          <p className="opacity-50">…</p>
        )}
        <p className="mt-2 text-[10px] opacity-70">▶ 미리보기 + idle 선택은 8.4</p>
      </Section>
      <Section title={`expressions${meta ? ` (${expressionCount})` : ""}`}>
        {meta ? (
          expressionCount === 0 ? (
            <p className="opacity-60">이 puppet 은 expression 이 정의되어 있지 않습니다.</p>
          ) : (
            <ul className="flex flex-wrap gap-1">
              {meta.expressions.map((e) => (
                <li
                  key={e.name}
                  className="rounded border border-[var(--color-border)] px-1.5 py-0.5 font-mono text-[10px]"
                  title={e.file}
                >
                  {e.name}
                </li>
              ))}
            </ul>
          )
        ) : (
          <p className="opacity-50">…</p>
        )}
        <p className="mt-2 text-[10px] opacity-70">▶ 미리보기 + emotion 매핑은 8.5</p>
      </Section>
      <Section title={`hit areas${meta ? ` (${hitAreaCount})` : ""}`}>
        {meta ? (
          hitAreaCount === 0 ? (
            <p className="opacity-60">이 puppet 은 HitArea 가 정의되어 있지 않습니다.</p>
          ) : (
            <ul className="flex flex-wrap gap-1">
              {meta.hitAreas.map((h) => (
                <li
                  key={h.name}
                  className="rounded border border-[var(--color-border)] px-1.5 py-0.5 font-mono text-[10px]"
                >
                  {h.name}
                </li>
              ))}
            </ul>
          )
        ) : (
          <p className="opacity-50">…</p>
        )}
        <p className="mt-2 text-[10px] opacity-70">tap motion 매핑은 8.6</p>
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
