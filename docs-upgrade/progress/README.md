# progress/

geny-avatar 업그레이드 작업의 진행 로그가 누적되는 폴더.

- 분석 본문: 옆 폴더 `..` (docs-upgrade)의 14개 문서.
- 실행 계획: 옆 폴더 [`../plan/`](../plan/)의 5개 문서.
- 이 폴더(`progress/`): **실제로 한 작업의 흔적**을 작업 단위로 남긴다.

## 파일 명명 규칙

```
progress/
  README.md                 ← 이 파일 (가이드 + 인덱스)
  YYYY-MM-DD-<slug>.md      ← 작업 단위 entry
```

- 한 entry = 한 작업 (커밋 1~수 개, PR 1개 정도).
- 날짜는 작업 시작일 기준 (KST).
- `<slug>`는 짧은 영문 / 숫자 / 하이픈. 예: `phase1-1-mask-erosion`.
- 같은 날 여러 entry면 suffix로 구분: `2026-05-12-phase1-1-mask-erosion.md`,
  `2026-05-12-phase1-2-canonical-pose.md`.

## entry 양식

각 파일 안에 다음 항목을 채운다. 길게 쓰지 말고 3–8줄 요약.

```markdown
# <YYYY-MM-DD> Phase<N>.<task#> — <짧은 제목>

**Phase / 작업**: Phase N 작업 #
**상태**: in-progress | done | blocked
**관련 계획**: [plan/0X-PhaseN.md](../plan/0X-PhaseN.md) 작업 #

## 변경
- 손댄 파일 / 주요 변경 사항 (한두 줄씩).

## 검증
- 무엇으로 확인했는지. 측정값이 있으면 숫자.

## 결정
- 도중에 결정한 사항. 계획 문서와 어긋났으면 명시.

## 영향
- 이후 작업 / 다른 Phase에 끼치는 영향.

## 참조
- 커밋 hash / PR 링크 / 외부 자료 등.
```

## 운영 규칙

- **작업 시작 직후** entry 파일을 만든다. 상태 `in-progress`.
- **작업 종료 시** 같은 파일을 갱신. 상태 `done` 또는 `blocked`.
- entry 안에 분석 / 회고를 길게 쓰지 않는다. 회고 / 의사결정 본문은
  필요 시 [`../`](..) 의 분석 문서를 업데이트한다.
- 진행 로그는 **append-only**. 잘못 적어도 다음 entry로 정정한다.
  이전 entry를 사후에 다시 쓰지 않는다.
- blocked 된 작업은 막힌 이유를 entry에 명시하고, 해제 후 새 entry로
  follow-up.

## 인덱스 (최신이 위)

작업이 추가되면 여기 한 줄씩 추가.

