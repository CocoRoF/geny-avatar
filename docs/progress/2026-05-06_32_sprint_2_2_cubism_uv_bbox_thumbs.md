# 2026-05-06 — Sprint 2.2: Cubism drawable UV bbox → Layer 썸네일

Sprint 2.1에서 Spine만 처리. 이번 sprint는 Live2D Cubism도 같은 표면 (`getTextureSource` + `Layer.texture`) 채워서 LayersPanel에 드디어 모든 puppet의 레이어 썸네일이 뜨게 됨.

## 엔진 API 발견

`untitled-pixi-live2d-engine`의 `types/index.d.ts` 직독으로 확인:
- `Live2DModel.textures: PixiTexture[]` — 모델당 atlas page 배열 그대로
- `coreModel.getDrawableTextureIndex(d): number` — drawable이 어느 page에 있는지
- `coreModel.getDrawableVertexUvs(d): Float32Array` — drawable의 UV 배열 ([u0,v0,u1,v1,...] in [0,1])

이전 sprint들에서 native handle (`drawables.opacities` 등)을 probe해 mutate했던 것과 달리 이번 작업은 **공식 framework API**만 사용. 안전.

## Live2DAdapter 추가

### 텍스처 페이지 카탈로그

`(model as any).textures`로 Pixi texture 배열 받아 walk:
- 각 texture의 `source.resource` (HTMLImageElement / ImageBitmap)와 `source.width/height`로 `TextureSourceInfo` 생성
- 새 `textureId` 발급 → `Avatar.textures` + 어댑터의 `textureSourcesById` 맵에 등록
- `textureIdByPageIndex: Map<number, TextureId>`로 page index 역인덱스 보관

### 파트별 region bbox

각 layer (= part)에 대해:
1. 이전부터 있던 `partToDrawables`에서 그 part 아래 drawables 모음 가져오기 (자식 part 포함)
2. drawables를 `getDrawableTextureIndex`로 그룹화
3. drawable 수가 가장 많은 page를 dominant page로 선택 (parts can span pages but rarely do)
4. 그 page에 속한 drawables의 UV를 union → minU/maxU/minV/maxV
5. clamp + Cubism의 v=0 bottom 컨벤션을 canvas의 top-down으로 뒤집어 픽셀 좌표:
   - `x = floor(minU * pageW)`
   - `y = floor((1 - maxV) * pageH)` ← v 뒤집기
   - `w = ceil((maxU - minU) * pageW)` (clip to page width)
   - `h = ceil((maxV - minV) * pageH)` (clip to page height)
6. `Layer.texture = { textureId, rect: {x,y,w,h}, rotated: false }` (Cubism atlas는 회전 packing 안 함)

### `getTextureSource()`

stub 제거. `textureSourcesById.get(id) ?? null`로 정상 구현.

### destroy()

`textureSourcesById.clear()` 추가.

## helper

`pixiTextureToSourceInfo(tex)`: Pixi v8 Texture의 `source.resource` + `source.width/height`을 duck type으로 꺼내 `TextureSourceInfo`로. `isCanvasImageSource()` 가드는 SpineAdapter의 사촌. (Spine은 `lib/adapters/SpineAdapter.ts`에 자체 inline. 향후 둘이 더 비슷해지면 추출.)

## 동작 결과

- Hiyori 24 parts 모두 LayersPanel 썸네일 표시 (얼굴, 머리카락 묶음, 눈, 입 등 시각적으로 구분 가능)
- Spine 동작 영향 없음 — Sprint 2.1 코드는 그대로
- typecheck/lint/build 통과
- /edit/builtin/hiyori 진입 시 `[Live2DAdapter] populated Layer.texture for X/Y parts (pages=N)` 진단 로그 출력

## 잠재 이슈 + 후속 처리거리

- **Root part / 컨테이너 part**: 자식이 많은 part는 bbox가 atlas 거의 전체. 썸네일이 페이지 전체로 보임. 직접 drawables만 쓰는 `directPartToDrawables` 옵션을 추가하면 더 깔끔. Sprint 2.3에서 다듬을 거.
- **다중 page 분산 part**: 현재는 dominant page 하나만 사용. 둘 이상의 page에 걸친 part는 한쪽만 보임. 드물지만 후속에서 필요하면 두 page 합성 캔버스로.
- **UV bounds 0 영역**: 빈 drawable (e.g. clipping mask)을 가진 part는 valid UV 안 잡혀서 썸네일 없음 — fallback placeholder. 의도한 동작.

## 다음 — Sprint 2.3

Phase 2 본 작업의 다음 단계:
- **DecomposeStudio v1**: 레이어 클릭 → 사이드 모달에서 region 풀사이즈 + 알파 임계 + 브러시 마스크
- 또는 직접 drawables만 쓰는 옵션으로 root/container part 썸네일 다듬기
- 또는 **mesh silhouette** 추출 (drawable 정점 outline polygon → ControlNet 입력 준비)

사용자 우선순위 확인 후 진행.
