# #42 — 페이지 오버라이드 데이터 채널 (G3 기반공사 1/2)

계획: [04-전신-리스타일.md](../04-전신-리스타일.md) §4-A

## 무엇을

아틀라스 페이지 전체를 교체 가능한 1급 데이터로 만드는 기반. 전부 additive —
기존 per-layer 오버라이드와 하위 호환 유지.

## 어떻게

- **store**: `pageTextureOverrides: Record<pageIndex, Blob>` + setter,
  setAvatar 시 클리어.
- **applyOverrides**: `LayerOverrides.pages` 입력 — 페이지 재구성 베이스가
  pristine 대신 페이지 오버라이드 (스케일 드로잉, 디코드 실패 시 pristine
  fallback). per-layer texture/mask 는 그 위에 그대로 합성 — 두 기능이 공존.
  diff 채널에 pages(Blob identity) 포함. ApplyContext 에 pageIndex↔TextureId
  번역 함수 2개 추가.
- **adapters**: Spine 에 `textureIdByPageIndex`/`pageIndexByTextureId` 맵 신설
  (Live2D 는 기존 맵 재사용), `setLayerOverrides(opts.pages)` 전달.
- **persistence**: `LayerOverrideKind` 에 `"pageTexture"` 추가 —
  `layerExternalId = "page:<index>"` 인코딩으로 기존 인덱스 그대로 활용,
  **Dexie 버전 bump 불필요** (구버전 코드는 새 kind 를 조회하지 않으므로 무해).
  hydrate + diff 3번째 채널 (`diffAndPersistPages`).
- **LayersPanel**: effect 가 pages 를 함께 전달.

## 검증

`pnpm typecheck` / `pnpm lint` 0 error. 페이지 오버라이드 미사용 시 모든
경로가 기존과 동일 (pages 빈 맵 → diff 무변화 → no-op).

## 남긴 것

- 읽기 측(썸네일/스튜디오 소스)과 bakeAtlas/export 정합은 #43.
- TextureId 는 로드마다 재발급 — 영속 키로 pageIndex 만 사용 (코드 주석 명문화).
