# 2026-05-06 — Sprint 1.4a: Store + 본 컴포넌트 + /edit 페이지

PoC 페이지의 인라인 useState를 Zustand 스토어로 들어올리고, 패널을 진짜 컴포넌트로 추출. 본 에디터 진입점 `/edit/[avatarId]`가 같은 컴포넌트들을 사용해 일관된 흐름.

## 구성

### `lib/store/editor.ts`

Zustand + immer middleware. 도메인 상태:
- `avatar`, `selectedLayerIds`, `playingAnimation`, `layerFilter`, `visibilityOverrides`
- 액션: `setAvatar`, `setLayerVisibility`, `bulkSetLayerVisibility`, `selectLayers`, `toggleLayerSelected`, `setPlayingAnimation`, `setLayerFilter`, `resetOverrides`

`setAvatar`가 visibilityOverrides를 layer.defaults.visible로 자동 시드 + 다른 상태 reset.

**Adapter는 store 밖**. mutable runtime 객체라 immer 안에 두면 freeze 충돌 위험. 페이지가 `usePuppet`이 반환한 adapter를 ref로 들고 있고, store 액션 옆에서 함께 호출.

### `lib/avatar/usePuppetMutations.ts`

페이지 단의 작은 wrapper hook. adapter ref + store 액션을 받아 "둘 다 갱신"하는 함수 묶음을 반환:
- `toggleLayer(id, nextVisible)`
- `bulkSetLayerVisibility(ids, visible)`
- `playAnimation(name)`

페이지가 이걸 통해 LayersPanel/ToolsPanel의 콜백에 연결.

### 컴포넌트 — `components/`

- **`LayersPanel.tsx`** — store에서 layers + visibility + filter selector로 subscribe. show-all/hide-all bulk + 검색.
- **`ToolsPanel.tsx`** — animations selector, active 표시.
- **`PuppetCanvas.tsx`** — `usePuppet` 사용, runtime별 fit-to-canvas. mount 완료 시 `setAvatar` + initial animation. `input=null`이면 `empty` prop을 렌더 (드롭존 끼우는 자리).
- **`UploadDropzone.tsx`** — 1.3b의 컴포넌트 그대로 재사용.

### 본 에디터 페이지 — `app/edit/[avatarId]/page.tsx`

Next.js 15 App Router의 dynamic route. `params: Promise<{avatarId}>`를 `use(params)`로 unwrap. 흐름:
1. `loadPuppet(id)` → `result.entries: BundleEntry[]`
2. `parseBundle(entries)` → `loadInput`
3. `<PuppetCanvas>`이 `input` 받아 자동 mount + store 채움
4. `<ToolsPanel>` + `<LayersPanel>`이 store 보고 자동 렌더
5. `usePuppetMutations(adapter)`이 토글/애니메이션 brokering

### `/poc/upload` 리팩터

같은 컴포넌트들로 redo. 200줄 → 180줄로 축소되고 (인라인 state 제거), 동시에 본 에디터로 가는 "open in editor" 링크 추가. PoC가 본 흐름과 동일한 구조라 사용자 입장에서 차이 없는데 코드는 한 곳에서.

### Library 카드

이전엔 `/poc/upload?puppet=` 으로 reload. 이제 직접 `/edit/[id]`로 navigate.

## types 변경

`Polygon`/`UVIsland`의 `points`가 `ReadonlyArray<...>`였는데 immer가 draft로 wrap 못해서 type error. Mutable array로 변경. 우리가 mutate하지 않더라도 type 측면에서 immer-safe해야 store가 받아들임.

## 검증

- typecheck/lint/build 통과
- `/edit/[avatarId]` dynamic route, `/poc/upload` 6 → 2.14 KB (코드 외부화로 First Load 312 → 318 KB는 미미한 변동)

## 시각 검증 가이드 (사용자, 시간 될 때)

```bash
git pull && pnpm install && pnpm dev
# /poc/library — 카드 클릭 → /edit/<id> 진입
# 본 에디터에 같은 캔버스 + LayersPanel + ToolsPanel
# /poc/upload에서 새 자산 드롭 → "saved" → "open in editor" 클릭
```

## 다음 — Sprint 1.4b

- 내장 샘플 그리드 (Hiyori, spineboy 등을 첫 페이지에서 클릭으로 로드)
- Undo/Redo (visibility 우선, color는 1.5)
- 키보드 단축키 (z reset, space play/pause, Cmd+Z undo)
- V1 시나리오 통합 시연 가능 상태 마무리
