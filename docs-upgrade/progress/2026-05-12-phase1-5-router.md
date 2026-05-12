# 2026-05-12 Phase 1.5 — Provider routing module 신설 (호출 지점은 Phase 3에서)

**Phase / 작업**: Phase 1 작업 5 (Provider routing 규칙)
**상태**: done — 모듈 신설 완료. GeneratePanel 본격 연결은 Phase 3
오케스트레이터 도입 시 함께 진행.
**관련 계획**: [../plan/01-Phase1.md](../plan/01-Phase1.md) 작업 5

## 변경

- **신설** [lib/ai/router.ts](../../lib/ai/router.ts) — 순수 함수
  `routeProvider(ctx): RoutingDecision`. 입력 descriptor 기반 provider
  선택 + 사유(reason) 반환.
  - 룰:
    1. `userPick`이 있으면 그대로 반환 (router 우회).
    2. `isBulkFanout` 또는 `drawableCount >= 4`이면 falai 선호,
       fallback openai.
    3. 단일 drawable + `isDecisive`이면 openai (literal).
    4. default → openai → gemini → falai → replicate 순 fallback.
  - `availableSetFromList(...)` 헬퍼 — `/api/ai/providers` 응답을
    `Set<ProviderId>`로 변환.

## 검증

- `pnpm typecheck` ✓
- `pnpm exec biome check lib/ai/router.ts` ✓
- 단위 테스트: 아직 인프라 없음. Phase 2 작업 들어가면서 eval/runner
  와 함께 단위 테스트 골격 구축 예정.

## 결정 (가장 중요한 의사결정)

**모듈만 신설하고 GeneratePanel은 안 건드림.** 이유:

1. Phase 1 GeneratePanel에선 user가 picker에서 provider를 명시 선택
   한다. router를 끼우면 "openai 골랐는데 자동으로 falai로 갈아치워
   진다" surprise 발생.
2. router의 진짜 효용은 **Phase 3 orchestrator**의 per-drawable 호출
   루프에서 자동 라우팅. anchor + 직후 1-2개 = openai (literal),
   fan-out 나머지 = falai (cheap). 그 흐름에선 user pick이 의미
   없어지므로 router 작동에 자연스러움.
3. picker에 "Auto" 옵션을 추가해서 user가 명시 선택 시 router 우회
   하는 방법도 있지만 그건 UI 변경 + 새 mental model. Phase 1 범위
   외.

요약: Phase 1 ship criteria의 "Provider routing rule: gpt-image-2
default, FLUX bulk fan-out"은 **부분 충족**. 룰 정의 + 모듈은 ship,
실제 호출 지점은 Phase 3로 연기. 진행 로그에 명시.

## 영향

- 코드: 한 파일 신설, 어디서도 호출 안 됨 (dead until Phase 3).
- UX: 변화 없음. GeneratePanel은 그대로.
- Phase 3 orchestrator 작업 시 첫 작업이 "router 호출 연결". 그때 본격
  검증.

## 다음 작업

[../plan/01-Phase1.md](../plan/01-Phase1.md) 작업 7 (progress UI for
multi-call sequences) 또는 작업 3 (Canny silhouette, optional). Phase 1
주요 작업 6개 중 1.1 / 1.2 / 1.4 / 1.5 / 1.6 완료. 1.3 + 1.7 남음.

## 참조

- 손댄 파일 1개: `lib/ai/router.ts` (신설).
- PR: 이 entry가 포함된 PR이 머지될 때 main에 들어감.
