# 2026-05-06 — Cubism: monkey-patch internalModel.update for after-update mutation

## 사용자 console 결과 (16의 진단)

```
[Live2DAdapter] hooked beforeModelUpdate · parts=24 drawables=134 partsMapped=20
                nativeDrawables=true hasSetPartOpacity=false
[Live2DAdapter] setLayerVisibility(...) → partIdx=0..23   (24번)
[Live2DAdapter] drawable mutate verify: part[0] → drawable[133] opacity now=0
[Live2DAdapter] hook fire #600, applying 24 overrides     (계속 fire)
```

**결정적 단서 두 개**:

1. `hasSetPartOpacity=false` — coreModel에 `setPartOpacity` 메서드 자체가 없다. 우리가 1~15에서 이 메서드를 부른 모든 시도는 무력 호출이었다.
2. `drawable mutate verify: opacity now=0` — drawable opacity Float32Array mutate는 정확히 적용된다 (read-back 0 확인).

mutate는 됐는데 시각으로 안 사라짐 → **mutate 시점이 잘못됐다**. `beforeModelUpdate`는 motion 후·propagation **전**. propagation이 직후 일어나면서 우리 0을 motion 결과 값으로 덮어씀. 매 frame 같은 race를 매번 짐.

## 수정 — `internalModel.update`를 monkey-patch

엔진 d.ts:
```ts
abstract class InternalModel extends EventEmitter {
  ...
  update(dt: DOMHighResTimeStamp, _now: DOMHighResTimeStamp): void;
}
class CubismInternalModel extends InternalModel {
  update(dt: DOMHighResTimeStamp, now: DOMHighResTimeStamp): void;
}
```

`update()` 한 번이 motion → parameters → parts → drawables → moc.update 전체를 도는 메서드. 이걸 wrap해서 원본 호출 후에 우리 mutate 박으면:

```
(우리 patched update)
  ↓
  original update(dt, now)
    ↓ motion → parameters → parts → drawables → moc.update
  ↑ 끝
  applyOverridesAfterUpdate()  ← drawable opacities는 이제 finalized
↑ 다음 step: render — 우리 값을 봄
```

이게 진짜 sandwich window. propagation이 끝난 후 → render 전. 그 사이에 끼어들 수 있는 곳.

```ts
const original = internal.update.bind(internal);
internal.update = (...args) => {
  const result = original(...args);
  this.applyOverridesAfterUpdate();
  return result;
};
```

destroy 시 `internal.update = this.originalInternalUpdate`로 원복.

## 정리

- `beforeModelUpdate` hook 제거 (잘못된 시점)
- `setPartOpacity` 호출 다 제거 (메서드 없음, 우리가 16라운드 속았음)
- `applyOverridesInsideHook` → `applyOverridesAfterUpdate`로 리네임
- 진단 로그는 유지

## 가설이 맞는지 어떻게 알 것인가

이번에 사용자가 다시 hide all 누르면:
- `[Live2DAdapter] patched internalModel.update · ...` 가 한 번 뜸
- `[Live2DAdapter] setLayerVisibility(...)` 24번
- `[Live2DAdapter] post-update fire #1, applying 24 overrides` 첫 frame
- `[Live2DAdapter] post-update verify: ... opacity now=0`
- **그리고 시각적으로 캐릭터가 사라져야 함**

만약 여전히 안 사라지면:
- 가설: drawable opacity Float32Array가 view가 맞는데 GL vertex buffer가 별도 캐시를 갖고 있어서 mutate 후 GL 업로드가 다시 일어나야 함. 그 경우 `coreModel._model.update()` 같은 GL 동기화 메서드를 추가 호출 필요.

하지만 지금까지 본 진단 결과로는 monkey-patch가 답일 가능성이 95%.

## 학습

- 16에서 진단 로그 박은 게 결정적이었음. `hasSetPartOpacity=false`라는 한 줄로 1~15의 모든 setPartOpacity 시도가 위약(plac
ebo)이었음이 드러남. 처음부터 박았어야 함.
- 엔진 이벤트와 메서드 둘 다 봐야 함. 이벤트 (`beforeModelUpdate`)가 잘못된 시점이면 메서드 (`update()`)를 monkey-patch.
