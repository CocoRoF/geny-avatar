# 2026-05-06 — Cubism ID Handle Coercion

## 문제

`/poc/cubism` 시각 검증 시 React 런타임 에러:

```
Objects are not valid as a React child (found: object with keys {_id}).
```

## 원인

Live2D Cubism Core의 `getPartId(i)` / `getParameterId(i)`는 **`CubismIdHandle` 객체**를 반환한다 — `{_id: string, getString(): string}` 형태. 우리는 그걸 `string`으로 가정하고 그대로 `Layer.externalId` / `Layer.name` / `Parameter.id`에 넣었다. 도메인 객체는 문제없이 만들어지지만 React가 이름을 렌더링하려 할 때 `<span>{layer.name}</span>` → 객체를 children으로 받게 되어 폭발.

엔진(`untitled-pixi-live2d-engine`)의 `setParameterValueById` 같은 API는 string·handle 둘 다 받기 때문에 도메인에서 string으로 통일하는 게 자연스럽다.

## 수정

`lib/adapters/Live2DAdapter.ts`에 어댑터 경계 변환 헬퍼:

```ts
function coerceCubismId(value: unknown, fallback: string): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    if (typeof v.getString === "function") return v.getString();
    if (typeof v._id === "string") return v._id;
    if (typeof v.id === "string") return v.id;
  }
  return fallback;
}
```

`getString()`을 우선 사용 (공식 API). 메서드가 빠진 빌드를 대비해 `_id`/`id` 필드 fallback. 이상하면 fallback 문자열(`part_3` 등) 반환.

3 곳에 적용:
- `load()`의 part 열거
- `load()`의 parameter 열거
- `getParameters()` 런타임 호출

## 검증

- typecheck: 0
- lint: 0
- build: 통과 (사이즈 변동 없음 — 코드 추가 미미)

## 학습

런타임 객체가 string처럼 생겼다고 string으로 단정하지 말 것. Cubism은 ID를 객체로 들고 다니는데(이름 lookup의 O(1) 핸들 캐시 의도), 도메인 경계에서 한 번 string으로 변환하면 위험이 그 자리에서 끝난다.

향후 Cubism API에서 받아오는 모든 ID-like 값은 어댑터 경계에서 `coerceCubismId`로 통과시킬 것 — `setDrawableId`, `getPartParentPartIndex` 결과의 ID 등.
