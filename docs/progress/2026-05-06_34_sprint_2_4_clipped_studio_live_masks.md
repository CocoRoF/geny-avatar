# 2026-05-06 — Sprint 2.4: Triangle-clipped DecomposeStudio + 라이브 마스크 적용

사용자 검증 후 보고된 세 가지 결함을 한 사이클로 해결:

1. **마스크가 렌더에 반영되지 않음** — Sprint 2.3의 v1은 store에만 저장. 어댑터에 푸시해 GPU 텍스처를 갱신하는 경로 없음.
2. **part_3을 끄면 꼬리가 사라지는데, edit으로 paint하면 안 지워짐** — 1과 같은 원인.
3. **Edit에 전체 atlas가 다 보임** — Cubism part는 흩어진 drawables. UV bbox 직사각형은 이웃 drawable 픽셀까지 포함하기 때문.

세 가지 모두 Phase 3 진입 전 마무리해야 한다는 사용자 요청 → 이번 sprint에서 완전히 처리.

## 어댑터 인터페이스 확장 (`AvatarAdapter`)

```ts
type LayerTriangles = {
  textureId: TextureId;
  /** [u0,v0, u1,v1, u2,v2] per triangle, top-down UVs in [0,1] */
  uvs: Float32Array;
};

interface AvatarAdapter {
  // ...기존
  getLayerTriangles(layerId): LayerTriangles | null;
  setLayerMasks(masks: Record<LayerId, Blob>): Promise<void>;
}
```

## SpineAdapter

### `getLayerTriangles`

slot의 attachment 종류로 분기:
- **MeshAttachment**: `regionUVs`(per-vertex UV in [0,1]) + `triangles`(vertex indices)를 그대로 deref해 (3 verts × 2 floats × N triangles) Float32Array로 변환. 회전된 region이면 spine-pixi가 이미 regionUVs를 회전된 atlas page 좌표로 매핑해 둔 상태라 그대로 사용.
- **RegionAttachment**: 4 corners의 UV를 fabricate (page 좌표 / page dim). 2 triangles로 quad.

### `setLayerMasks`

페이지마다:
1. 원본 비트맵 (`textureSourcesById`) → working canvas에 drawImage
2. 그 페이지에 속한 layer 중 mask가 있는 모든 layer에 대해 `destination-out`으로 mask blob 합성 (rotated 슬롯이면 +90도 rotate해서 atlas orientation으로 되돌리고 그림)
3. 결과 canvas를 Pixi Texture의 `source.resource`에 swap + `update()` + `_updateID/uploadId++` → GPU 재업로드

Pixi Texture handle은 atlas page의 `texture.texture` (SpineTexture가 wrap한 Pixi Texture)에서 추출, `pixiTextureById` 맵에 저장.

## Live2DAdapter

### `getLayerTriangles`

- `partToDrawables`(part 아래 drawables, 자손 포함) 중 layer.texture의 dominant page에 속한 것만 필터
- 각 drawable에 대해 `coreModel.getDrawableVertexUvs(d)` + `getDrawableVertexIndices(d)`
- indices를 deref해 [u, 1-v] 형태로 누적 (Cubism v=0 bottom → top-down으로 flip)

### `setLayerMasks`

SpineAdapter와 동일한 `applyLayerMasks` 헬퍼 호출. 차이는 Pixi Texture handle 출처:
- Spine: `atlas.pages[i].texture.texture`
- Cubism: `model.textures[i]` (이미 Pixi Texture)

`isPixiTexture` 가드로 `source` 존재만 확인. swap 후 다음 프레임에서 GPU 재업로드.

## `applyLayerMasks` (`lib/adapters/applyMask.ts`)

두 어댑터가 공유하는 helper. 핵심 로직:

```ts
for each affected page:
  start with original page bitmap
  for each layer L on this page with mask M:
    decode M as Image
    if L.texture.rotated: rotate +PI/2 around rect center, draw at (-h/2, -w/2, h, w)
    else: drawImage at (rect.x, rect.y, rect.w, rect.h)
    composite='destination-out' → page alpha *= (1 - mask.alpha/255)
  swap page Pixi Texture's source.resource = work; update + _updateID++
```

