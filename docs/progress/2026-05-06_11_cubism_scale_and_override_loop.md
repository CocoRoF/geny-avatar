# 2026-05-06 — Cubism: scale fit + motion-resistant part toggle

## 두 문제

1. **캐릭터가 너무 크게 출력**. 스크린 일부 잘림. 우리 코드는 `scale = (screenH * 0.9) / 1500` — 1500이 Hiyori의 native height라고 임의 가정했으나 사실은 더 작거나, untitled-pixi-live2d-engine의 Live2DModel이 자체 internal scale로 이미 큰 상태라 곱하기가 거대하게 만듦.

2. **hide all 해도 part가 안 사라짐**. 우리는 `coreModel.setPartOpacity(idx, 0)`을 한 번만 호출. Cubism motion이 매 프레임 parameter graph로 part opacity를 다시 계산해 우리 값을 덮어씀.

## 수정 1 — Scale: native 사이즈로 fit-to-canvas

`Live2DAdapter.getNativeSize()` — `internalModel.layout` 또는 `canvasInfo`에서 native canvas 크기 추출. 둘 다 없으면 engine display의 `width`/`height` (이미 pixi 좌표) fallback. 그래도 0이면 800×1200 sane default.

PoC 페이지가 받아 fit:

```ts
const native = adapter.getNativeSize();
const baseW = native.width, baseH = native.height;
const factor = Math.min((screenW * 0.9) / baseW, (screenH * 0.9) / baseH);
display.scale.set(factor);
```

또 anchor 처리 — Live2DModel이 `anchor.set`을 노출하면 (0.5, 0.5)로 중앙 정렬. 안 노출하면 `pivot.set(baseW/2, baseH/2)`로 fallback. 그러고 `position.set(centerX, centerY)`.

scale.set 호출 전 `display.scale.set(1)`로 reset — engine이 internal scale을 이미 적용한 경우에 이중 곱셈 방지.

## 수정 2 — Hide all: RAF override loop

`Live2DAdapter`에 `partOpacityOverrides: Map<index, value>` 추가. `setLayerVisibility` 호출 시 즉시 `setPartOpacity` 한 번 + Map에 등록. 그리고 `requestAnimationFrame` 루프가 매 프레임 모든 override를 다시 적용:

```ts
private ensureOverrideLoop() {
  if (this.rafHandle != null) return;
  const tick = () => {
    for (const [index, value] of this.partOpacityOverrides) {
      this.coreModel.setPartOpacity(index, value);
    }
    this.rafHandle = requestAnimationFrame(tick);
  };
  this.rafHandle = requestAnimationFrame(tick);
}
```

Pixi ticker도 RAF 위에서 도므로 같은 RAF 사이클 안에서 우리 override가 motion update 결과를 덮어쓰는 효과 — 다음 frame이 그려질 때 우리 값이 마지막 적용된 part opacity가 됨. `destroy()`에서 `cancelAnimationFrame` + Map 클리어.

## 어댑터 인터페이스 변동

없음. 두 변경은 모두 Live2DAdapter 내부.

## 검증

- typecheck: 0
- lint: 1 format auto-fix → 0
- build: 통과 (`/poc/cubism` 2.5KB / 273KB First Load — fitLive2DModel 로직 추가로 미미한 증가)

## 한계 / 미해결

- `getNativeSize()`의 fallback 체인 — engine 빌드에 따라 internalModel.layout이 없으면 sane default (800×1200)로 떨어짐. 진짜 모델 크기와 다를 수 있음. 시각으로 어색하면 여기서 더 정교화.
- RAF 루프는 모션이 part opacity를 건드릴 때만 의미 있음. 다른 모델이 part opacity를 모션에 안 쓴다면 루프가 약간 wasteful — 그래도 frame당 < N 회 setPartOpacity는 비싼 작업이 아니니 OK.
- Drawable 단위 visibility도 나중에 같은 패턴 (`drawableOpacityOverrides`) 적용 가능. 지금 V1은 part 단위.

## 다음

시각 확인 OK이면 Phase 1.3 — drag-drop 업로드 흐름.
