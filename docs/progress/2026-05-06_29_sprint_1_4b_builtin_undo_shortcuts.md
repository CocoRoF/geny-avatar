# 2026-05-06 — Sprint 1.4b: 내장 샘플 + Undo/Redo + 키보드 단축키

V1 시연 가능 상태 마무리. Phase 1.4의 마지막 sub-sprint.

## 1. 내장 샘플 그리드

### `lib/builtin/samples.ts`

`BUILTIN_SAMPLES`: vendor 서브모듈에서 `/public/samples/`로 동기화되는 정적 자산을 가리키는 카드 목록. IndexedDB 우회.

- `hiyori` — Live2D Cubism 4 공식 샘플
- `spineboy` — Spine 4.2 공식 샘플

각 샘플은 어댑터에 직접 넘길 `AdapterLoadInput`을 들고 있다. blob URL juggling 없음 — 정적 URL.

### `app/edit/builtin/[key]/page.tsx`

Next.js dynamic route. `findBuiltin(key)` 미스 시 안내 메시지 + home 링크. 로드 성공 시 `/edit/[avatarId]`와 동일한 PuppetCanvas/ToolsPanel/LayersPanel 셋업.

### `app/page.tsx`

새 섹션 "Built-in samples"를 Operating Philosophies 위에 추가. 카드 클릭 시 `/edit/builtin/<key>`로 진입. 첫 방문자가 puppet 없이도 즉시 도구를 만질 수 있다.

## 2. Undo/Redo

### `lib/store/editor.ts`

`past: VisibilitySnapshot[]` + `future: VisibilitySnapshot[]`. 각 액션 직전에 `pushHistory(s)`가 현재 `visibilityOverrides`를 복사해 past에 push (HISTORY_LIMIT=50).

스냅샷 기반 (액션 단위 패치 X). 이유: bulk hide/show가 단일 사용자 의도이므로 한 번의 undo로 통째 복원되는 게 직관적이고, 메모리 코스트도 record-of-bool ≈ 100 bytes/snap × 50 = 5KB 수준이라 저렴.

`setAvatar`는 history를 비운다 — 다른 puppet 진입 시 이전 puppet의 history를 끌고 가는 건 의미 없음.

### `lib/avatar/usePuppetMutations.ts`

`reset/undo/redo` 콜백 추가. undo/redo 후 `syncAdapterFromStore()`가 store의 `visibilityOverrides`를 walk하면서 `adapter.setLayerVisibility(id, visible)`을 호출 → 캔버스가 복원된 상태와 일치.

## 3. 키보드 단축키

### `lib/avatar/useEditorShortcuts.ts`

window-level keydown listener. `INPUT`/`TEXTAREA`/contenteditable에 포커스가 있으면 skip — 검색창 등 텍스트 입력에 방해되지 않게.

- `Cmd/Ctrl+Z` → undo
- `Cmd/Ctrl+Shift+Z` → redo
- `Cmd/Ctrl+Y` → redo (Windows 관습)
- `r` → reset overrides

세 페이지 (`/poc/upload`, `/edit/[id]`, `/edit/builtin/[key]`)에 헤더 undo/redo/reset 버튼 + 단축키 훅 동시 부착. 버튼은 `canUndo/canRedo`로 disabled 토글.

## 검증

- typecheck 통과
- biome 통과 (포매터 자동 적용)
- build 통과 — `/edit/builtin/[key]` 1.32 KB / First Load 281 KB

## 시각 검증 가이드 (사용자, 시간 될 때)

```bash
git pull && pnpm install && pnpm dev
# 1) home → "Hiyori" 카드 → /edit/builtin/hiyori, 즉시 puppet 표시
# 2) LayersPanel hide-all → 사라짐 → Cmd+Z → 복구 → Cmd+Shift+Z → 다시 사라짐
# 3) 검색창에 텍스트 입력 중 Cmd+Z 누르면 텍스트 undo만 (에디터 undo 안 잡힘)
# 4) "r" 키 → reset (검색창 외부에서)
```

## Phase 1.4 마무리

1.4a (store/components/edit) + 1.4b (built-in/undo/shortcuts)으로 V1 시연 흐름 완료:
- 첫 방문자 진입 → 내장 샘플로 즉시 미리보기
- 본인 puppet → drag-drop → save → /edit/<id>
- 라이브러리 카드 → /edit/<id>
- 동일한 LayersPanel + ToolsPanel + 단축키 + undo/redo

다음은 Phase 2 (atlas decompose) 또는 Phase 1.5 (color/transform 편집) — `plan/07_roadmap.md`와 사용자의 우선순위에 맞춰 결정.
