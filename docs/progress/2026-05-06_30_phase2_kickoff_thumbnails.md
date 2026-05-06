# 2026-05-06 — Phase 2 Kickoff + Sprint 2.0: Puppet 썸네일

Phase 1 끝. V1 시나리오 A·B의 "올리고 보고 토글" 풀체인 + 키보드 단축키 + Undo/Redo + 본 에디터 경로(/edit/[id], /edit/builtin/[key]) 동작. 다음은 Phase 2 — Atlas & Decompose Studio.

## Phase 2 스코프 ([plan/07](../plan/07_phased_roadmap.md))

목표: 레이어의 텍스처 region을 atlas에서 추출하고, 사용자가 마스크를 다듬을 수 있는 도구.

산출물:
- Atlas 슬라이싱 (Spine `.atlas`, Cubism atlas page UV)
- Region 미리보기 (LayersPanel 행 thumbnail)
- DecomposeStudio v1: 알파 임계 + 브러시 마스크 + 라쏘 (SAM 없이)
- mesh silhouette 추출 (mesh attachment / drawable 정점에서) — AI ControlNet 입력 준비
- 자산 출처 메모는 1.3d에서 이미 마침.

## Sub-sprint 분할

### Sprint 2.0 — Puppet 썸네일 (이번)

라이브러리 카드가 `免费模型艾莲` 같은 동일 이름의 puppet들을 구분 못 해서 시각적으로 부실. 캔버스가 마운트되면 한 프레임 캡처 후 IndexedDB에 webp 저장 → 카드에 표시.

Phase 2 본 작업의 가벼운 워밍업이자 즉각적인 UX 개선.

### Sprint 2.1 — Atlas region 추출

- Spine `.atlas` 텍스트 파서 (region 좌표 + rotated 플래그) — 우리 코드로 직접 (spine-pixi가 노출하지 않는 정보가 있음)
- Cubism: 각 drawable의 vertexUvs에서 bbox 추출 → atlas page 좌표
- 어댑터가 `Layer.texture: TextureSlice`를 채워서 반환
- 어댑터가 `getTexturePage(pageIndex): HTMLCanvas | Texture`를 노출

### Sprint 2.2 — Layer 행 썸네일

- Region rect로 atlas page를 crop → 32×32 webp
- 캐시 (avatarId+layerId 키)
- LayersPanel 행에 표시

### Sprint 2.3 — DecomposeStudio v1

- 레이어 클릭 → 사이드 모달에서 region 풀사이즈
- 알파 임계 슬라이더 (live preview)
- 브러시 마스크 페인팅
- 마스크 PNG 저장

### Sprint 2.4 — Mesh silhouette

- mesh attachment / drawable 정점에서 outline polygon
- `Layer.silhouette` 채움 → 향후 ControlNet 입력

## 이번 변경 — Sprint 2.0

### `lib/avatar/captureThumbnail.ts`

`app.renderer.extract.canvas(app.stage)`로 새 RT에 한 번 더 렌더 → 항상 읽힘 (preserveDrawingBuffer 없이도). 256px max 한 변, 0.85 quality webp. 결과는 ~5-15KB.

`app.canvas` 직접 toBlob은 `preserveDrawingBuffer: false` (기본값) 때문에 검정으로 읽힐 수 있어서 extract 사용.

### `components/PuppetCanvas.tsx`

`onReady` 시그니처를 `(avatar, adapter)` → `(avatar, adapter, app)`로 확장. 페이지가 Pixi Application을 받아 썸네일 캡처에 사용.

### `app/poc/upload/page.tsx`

`adapter`와 별도로 `app: Application | null` state. `useEffect([app, savedId])`가 둘 다 준비되면 400ms 대기 (Cubism idle 모션 안정화) → 캡처 → `updatePuppet(id, { thumbnailBlob: blob })`. clear 시 `app`도 null.

### `app/edit/[avatarId]/page.tsx`

같은 패턴. 매번 에디터 진입 시 갱신 — 마지막 본 모습으로 라이브러리 카드가 동기화. 비용 ~10KB·1 putRequest 정도라 cheap.

### `app/poc/library/page.tsx`

`<PuppetThumb blob={p.thumbnailBlob} />` 컴포넌트 추가. blob이 있으면 `URL.createObjectURL` → `<img>`. unmount 시 revoke. 없으면 "no preview" 점선 박스.

## 검증

- typecheck 통과
- biome 통과
- build 통과

## 시각 검증 가이드

```bash
git pull && pnpm install && pnpm dev
# 1) /poc/library 에 기존 puppet들은 thumb 없음 → "no preview"
# 2) 카드 클릭 → /edit/<id> 진입 → 400ms 후 썸네일 자동 저장 → 뒤로가기로 라이브러리 → 썸네일 표시
# 3) /poc/upload 에 새 자산 드롭 → save 후 썸네일도 자동 저장
```

## 다음 — Sprint 2.1

Spine atlas 파서 + Cubism drawable UV bbox → `Layer.texture` 채우기. atlas page 텍스처 노출.