`{}` (빈 mask)를 패스하면 모든 페이지가 원본으로 복원 — clear mask가 즉시 라이브 렌더에 반영됨.

## `extractLayerCanvas` (`lib/avatar/regionExtract.ts`)

새 함수. `extractRegionCanvas`로 bbox crop을 만든 뒤, `buildLayerClipPath`가 어댑터의 triangles → canvas-local Path2D로 변환, 그 path로 clip해서 새 canvas에 다시 그림. **결과: layer의 실제 footprint만 남고 이웃 atlas pixel은 투명**.

`buildLayerClipPath`의 좌표 변환은 `extractRegionCanvas`의 draw transform 역연산:
- non-rotated: `(u*pageW - r.x, v*pageH - r.y)`
- rotated: `(v*pageH - r.y, r.x + r.w - u*pageW)`

수학은 회전 행렬 + drawImage src→dst 매핑을 직접 풀어 도출 (내부 주석 참조).

`clip`도 함께 반환해 brush가 footprint 안에서만 paint하도록 사용.

## `DecomposeStudio` 수정

- `extractRegionCanvas` 호출 → `extractLayerCanvas`로 교체. 사용자가 보는 source 캔버스는 footprint만.
- `clipPathRef`에 path 보관. 매 paint stroke 시 mask canvas에 `ctx.save(); ctx.clip(path); arc().fill(); restore();` → 페인트도 footprint 안에서만.
- threshold: `sa > 0 && sa < threshold ? 255 : 0`. 0 alpha 픽셀(footprint 밖, clip 결과)은 threshold 무시 — 안 그러면 saved blob이 footprint 밖 픽셀까지 alpha=255로 baking해서 `setLayerMasks` 적용 시 이웃 drawable이 지워짐.

## `LayersPanel`

`useEffect([adapter, layerMasks])` 추가 — store의 `layerMasks` 변경 시마다 `adapter.setLayerMasks(layerMasks)` 호출. 이 한 곳에서만 호출. 데이터 흐름: user paint → `setLayerMask` → store → effect → adapter → GPU.

## `useLayerThumbnail`

기존 `cropAtlasRegion`은 사각형 crop이라 row 썸네일도 이웃 픽셀 포함됨. `extractLayerCanvas`로 통합 → 썸네일도 자동으로 footprint만 보임. 결과적으로 LayersPanel 행 썸네일이 훨씬 깔끔하고 의미 있음.

## 검증

- typecheck/lint/build 통과
- 각 page route 빌드 사이즈 미세 증가 (+~3KB)

## 시각 검증 가이드 (사용자)

```bash
git pull && pnpm install && pnpm dev
# 1) /edit/builtin/hiyori → LayersPanel 행 hover → edit
# 2) Studio: 이번엔 그 part의 *진짜 footprint*만 보임 (이웃 atlas 사라짐)
# 3) 칠하기 → mask 미리보기 (기존과 동일)
# 4) save & close → "이번엔" 캔버스의 puppet에서 그 영역이 즉시 사라짐
# 5) 라이브러리 카드 → 다시 진입해도 mask는 in-memory만이라 사라짐 (예상된 v1 한계)
# 6) clear mask → 즉시 라이브 렌더 복원
# 7) /edit/builtin/spineboy 같은 흐름 (Spine MeshAttachment + RegionAttachment 모두)
```

## 알려진 제약 (다음 sprint 후보)

- **마스크 IDB 영속성 없음**: 페이지 새로고침 시 사라짐. 이걸 살리려면 `puppetMasks` IDB store 추가 + edit 페이지 진입 시 복원.
- **mesh 한 부분이 다른 page에 걸친 part**: dominant page만 처리. 두 page에 걸친 part는 한쪽만 mask. 드물.
- **Pixi v8 source.resource swap이 모든 빌드에 안전한지**: 핵심 동작은 OK이지만 `_updateID`/`uploadId` 플래그를 둘 다 bumb해서 보수적으로 처리.

## 다음

Phase 2 마무리:
- mesh silhouette 추출 (drawable polygon outline → ControlNet 입력 준비)
- 또는 마스크 IDB 영속성
- 또는 이번 sprint 사용자 검증 결과 반영

이후 Phase 3 (AI texture generation) 진입.
