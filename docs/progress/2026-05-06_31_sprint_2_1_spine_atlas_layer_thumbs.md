# 2026-05-06 — Sprint 2.1: Spine atlas region 추출 + LayersPanel 행 썸네일

Phase 2의 핵심 진입로. 이전까지 LayersPanel은 같은 이름의 슬롯 (e.g. `front-thigh`, `front-shin`)을 텍스트만으로 구분해야 했음. 이번 sprint로 Spine puppet의 각 레이어가 atlas region 썸네일을 갖게 되어 한눈에 식별 가능.

Cubism은 다음 sprint 2.2에서 처리. 지금은 어댑터 인터페이스만 추가해 두고 stub.

## 어댑터 인터페이스 변경

### `getTextureSource(textureId): TextureSourceInfo | null`

```ts
type TextureSourceInfo = {
  image: CanvasImageSource;  // HTMLImageElement | ImageBitmap | etc
  width: number;
  height: number;
};
```

각 어댑터가 atlas page bitmap을 노출. LayersPanel이 region rect로 crop해 썸네일 만들 때 사용. `Avatar.textures`의 textureId가 키.

## SpineAdapter

### atlas 카탈로그

`Spine.from()` 호출 후 `Assets.get(atlasAlias)`로 spine-core의 `TextureAtlas`를 받아 walk:
- `atlas.pages[i].texture` — `SpineTexture` (spine-pixi의 wrapper)
- `.texture` — Pixi v8 `Texture`
- `.source.resource` — 실제 bitmap (`HTMLImageElement | ImageBitmap | ...`)

각 page를 `Avatar.textures: DomainTexture[]`에 추가, `Map<page.name, textureId>`로 인덱스. `textureSourcesById: Map<TextureId, TextureSourceInfo>`에 bitmap 보관.

### Layer.texture 채우기

각 slot의 default attachment (RegionAttachment 또는 MeshAttachment)는 `region: TextureAtlasRegion`을 갖는다:
- `x, y`: atlas page 픽셀 좌표 (rotated여도 그대로)
- `width, height`: on-page (rotated된 후) 크기
- `originalWidth, originalHeight`: pre-rotation 원본 크기
- `degrees`: 0 또는 90

`Layer.texture: TextureSlice = { textureId, rect: {x,y,w,h}, rotated: degrees !== 0 }`로 변환.

### 타입 표면

spine-core의 클래스 (`TextureAtlasRegion`, `TextureAtlasPage`)를 직접 import하지 않고 duck type (`SpineAtlasLike`, `SpineAtlasPageLike`, `SpineAtlasRegionLike`) 으로 처리. spine-pixi가 이미 transitive로 spine-core를 끌고 와서 동작은 됨.

## Live2DAdapter

`getTextureSource()` 는 `null` 리턴 stub. 다음 sprint 2.2에서:
1. drawable의 vertexUvs 배열에서 UV bbox 추출
2. textureIndex로 atlas page 매핑
3. `Avatar.textures` 채우기 + `Layer.texture` (part 단위 — 같은 part 아래 drawables의 union bbox)

## `lib/avatar/useLayerThumbnail.ts`

LayersPanel row마다 호출되는 hook. Layer.texture가 있으면:
1. 어댑터에서 `getTextureSource(textureId)` → bitmap
2. canvas에 region rect crop (rotated면 -90 회전)
3. 48px 정사각 webp blob → `URL.createObjectURL`
4. unmount/dep change 시 `revokeObjectURL`

회전 처리: spine atlas v4의 `degrees=90`은 packer가 90도 CW로 회전시켜 page에 박았다는 의미. 표시 시 -90 (CCW) 회전으로 원위치. canvas의 `ctx.rotate(-Math.PI / 2)` 후 source 90/h를 swap해 그림.

레이어가 없거나 (Cubism 현재 모든 layer) bitmap을 못 찾으면 `null` → LayersPanel은 점선 박스로 fallback.

## LayersPanel

기존 inline `filtered.map(...)`을 `<LayerRow>` 컴포넌트로 분리해 hook을 row마다 호출 가능하게. row가 자기 layer의 썸네일 URL을 들고 28×28 이미지 또는 placeholder 박스를 렌더.

`adapter` prop을 페이지에서 새로 내려보냄. store 밖에 있는 mutable adapter를 직접 prop drilling — 패널에서 어댑터의 read-only API만 호출하므로 안전.

## 검증

- typecheck/lint/build 통과
- /poc/spine 빌트인 spineboy 카드 → /edit/builtin/spineboy → LayersPanel에 52개 슬롯 각각 썸네일 표시 (시각 검증 차례)

## 시각 검증 가이드

```bash
git pull && pnpm install && pnpm dev
# 1) home → "spineboy" 카드 → /edit/builtin/spineboy
# 2) 우측 LayersPanel: front-thigh / front-shin / front-foot 등이 각자 다른 부위 그림
# 3) "Hiyori" 카드 → /edit/builtin/hiyori → 모든 part는 점선 placeholder (Cubism 2.2에서 처리)
# 4) /poc/upload 에 spine 자산 드롭 → 같은 결과
```

## 다음 — Sprint 2.2

Cubism (Live2DAdapter):
- drawable.vertexUvs (Float32Array)에서 UV bbox 추출
- drawable.textureIndices로 page 매핑
- Pixi Assets에서 텍스처 page 가져오기
- Layer (part) 단위로 아래 drawables 묶음 bbox + 같은 textureIndex일 때만 처리
- 어댑터의 `getTextureSource()` 구현
