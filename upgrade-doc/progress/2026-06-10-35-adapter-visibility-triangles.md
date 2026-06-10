# #35 — Spine 트라이앵글 정적화 + Live2D per-layer 가시성/틴트 분리

결함: R3 R4 R5 ([02-결함목록](../02-결함목록.md))

## 무엇을

- **R3**: Spine `getLayerTriangles` 가 live attachment 를 읽던 것을 로드 시점
  setup-pose attachment 에서 캡처한 정적 캐시(`trianglesByExternalId`)로 교체.
- **R4/R5**: Live2D `partOpacityOverrides`(partIdx 키 단일 맵)를
  `layerHidden`(Set<LayerId>) + `layerAlphaById`(Map<LayerId, number>) +
  파생 `drawableMultipliers`(drawable→multiplier)로 교체.

## 어떻게

- Spine: slice 를 만든 그 attachment 에서 트라이앵글도 같이 추출
  (`trianglesFromAttachment` helper). 숨긴 slot(attachment null)이어도 footprint 가
  유지되므로 오버라이드 합성이 rect-클립 fallback 으로 떨어져 이웃 slot 픽셀을
  지우는 일이 없어짐. 애니메이션이 attachment 를 바꿔도 `layer.texture` slice 와
  항상 일치.
- Live2D 의미론 (rebuildDrawableMultipliers 주석에 명문화):
  - 레이어 숨김 = 그 페이지의 direct drawable 만 0 — 멀티페이지 파트의 페이지
    행들이 서로 독립 (단일 페이지 파트는 기존과 동일).
  - 파트의 **모든** 페이지 행이 숨겨졌을 때만 자식 파트로 cascade.
  - 틴트 알파는 가시성과 곱으로 합성 (기존: 같은 맵을 덮어써 서로 파괴).
  - 파생 맵은 토글 시에만 재계산, per-frame 훅은 맵 순회만.
- `usePuppetMutations.syncAdapterFromStore` 의 undo/redo 리플레이는 수정 없이
  자동으로 안전해짐 — per-layer 키라 순서 의존 클로버링이 구조적으로 불가능.

## 검증

- `pnpm typecheck` / `pnpm lint` 통과 (warning 17 기존과 동일).
- setLayerColor 호출자는 현재 UI 에 없음 (인터페이스만) — 의미론 변경 무위험.

## 남긴 것

- R12 (manifest 3회 fetch, opacity 곱셈의 엔진 의존)는 P2 로 보류.
- 틴트 UI 가 생기면 (Stage 5 HSL 조정) layerAlphaById 채널이 그대로 받침.
