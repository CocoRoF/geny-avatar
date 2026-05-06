# 2026-05-06 — Cubism: hook into engine's beforeModelUpdate event

## 처음부터 다시 진단

지난 4번의 시도 (11~14)는 다 같은 가정에서 출발했다 — "우리 RAF나 Pixi ticker에서 mutate하면 motion 결과를 덮어쓸 수 있다". 그게 사실이라면 어딘가에서 작동했어야 하는데 사용자 시각 검증에서 모두 무효. 즉 **타이밍 가정 자체가 틀림**.

엔진 타입 정의를 직접 까서 확인:
- `node_modules/untitled-pixi-live2d-engine/types/index.d.ts:3744` — `InternalModelEvents` 인터페이스
- 엔진이 명시적으로 노출하는 lifecycle 이벤트 4개:
  - `beforeMotionUpdate` — 모션이 parameter 쓰기 직전
  - `afterMotionUpdate` — 모션이 parameter 쓴 직후
  - `beforeModelUpdate` — parameters → parts → drawables propagation 직전
  - `destroy`

**`beforeModelUpdate`가 정답**. 이 시점:
- motion이 parameters에 다 썼다 (afterMotionUpdate 후)
- moc.update() 호출이 아직 안 됐다 (drawable opacities 미갱신)
- 우리가 setPartOpacity 호출하면 → 곧이어 일어나는 propagation이 우리 part opacity를 drawable opacity로 변환 → render에 반영

이전 시도들이 왜 안 통했는지:
- **RAF / Pixi ticker LOW priority**: 엔진의 update가 `Live2DModel._render()` 안에서 호출됨. 우리 ticker callback이 "model.update 후"가 아니라 "model.update 전"에 도는 효과. 매 frame motion이 우리 mutate를 즉시 덮어씀.
- **drawable opacities 직접 mutate**: opacities Float32Array가 실제로 view지만, 다음 frame 시작 즈음 motion update가 part opacity → drawable opacity 다시 propagate해서 우리 mutate를 깨끗이 덮어씀.
- **dynamicFlags IsVisible bit**: 같은 이유로 매 frame 새로 계산됨.

이 모든 우회는 엔진의 update 스케줄을 잘못 가정한 결과. 엔진이 노출한 이벤트를 쓰는 게 정공법이었음.

## 수정

`Live2DAdapter.load()` 마지막에:

```ts
internal.on("beforeModelUpdate", () => {
  for (const [partIdx, value] of this.partOpacityOverrides) {
    coreModel.setPartOpacity(partIdx, value);
  }
});
```

매 frame 자동으로:
1. (engine) motion → parameters
2. (engine) afterMotionUpdate fires
3. (engine) **beforeModelUpdate fires** → 우리 setPartOpacity 적용
4. (engine) parameters → parts → drawables propagation (우리 part opacity가 drawables로 흘러감)
5. (engine) render

## 정리 — 죽은 코드 제거

이전 시도의 잔재 (12·13·14)를 정리:
- `partToDrawables` Map (drawable 단위 mutation 안 씀)
- ancestor chain 빌드 로직
- `getNativeDrawables` / `getNativeParts` helper
- RAF 루프 + `ensureOverrideLoop`
- Pixi `Ticker` `attachToTicker` (인터페이스에서도 제거 — 사용자 없음)
- dynamicFlags / Float32Array 직접 mutate
- usePuppet의 `attachToTicker` 호출

`Live2DAdapter`가 다시 short해짐. 의도가 한 곳에 모임.

## 검증

- typecheck/lint/build 통과
- `setLayerVisibility`도 한 번 setPartOpacity 동기 호출해서 첫 frame UI feedback 확보 (그 다음 frame부터는 event handler가 매 frame 강제)

## 학습

엔진의 lifecycle event를 먼저 찾아봤어야 했다. d.ts 한 줄에 답이 있었음:
```ts
afterMotionUpdate - Triggered after all motion updates are completed.
beforeModelUpdate - Before the model is updated with its parameters applied.
```

다음 비슷한 막힘에서 — **"엔진이 무슨 이벤트를 emit하는가?"가 첫 질문**.

## 다음

이번엔 진짜 작동해야 한다. show all / hide all → 캐릭터 부위 사라지고 다시 나타남.