| 날짜 | 파일 | Phase | PR | 상태 |
|---|---|---|---|---|
| 2026-05-13 | [2026-05-13-mask-soft-blend.md](2026-05-13-mask-soft-blend.md) | 1.x mask-soft (feather) | (이 PR) | done |
| 2026-05-13 | [2026-05-13-blend-mode-selectable.md](2026-05-13-blend-mode-selectable.md) | 1.x blend mode UI | [#32](https://github.com/CocoRoF/geny-avatar/pull/32) | done |
| 2026-05-13 | [2026-05-13-postprocess-mask-blend.md](2026-05-13-postprocess-mask-blend.md) | 1.x hard mask blend | [#31](https://github.com/CocoRoF/geny-avatar/pull/31) | done |
| 2026-05-13 | [2026-05-13-openai-timeout-and-mask-ref-alignment.md](2026-05-13-openai-timeout-and-mask-ref-alignment.md) | 1.x timeout + dim align | [#30](https://github.com/CocoRoF/geny-avatar/pull/30) | done |
| 2026-05-13 | [2026-05-13-mask-as-reference-hint.md](2026-05-13-mask-as-reference-hint.md) | 1.x Option X (mask = hint) | [#29](https://github.com/CocoRoF/geny-avatar/pull/29) | done |
| 2026-05-13 | [2026-05-13-inpaint-oversized-frame.md](2026-05-13-inpaint-oversized-frame.md) | 1.x oversized frame | [#28](https://github.com/CocoRoF/geny-avatar/pull/28) | done |
| 2026-05-13 | [2026-05-13-falai-flux-pro-fill.md](2026-05-13-falai-flux-pro-fill.md) | 1.x FLUX pro fill | [#27](https://github.com/CocoRoF/geny-avatar/pull/27) | done |
| 2026-05-13 | [2026-05-13-openai-inpaint-path.md](2026-05-13-openai-inpaint-path.md) | 1.x OpenAI inpaint | [#26](https://github.com/CocoRoF/geny-avatar/pull/26) | done |
| 2026-05-13 | [2026-05-13-inpaint-source-padding-and-prompt.md](2026-05-13-inpaint-source-padding-and-prompt.md) | 1.x char hallucination | [#25](https://github.com/CocoRoF/geny-avatar/pull/25) | done |
| 2026-05-13 | [2026-05-13-mask-roundtrip-and-preview.md](2026-05-13-mask-roundtrip-and-preview.md) | 1.x mask roundtrip | [#24](https://github.com/CocoRoF/geny-avatar/pull/24) | done |
| 2026-05-13 | [2026-05-13-embedded-mask-format-and-context.md](2026-05-13-embedded-mask-format-and-context.md) | 1.x inpaint convention | [#23](https://github.com/CocoRoF/geny-avatar/pull/23) | done |
| 2026-05-13 | [2026-05-13-fix-decompose-wrapper-remount-loop.md](2026-05-13-fix-decompose-wrapper-remount-loop.md) | 1.x crash fix | [#22](https://github.com/CocoRoF/geny-avatar/pull/22) | done |
| 2026-05-13 | [2026-05-13-embedded-hide-split-paint.md](2026-05-13-embedded-hide-split-paint.md) | 1.x mode hide | [#21](https://github.com/CocoRoF/geny-avatar/pull/21) | done |
| 2026-05-13 | [2026-05-13-decompose-embedded-in-mask-tab.md](2026-05-13-decompose-embedded-in-mask-tab.md) | 1.x MASK = DecomposeStudio | [#20](https://github.com/CocoRoF/geny-avatar/pull/20) | done |
| 2026-05-13 | [2026-05-13-mask-tab-full-features.md](2026-05-13-mask-tab-full-features.md) | 1.x MASK full | [#19](https://github.com/CocoRoF/geny-avatar/pull/19) | done |
| 2026-05-13 | [2026-05-13-mask-tab-fixes.md](2026-05-13-mask-tab-fixes.md) | 1.x MASK fixes | [#18](https://github.com/CocoRoF/geny-avatar/pull/18) | done |
| 2026-05-13 | [2026-05-13-generate-mask-tab.md](2026-05-13-generate-mask-tab.md) | 1.x MASK tab UI | [#17](https://github.com/CocoRoF/geny-avatar/pull/17) | done |
| 2026-05-13 | [2026-05-13-inpaint-mask-from-source-alpha.md](2026-05-13-inpaint-mask-from-source-alpha.md) | 1.x ControlNet f/u | [#16](https://github.com/CocoRoF/geny-avatar/pull/16) | done |
| 2026-05-13 | [2026-05-13-falai-inpainting-model.md](2026-05-13-falai-inpainting-model.md) | 1.x ControlNet | [#15](https://github.com/CocoRoF/geny-avatar/pull/15) | done |
| 2026-05-13 | [2026-05-13-phase1-3-verification-result.md](2026-05-13-phase1-3-verification-result.md) | 1.3 검증 결과 | [#14](https://github.com/CocoRoF/geny-avatar/pull/14) | done |
| 2026-05-13 | [2026-05-13-falai-no-character-features.md](2026-05-13-falai-no-character-features.md) | 1.4 hotfix (3rd) | [#13](https://github.com/CocoRoF/geny-avatar/pull/13) | done |
| 2026-05-13 | [2026-05-13-falai-skip-canonical-ref.md](2026-05-13-falai-skip-canonical-ref.md) | 1.2/1.4 hotfix | [#12](https://github.com/CocoRoF/geny-avatar/pull/12) | done |
| 2026-05-13 | [2026-05-13-falai-prompt-scaffold.md](2026-05-13-falai-prompt-scaffold.md) | 1.4 follow-up | [#11](https://github.com/CocoRoF/geny-avatar/pull/11) | done |
| 2026-05-12 | [2026-05-12-fix-jobs-map-singleton.md](2026-05-12-fix-jobs-map-singleton.md) | infra hotfix | [#10](https://github.com/CocoRoF/geny-avatar/pull/10) | done |
| 2026-05-12 | [2026-05-12-phase1-4-fix-fal-status-405.md](2026-05-12-phase1-4-fix-fal-status-405.md) | 1.4 hotfix | [#9](https://github.com/CocoRoF/geny-avatar/pull/9) | done |
| 2026-05-12 | [2026-05-12-phase1-closure.md](2026-05-12-phase1-closure.md) | 1 (closure) | [#8](https://github.com/CocoRoF/geny-avatar/pull/8) | done |
| 2026-05-12 | [2026-05-12-phase1-5-router.md](2026-05-12-phase1-5-router.md) | 1.5 | [#7](https://github.com/CocoRoF/geny-avatar/pull/7) | done |
| 2026-05-12 | [2026-05-12-phase1-4-falai-provider.md](2026-05-12-phase1-4-falai-provider.md) | 1.4 | [#6](https://github.com/CocoRoF/geny-avatar/pull/6) | done |
| 2026-05-12 | [2026-05-12-phase1-6-cubism-prompt.md](2026-05-12-phase1-6-cubism-prompt.md) | 1.6 | [#4](https://github.com/CocoRoF/geny-avatar/pull/4) | done |
| 2026-05-12 | [2026-05-12-phase1-2-canonical-pose.md](2026-05-12-phase1-2-canonical-pose.md) | 1.2 | [#3](https://github.com/CocoRoF/geny-avatar/pull/3) | done |
| 2026-05-12 | [2026-05-12-phase1-1-mask-erosion.md](2026-05-12-phase1-1-mask-erosion.md) | 1.1 | [#2](https://github.com/CocoRoF/geny-avatar/pull/2) | done |
| 2026-05-12 | [2026-05-12-bootstrap.md](2026-05-12-bootstrap.md) | 0 (셋업) | [#1](https://github.com/CocoRoF/geny-avatar/pull/1) | done |
