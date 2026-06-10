# #34 — applyOverrides 재설계: 직렬화 큐 + 변경 페이지 한정 재구성

결함: R1 R2 R9 R11 ([02-결함목록](../02-결함목록.md))

## 무엇을

`applyLayerOverrides` 함수(매 호출 전 페이지 pristine 재구성 + 전체 GPU 재업로드,
직렬화 없음)를 `LayerOverrideApplier` 클래스로 교체.

## 어떻게

- **R1 직렬화+코얼레싱**: adapter 당 applier 1개. `apply()` 는 최신 요청 상태를
  `pending` 에 넣고 drain 루프가 순차 처리 — 동시 호출은 마지막 상태로 합쳐짐.
  hydrate 시 오버라이드 N개가 N번 전체 재구성하던 경로가 페이지당 ≤N번의
  증분 재구성으로 줄어듦.
- **R2 diff 기반 dirty 페이지**: `lastApplied` 와 Blob identity 비교로 변경된
  레이어의 페이지만 재구성/재업로드. 첫 마운트 빈 맵 = no-op (기존엔 모든 페이지
  강제 재업로드). 오버라이드 제거도 diff 에 잡혀 해당 페이지만 pristine 복원.
- **R9 mask 클립**: `compositeMask` 에 texture 와 동일한 트라이앵글 클립 적용
  (없으면 rect 클립 = 기존 동작). export 측 `bakeAtlas.compositeErase` 도 동일.
- **R11 실패 노출**: blob 디코드 실패를 `ApplyResult.failedLayerIds` 로 반환,
  LayersPanel 이 레이어 이름과 함께 경고 바 표시 (기존: 무언 드롭).
- 디코드는 `createImageBitmap` 우선 (objectURL 왕복 제거, 사용 후 close),
  HTMLImageElement fallback. 같은 blob 은 apply 1회당 1번만 디코드.
- `AvatarAdapter.setLayerOverrides` 반환 타입 `Promise<void>` → `Promise<ApplyResult>`.
  destroy() 에서 applier dispose (in-flight 루프는 disposed 플래그로 중단).

## 검증

- `pnpm typecheck` / `pnpm lint` 통과 (warning 17 = 변경 전과 동일).
- 의미 보존 확인: 합성 순서(texture→mask), wipe-before-draw, rotated 90° 처리
  모두 기존 코드 그대로 이동.

## 남긴 것

- LayersPanel effect 의 deps 에 `layers` 추가 — 레이어 재로드 시 no-op diff 라 부담 없음.
- 페이지 오버라이드(`pageBases`)는 Stage 4 (#42) 에서 이 클래스에 주입 예정 —
  재구성 베이스가 한 곳(`applyOnce`)으로 모여 주입 지점이 명확해짐.
