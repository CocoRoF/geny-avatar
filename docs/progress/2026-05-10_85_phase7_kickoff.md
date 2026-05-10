# 2026-05-10 — Phase 7 Kickoff: Polish & V1 Release

[`07 phased_roadmap`](../plan/07_phased_roadmap.md) 의 Phase 7 — 첫 외부 시연 가능한 상태. Phase 5 (gpt-image-2) + Phase 6 (Decompose Studio Pro) 끝나고 그 위로 한 사람이 처음 손에 잡고 안 헷갈리게 만드는 단계.

## 컨텍스트

내부 사용 (= 사용자 본인) 은 이미 거의 모든 핵심 기능 검증됨:
- gpt-image-2 multi-region focus mode
- DecomposeStudio split mode + SAM 통합
- Per-region revert / history
- Modal close guards / 사이즈

남은 건 "처음 만나는 사람이 손에 잡고 5분 안에 흐름 파악" — discoverability + clarity.

## Sub-sprint 분할

각 atomic PR. 사용자 검증 후 다음 진입.

### Sprint 7.1 — Help & Shortcuts modal (?)

editor 헤더에 `?` 버튼 + modal:
- 키보드 단축키 (Cmd/Ctrl+Z, Shift+Z, R, Esc 등)
- 워크플로 안내 ("decompose → generate → apply")
- 패널 한 줄 설명 (Layers / Variants / References / Tools)

`?` 키 입력으로 토글 가능. discoverability 의 1차 진입점.

### Sprint 7.2 — Onboarding hint cards

처음 editor 진입 시 small dismissable hint cards:
- "click a layer thumbnail to open Decompose"
- "click ✨ generate next to a layer for AI texture replacement"
- "References affect how generation interprets style"

`localStorage` 에 dismissed 상태 보관 — 두 번째 진입부터 안 뜸. "show onboarding again" 버튼은 help modal 안에.

### Sprint 7.3 — 에러 메시지 한국어화

운영자 = 한국어 사용자. 현재 모든 에러/info 영어 (debugging 편의용). polish 단계에서 user-facing 영역만 한국어로:
- API 실패 reason
- 라이브러리 / 업로드 에러
- generation timeout / refine 실패
- 빈 상태 메시지

dev console 의 structured log 는 영어 유지 (디버깅).

### Sprint 7.4 — 라이선스 / attribution 명확화

- Spine runtime / Cubism runtime / SDK license 가 export 될 때 LICENSE.md 에 명시되는 건 [`progress 45`](2026-05-07_45_sprint_4_4_export_zip.md) 에 이미. 추가:
- `/poc/library` 카드 옆 작은 "i" → 자산의 origin / license 표시
- footer 에 third-party 표시 ("Spine v4 runtime by Esoteric Software · Cubism Engine 1.1 by Live2D Inc")
- README 내 별도 section

### Sprint 7.5 — README + landing copy

- repo `README.md` 갱신 (현재 부트스트랩 후 미터치)
- `/` (home) 의 카피 — 현재 텍스트만 placeholder. 한국어 + 영어 mix
- `/poc/library` 의 빈 상태 메시지 좀 더 친화적

### Sprint 7.6 — 성능 최적화

목표: 첫 페인트 1.5s. profiling 후 상위 N개 핫스팟:
- Pixi 초기화 / 텍스처 업로드
- IDB hydrate (특히 큰 puppet)
- 큰 atlas 페이지 디코드
- React render flame (DevTools profiler)

수단:
- code split / dynamic import
- 텍스처 lazy decode
- worker offload (필요 시)

가장 마지막에 진행 — 다른 sprint 들이 끝나야 perf baseline 명확.

## 의도적 한계

- **베타 사용자 5명 피드백**: Phase 7 의 외부 검증은 사용자가 hobbyist 라 일단 본인 검증 + (가능하면) 친구 1~2 명 으로 단순화. 5명 실명 베타는 launch 단계에 가까움.
- **Performance budget 1.5s**: 정확한 측정 도구 (Lighthouse / Vercel Web Vitals) 셋업은 7.6 와 함께. 일단 체감 + DevTools profiler.
- **Onboarding 의 디자인 polish**: hint card 디자인 / 카피 / 애니메이션 등 디테일은 매크로 시각 검증 후. 일단 기능적 minimum.
- **i18n 라이브러리 도입 X**: 한국어화 가 1차 — react-intl / next-intl 같은 framework 안 깖. 텍스트 직접 한국어로 (영문 fallback 없음). 향후 영어 사용자 로컬라이즈 필요 시 framework 추가.

## 진행 추적

| Sprint | 주요 작업 | 상태 |
|---|---|---|
| 7.1 | Help & Shortcuts modal | 대기 |
| 7.2 | Onboarding hint cards | 대기 |
| 7.3 | 에러 한국어화 | 대기 |
| 7.4 | 라이선스 / attribution | 대기 |
| 7.5 | README + landing copy | 대기 |
| 7.6 | 성능 최적화 | 대기 |

## 다음 단계

Sprint 7.1 — Help & Shortcuts modal 부터. discoverability 의 1차 진입점이라 가장 빠르게 "사용자가 무엇을 할 수 있는지" 명시 가능.
