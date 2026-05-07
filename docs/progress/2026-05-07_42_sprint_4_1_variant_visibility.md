# 2026-05-07 — Sprint 4.1: Variant 데이터 모델 + 캡처/적용

[`41 phase4_kickoff`](2026-05-07_41_phase4_kickoff.md)의 첫 sub-sprint. Visibility 스냅샷만 다루는 가장 좁은 슬라이스로 끝낸다. Spine Skin / Live2D group import는 다음 sprint들이 받는다.

## 변경 surface

### IDB v3 — `variants` store

`lib/persistence/db.ts`에 `VariantRow` + v3 마이그레이션 + 4개 헬퍼 (`saveVariant` / `listVariantsForPuppet` / `updateVariant` / `deleteVariant`).

```ts
type VariantRow = {
  id: VariantRowId;
  puppetKey: string;                          // 동일 키 체계 (PuppetId 또는 "builtin:<key>")
  name: string;
  description?: string;
  visibility: Record<string, boolean>;        // layerExternalId → visible
  createdAt: number;
  updatedAt: number;
};
```

복합 인덱스 `[puppetKey+updatedAt]`로 panel의 "이 puppet의 variants 최신순" 쿼리 한 번에 처리.

**왜 `layerExternalId`가 키냐**: `Layer.id`는 매 어댑터 로드마다 재생성됨. AI history와 동일 이유 — runtime-native id (Spine slot name, Cubism part id `#p${pageIdx}` suffix 포함)가 안정 키.

### `useVariants(puppetKey)` 훅

- mount + key 변경 시 IDB에서 리스트 fetch
- `capture(name, visibilityByLayerId, layers)` — Layer.id → externalId 변환 후 persist
- `apply(id, layers)` — externalId → Layer.id 역변환된 visibility map 반환 (caller가 adapter에 push)
- `rename`, `remove`
- `puppetKey === null`이면 전부 no-op + 빈 리스트 (예: /poc/upload autoSave 전)

훅은 IO/persistence만 책임지고 adapter는 모름. 이렇게 분리한 건 store/runtime 결합이 이미 `usePuppetMutations`에 있어서, 같은 곳에 push 로직을 모으는 게 자연스러워서.

### `applyVisibilityMap` — store + adapter 동기화

기존 `bulkSetLayerVisibility(ids, visible)`는 (id 집합, single bool) 시그니처라 per-layer 다른 값을 못 받음. Variant apply는 같은 호출에서 어떤 layer는 hide / 어떤 layer는 show 할 수 있어야 하므로 새 액션 추가:

- `editor.ts`: `applyVisibilityMap(next: Record<LayerId, boolean>)` — pushHistory + map merge
- `usePuppetMutations.ts`: store action 호출 + adapter에 per-layer push

History 통과로 undo로 직전 외관 복원 가능. **map에 없는 layer는 현재 값 유지** — partial variant ("이 신발만 바꿔" 같은 프리셋)를 의도적으로 허용.

### `VariantsPanel` 컴포넌트

ToolsPanel 아래 / LayersPanel 위에 끼는 작은 섹션. UX 동선:

- `+ capture` 버튼 → 이름 입력 → 저장 (현재 `visibilityOverrides` 스냅샷)
- 행 클릭 → apply (콜백으로 `applyVisibilityMap` 호출)
- 더블클릭 → rename (Enter / blur로 저장, Esc로 취소)
- 행 hover 시 우측 `×` → 삭제 (`confirm()` 한 단계)
- `puppetKey === null`이면 hint만 표시 ("Save to library to enable")

**의도적으로 active variant 하이라이트 X**: variant 적용 후 사용자가 단일 layer를 토글하면 하이라이트가 거짓말이 됨. 같은 variant를 다시 클릭하면 다시 적용되는 단순 모델로 유지.

### 페이지 와이어링

3개 페이지에 `<VariantsPanel>` 추가 + `applyVisibilityMap` prop 통과:

- `app/edit/[avatarId]/page.tsx` (puppetKey = puppetId)
- `app/edit/builtin/[key]/page.tsx` (puppetKey = `builtin:${key}`)
- `app/poc/upload/page.tsx` (puppetKey = savedId, autoSave 전엔 null)

## 검증

- typecheck 통과
- biome 통과 (a11y/noAutofocus 회피로 `ref={focusOnMount}` 콜백 ref 사용)
- `next build` 통과

## 시각 검증 가이드

```bash
git pull && pnpm install && pnpm dev

# 1) /edit/builtin/hiyori → 몇 layer hide → "+ capture" → "Default" 저장
# 2) 일부 layer 추가 hide → "+ capture" → "Naked" 저장
# 3) Variants에서 "Default" 클릭 → 즉시 원래 visibility로 복원, undo로 되돌릴 수 있음
# 4) 페이지 새로고침 → 두 variant 살아있음 (IDB persist)
# 5) /poc/upload → 새 zip 드롭 → autoSave 전엔 "Save to library to enable" hint
# 6) autoSave 후엔 capture 가능, 같은 puppet을 라이브러리에서 열면 같은 variants 보임
```

## 의도적 한계

- **Visibility만**: color / mask / AI texture override는 데이터 모델에는 슬롯 있지만 4.1에선 미와이어. 4.2/4.3에서 native Spine Skin / Live2D group import와 함께 확장
- **Active variant 추적 X**: 위에서 설명
- **Description / thumbnail UI X**: 데이터 슬롯만 있고 UI는 후속 sprint
- **Variant export/import X**: 4.4의 `*.geny-avatar.zip`이 받음

## 다음 — Sprint 4.2

Spine Skin enumeration → Variant import. `SpineAdapter.load()` 단계에서 모든 Skin을 Variant로 변환. `attachmentName` override가 추가되므로 어댑터 인터페이스에 `applyAttachmentOverrides` (또는 `applyVariant`) 신설 필요.
