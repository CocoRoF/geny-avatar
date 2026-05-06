# 2026-05-06 — Cubism native handle fallback for hide-all

## 진단

직전 12에서 RAF 루프를 drawable opacity 직접 mutate로 바꿨지만 사용자 시각 검증에서 여전히 hide all 무효. Pixi 캐릭터 그대로, 사이드바 24개 part 점만 회색 (React state는 모두 hidden).

가장 의심되는 원인: **`coreModel.getDrawableParentPartIndex(d)`가 untitled-pixi-live2d-engine 빌드에서 안 노출되거나 -1 반환**. 그러면 load() 시 `partToDrawables` 맵이 비게 되고 RAF 루프는 mutate할 drawable 리스트를 찾지 못해 효과 0.

또 의심: **`getDrawableOpacities()` wrapper 메서드가 view 대신 사본을 반환**. 그 사본을 mutate해도 모델 내부 상태가 안 바뀜.

## 수정 — Live2DCubismCore native handle 직접 접근

Cubism Framework의 wrapper(`CubismModel`) 내부에는 native `Live2DCubismCore.Model` 인스턴스가 있고, 거기엔 typed array 직접 노출:

```
nativeModel.drawables.opacities          : Float32Array (view, mutate 가능)
nativeModel.drawables.parentPartIndices  : Int32Array
nativeModel.parts.parentIndices          : Int32Array
```

엔진/래퍼 버전에 따라 native handle 위치가 다르므로 fallback 체인:

```ts
function getNativeDrawables(coreModel) {
  for (const c of [
    coreModel._model?.drawables,
    coreModel.model?.drawables,
    coreModel._coreModel?._model?.drawables,
    coreModel.drawables,
  ]) {
    if (c?.opacities) return c;
  }
  return null;
}
```

`getNativeParts`도 동일 패턴.

`load()`의 ancestor chain 빌드, `RAF` 루프의 opacities mutate 모두 native typed array 우선, wrapper 메서드 fallback. 둘 다 실패하면 마지막 수단으로 `setPartOpacity` (motion에 짐).

## 진단 로그

부팅 시 한 번 콘솔에 출력:
```
[Live2DAdapter] partToDrawables: <N> parts mapped (drawables=<D>, parts=<P>, native=true|false)
```

- `parts mapped` 0이면 → ancestor 매핑 실패 = parentPartIndices 못 읽음 = native handle 위치 추가 탐색 필요
- `native=false`면 → fallback path로 떨어진 상태, opacities mutate 못 했을 수 있음

이 로그가 사용자 console에 뭐라 찍히는지에 따라 다음 단계 결정.

## 검증

typecheck/lint/build 통과. 사이즈 변동 미미. 시각 검증은 사용자 브라우저 + console.

## 다음

- 시각 OK + native=true이면 → Phase 1.3 진입
- native=false이면 → 사용자 console 출력으로 coreModel의 정확한 shape 파악, 추가 candidate path 추가
- native=true인데 hide 무효이면 → opacities가 view가 아닐 가능성, 또는 model.update가 우리 RAF 후에 호출되는 timing 이슈. 그 경우 attached ticker priority로 대응.
