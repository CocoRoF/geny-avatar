# 2026-05-10 — Post-Phase 8: 캔버스 viewport (pan/zoom) + intrinsic 분리

[Phase 8 plan](../plan/09_editor_animation_tab.md) 의 후속 fix. 사용자 보고 두 가지 동시 처리:

1. **Animation 탭 진입 시 puppet 이 너무 크게 렌더링** — DisplaySection 의 `display.scale = baseFactor * kScale` 직접 mutation 이 PuppetCanvas 의 초기 fit 결과를 덮어씀. baseFactor 가 두 곳에서 따로 계산되어 mismatch 가능.
2. **Edit / Animation 두 탭 모두 캔버스에 zoom + pan 필요** — 기존 동작에는 viewport 컨트롤 없음.

## 변경 surface

### `lib/store/viewport.ts` (신규)

```ts
type ViewportState = {
  baseFactor: number | null            // 한 번 set, 나머지는 read
  userZoom: number                      // wheel zoom (transient)
  userPan: { x: number; y: number }     // drag pan (transient)
  intrinsic: { kScale, shiftX, shiftY } // IDB 영속 + Geny export
  setBaseFactor / setUserZoom / setUserView / setUserPan / setIntrinsic
  reset()  resetUserView()
}
```

`userZoom` × `intrinsic.kScale` 두 layer 가 합성됨. user는 viewport 편의용 (export X), intrinsic 은 Geny 가 받는 puppet 기본 transform.

### `components/PuppetCanvas.tsx` (전면 재작성)

이전: `usePuppet` mount 후 `fitDisplayObject` 단일 호출.

이후:
- Pixi mount 시 baseFactor 계산 + viewport store 에 저장.
- viewport store subscribe → 변경 시 `applyTransform` 호출:
  ```
  display.scale = baseFactor × userZoom × intrinsic.kScale
  display.position = canvas_center + userPan + intrinsic.shift
  ```
- pointer events:
  - `pointerdown` (left button) → drag start
  - `pointermove` → setUserPan (DPR-aware delta).
  - `pointerup/cancel` → drag end, capture release.
- wheel event → cursor-pivoted zoom (이전 Live2DCanvas 의 패턴 그대로).
- `input === null` 또는 puppet 변경 → `viewport.reset()`.
- `MIN_USER_ZOOM=0.2, MAX_USER_ZOOM=5` 클램프.
- baseFactor fallback 체인 강화 — `getNativeSize().width` → `display.width` → `800` (이전엔 `getNativeSize` 의 음수/0 가능성 무시. 현재 `pickPositive` 헬퍼로 양수만).

### `components/animation/DisplaySection.tsx` (단순화)

- 이제 display 직접 mutate 안 함. Pixi Application/adapter prop 제거.
- `setIntrinsic({ kScale, shiftX, shiftY })` 만 호출 → PuppetCanvas 의 subscriber 가 알아서 적용.
- 새 버튼 `fit` (확대/이동만 reset) + 기존 `reset` (전체 reset) 구분.
- 마지막에 사용 가이드 한 줄 ("드래그=이동 / 휠=확대축소").
- **DEFAULTS.kScale 0.7 → 1.0**: editor 첫 진입 시 puppet 이 fit-to-canvas 그대로 — Geny 가 받는 값 = 사용자 보는 값 (mental model 일치).

### `lib/avatar/usePuppetAnimationConfig.ts`

- DEFAULTS.kScale 0.7 → 1.0 동일 이유. 신규 puppet 의 IDB 디폴트도 1.0.

### `components/animation/AnimationPanel.tsx`

- DisplaySection 호출 시 adapter / app prop 제거 (DisplaySection 더 이상 안 받음).

## Architecture 개요

```
User scroll wheel / drag
       ↓
PuppetCanvas event handler → useViewportStore.setUserZoom / setUserPan
                                       ↓ (subscribe)
                                applyTransform()
DisplaySection slider
       ↓
useViewportStore.setIntrinsic
                                       ↓ (subscribe)
                                applyTransform()  ← 같은 함수, 같은 합성
                                       ↓
                              display.scale / position
```

두 input 이 같은 store 의 다른 키를 만지고, 한 subscriber 가 합성 후 single source 로 적용.

## 의도적 한계

- **Spine 의 intrinsic 미사용**: animation 탭이 Live2D 만이라 Spine 의 baseFactor 는 fixed 0.5, intrinsic 은 무시. pan/zoom 자체는 Spine 도 동작.
- **viewport 영속 X**: pan/zoom 은 transient — puppet swap 시 reset. 새로고침 시도 reset. intrinsic 만 IDB.
- **double-pivot risk**: Cubism puppet 의 anchor 를 (0.5, 0.5) 에 한 번만 설정. 일부 engine version 에서 anchor.set 이 nop 일 수 있는데 그땐 pivot 으로 fallback. 동일 puppet 에서 두 lifecycle 안에 anchor 가 다시 설정될 일은 없음 (mount 한 번).
- **canvas 외부 wheel 무시**: `host` 에만 listener. body 전체에 넣으면 페이지 스크롤 차단 위험.

## 검증

- `pnpm typecheck` 통과
- `pnpm lint:fix` 통과 (formatting 자동)
- `pnpm build` 통과
- 시각 검증 (사용자 측):
  1. `/edit/builtin/hiyori` → 캔버스 드래그 → puppet 따라 이동 ✓
  2. 캔버스 휠 → 커서 기준 확대/축소 ✓
  3. animation 탭 진입 → 첫 화면이 fit-to-canvas (이전엔 zoom 됨)
  4. kScale 슬라이더 → puppet 즉시 크기 변화 (zoom 과 합성)
  5. fit 버튼 → 확대/이동만 reset, kScale 유지
  6. reset 버튼 → 모두 디폴트
  7. tab 전환 → viewport state 유지 (편의)
  8. puppet 전환 → viewport reset

## 다음

다른 사용자 피드백 대응 또는 Phase E (검증/폴리시) 로 넘어가서 docs / 회귀 테스트 정리.
