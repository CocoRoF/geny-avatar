# #43 — 페이지 오버라이드 읽기/베이크 정합 + revert UI (G3 기반공사 2/2)

계획: [04-전신-리스타일.md](../04-전신-리스타일.md) §4-A

## 무엇을 / 어떻게

- **읽기 측 단일화**: `LayerOverrideApplier` 가 디코드한 페이지 베이스를
  `pageBases` 로 보관(`getPageBase`), 어댑터의 `getTextureSource` 가 이를
  우선 반환. **썸네일·DecomposeStudio 소스·GeneratePanel 크롭·bakeAtlas 가
  전부 자동으로 오버라이드 인식** — 시그니처 변경 없음. 베이스의 고유 크기가
  페이지 치수와 다르면(다운스케일 AI 결과) 페이지 치수 캔버스로 정규화 —
  읽기 측 rect 크롭 좌표 보존.
- **bakeAtlas/buildModelZip**: getTextureSource 경유라 무변경으로 페이지
  오버라이드가 export 에 반영됨.
- **geny-avatar.zip**: `session.pages`(옵션) + `overrides/pages/<idx>.png`.
  schemaVersion 1 유지 — 구버전 importer 는 필드 무시 (graceful degradation).
  restoreBundle 이 `page:<idx>` 행으로 복원. ExportButton 이 store 의
  pageTextureOverrides 전달.
- **revert UI**: LayersPanel 상단에 "Page overrides" 섹션 — 페이지별 revert
  버튼 (`setPageTextureOverride(idx, null)` → diff 가 해당 페이지만 pristine
  복원, 레이어 오버라이드는 유지).
- ImageBitmap 수명: 페이지 베이스 교체/제거/dispose 시 이전 비트맵 close.

## 검증

`pnpm typecheck` / `pnpm lint` 0 error. 페이지 오버라이드 없을 때 모든 경로
기존과 동일.

## 남긴 것

- pristine 접근이 필요한 경로(현재 없음)는 어댑터의 내부 `textureSourcesById`
  가 그대로 들고 있음 — 필요 시 `getPristineTextureSource` 노출만 하면 됨.
