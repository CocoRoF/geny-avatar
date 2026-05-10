"use client";

import { useEffect } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
};

/**
 * Discoverability surface for the editor: keyboard shortcuts +
 * panel-by-panel "what does this do" + the standard work flow
 * (decompose → generate → apply). Triggered by the `?` key or the
 * `?` button in the editor header.
 *
 * Stays intentionally minimal — Phase 7 polish, not a full docs
 * site. Copy is dual-language (Korean primary, short English under)
 * because the operator is Korean but third-party runtime
 * terminology stays in English.
 */
export function HelpModal({ open, onClose }: Props) {
  // Esc dismisses. Open-state guard avoids leaking listeners.
  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch bg-black/70 backdrop-blur-sm">
      <button
        type="button"
        aria-label="close help"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <div className="relative z-10 m-auto flex max-h-[85vh] w-[min(92vw,720px)] flex-col overflow-hidden rounded border border-[var(--color-border)] bg-[var(--color-bg)] shadow-2xl">
        <header className="flex shrink-0 items-center gap-3 border-b border-[var(--color-border)] px-4 py-2 text-xs">
          <span className="font-mono text-[var(--color-accent)]">help · v1</span>
          <span className="text-[var(--color-fg-dim)]">단축키 · 워크플로 · 패널 안내</span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
            title="esc"
          >
            close
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 text-sm leading-relaxed">
          {/* Workflow */}
          <section className="mb-5">
            <h2 className="mb-2 text-xs uppercase tracking-widest text-[var(--color-fg-dim)]">
              workflow · 작업 순서
            </h2>
            <ol className="ml-4 list-decimal space-y-1 text-[var(--color-fg)]">
              <li>
                <strong>library</strong> 에서 puppet 업로드 또는 선택 → editor 진입
              </li>
              <li>좌측 캔버스에서 puppet 미리보기 · 우측 사이드바에 패널들</li>
              <li>레이어 한 줄 클릭 → visibility 토글 · 썸네일 클릭 → DecomposeStudio</li>
              <li>DecomposeStudio 에서 mask 다듬기 (trim) 또는 region 분리 (split)</li>
              <li>
                레이어의 ✨ generate 버튼 → 풀화면 GeneratePanel · region 선택 후 prompt 입력 →
                "generate this region" → "apply to atlas"
              </li>
              <li>ExportButton (헤더) 으로 puppet 내보내기 — 두 가지 모드 (raw zip / baked)</li>
            </ol>
          </section>

          {/* Shortcuts */}
          <section className="mb-5">
            <h2 className="mb-2 text-xs uppercase tracking-widest text-[var(--color-fg-dim)]">
              shortcuts · 키보드
            </h2>
            <ul className="space-y-1.5 text-[var(--color-fg)]">
              <li>
                <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-panel)] px-1.5 py-0.5 font-mono text-[11px]">
                  Cmd/Ctrl + Z
                </kbd>{" "}
                — undo (visibility / color)
              </li>
              <li>
                <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-panel)] px-1.5 py-0.5 font-mono text-[11px]">
                  Cmd/Ctrl + Shift + Z
                </kbd>{" "}
                또는{" "}
                <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-panel)] px-1.5 py-0.5 font-mono text-[11px]">
                  Cmd/Ctrl + Y
                </kbd>{" "}
                — redo
              </li>
              <li>
                <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-panel)] px-1.5 py-0.5 font-mono text-[11px]">
                  R
                </kbd>{" "}
                — 모든 visibility / color override 리셋
              </li>
              <li>
                <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-panel)] px-1.5 py-0.5 font-mono text-[11px]">
                  Esc
                </kbd>{" "}
                — 모달 닫기 (저장 안 된 변경 있으면 confirm)
              </li>
              <li>
                <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-panel)] px-1.5 py-0.5 font-mono text-[11px]">
                  ?
                </kbd>{" "}
                — 이 help 모달 토글
              </li>
              <li className="pt-1 text-[var(--color-fg-dim)]">
                · 텍스트 입력 중 (input/textarea) 에선 단축키 동작 안 함
              </li>
            </ul>
          </section>

          {/* Panels */}
          <section className="mb-5">
            <h2 className="mb-2 text-xs uppercase tracking-widest text-[var(--color-fg-dim)]">
              panels · 패널별 역할
            </h2>
            <dl className="space-y-2 text-[var(--color-fg)]">
              <div>
                <dt className="font-medium text-[var(--color-accent)]">Tools</dt>
                <dd className="text-[var(--color-fg-dim)]">
                  애니메이션 라디오 · viewport 컨트롤 · UI 토글 · 빈 상태에서 시작점.
                </dd>
              </div>
              <div>
                <dt className="font-medium text-[var(--color-accent)]">References</dt>
                <dd className="text-[var(--color-fg-dim)]">
                  AI 생성 시 image[] 로 함께 보낼 캐릭터 / 스타일 reference 이미지. PNG/JPEG/WebP
                  업로드 → puppet 별 영구 저장 (IDB).
                </dd>
              </div>
              <div>
                <dt className="font-medium text-[var(--color-accent)]">Variants</dt>
                <dd className="text-[var(--color-fg-dim)]">
                  Outfit / part visibility 프리셋. Spine Skin · Cubism Part Group import 도 여기에
                  통합 → 기존 모델 자산을 그대로 활용.
                </dd>
              </div>
              <div>
                <dt className="font-medium text-[var(--color-accent)]">Layers</dt>
                <dd className="text-[var(--color-fg-dim)]">
                  레이어 list · 검색 · 일괄 visibility · 행별 mask/gen 진입. baked-hidden, hide
                  count 같은 export 영향 표시도 여기.
                </dd>
              </div>
            </dl>
          </section>

          {/* Modals */}
          <section className="mb-5">
            <h2 className="mb-2 text-xs uppercase tracking-widest text-[var(--color-fg-dim)]">
              modals · 큰 모달들
            </h2>
            <dl className="space-y-2 text-[var(--color-fg)]">
              <div>
                <dt className="font-medium text-[var(--color-accent)]">DecomposeStudio</dt>
                <dd className="text-[var(--color-fg-dim)]">
                  layer 의 atlas 영역을 mask 로 다듬기. <strong>trim</strong> 모드 = 단일 mask ·{" "}
                  <strong>split</strong> 모드 = 다중 region (AI generate 가 region 단위로 동작).
                  split 의 paint / erase / auto (SAM) 도구.
                </dd>
              </div>
              <div>
                <dt className="font-medium text-[var(--color-accent)]">GeneratePanel</dt>
                <dd className="text-[var(--color-fg-dim)]">
                  multi-region 이면 picker → focus mode. Provider (OpenAI gpt-image-2 / Gemini /
                  Replicate) · prompt · references · refine 토글. Per-region regenerate · revert ·
                  history.
                </dd>
              </div>
            </dl>
          </section>

          {/* Tips */}
          <section>
            <h2 className="mb-2 text-xs uppercase tracking-widest text-[var(--color-fg-dim)]">
              tips
            </h2>
            <ul className="ml-4 list-disc space-y-1 text-[var(--color-fg-dim)]">
              <li>
                editor 모달에서{" "}
                <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-panel)] px-1 font-mono text-[10px]">
                  fullscreen
                </kbd>{" "}
                버튼 → 큰 캔버스에서 작업
              </li>
              <li>multi-region 의 region 별 prompt 는 메모리에 보관 — region 전환해도 잃지 않음</li>
              <li>
                "revert this region" = 그 region 만 원본 복귀 · "revert layer · all regions" = 전체
                텍스처 wipe
              </li>
              <li>저장 안 된 generated 결과 있을 때 close 시도 → 항상 confirm</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
