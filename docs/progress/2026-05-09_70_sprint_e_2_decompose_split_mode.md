# 2026-05-09 — Sprint E.2: DecomposeStudio split mode

[`68 e_kickoff`](2026-05-09_68_e_kickoff.md) 의 두 번째 atomic sprint. 사용자가 layer를 직접 N개 named region 으로 쪼개 영구 저장. auto-detect가 부족할 때 (silhouette 연결돼서 한 component로 잡힘 / 너무 잘게 쪼개짐 / 의미적으로 다른데 같은 mask 안에) 사용자가 직접 brush로 정의.

## 변경 surface

### `lib/persistence/db.ts` — IDB v9

- 신규 store: `regionMasks`
- 신규 row type: `RegionMasksRow = { id, puppetKey, layerExternalId, regions: RegionMaskEntry[], updatedAt }`
- 신규 entry type: `RegionMaskEntry = { id, name, color, maskBlob }`
- index: `[puppetKey+layerExternalId]` (단일 access pattern), bare `puppetKey` (cascade)
- helpers: `loadRegionMasks`, `saveRegionMasks`, `deleteRegionMasks`, `deleteAllRegionMasksForPuppet`

### `lib/avatar/id.ts`

- `ID_PREFIX.regionMask = "rm"` 추가

### `lib/avatar/useRegionMasks.ts` (신규)

- IDB load + save dance만. 편집은 DecomposeStudio 의 in-memory canvas state 에서 일어나므로 여긴 atomic save 전용.

### `components/DecomposeStudio.tsx`

큰 확장. 기존 trim 모드 동작 그대로 유지하면서 split 모드 추가:

- 새 prop: `puppetKey: string | null`
- header에 top-level mode toggle: `[trim | split]` (chip 형태)
- `studioMode === "trim"`: 기존 alpha threshold + 단일 mask paint/erase. layer mask는 editor store에 저장.
- `studioMode === "split"`:
  - **sidebar**: regions list (color swatch + name input + delete X) + "+ add" + brush controls (paint/erase + size)
  - **canvas**: 각 region을 자기 색깔로 semi-transparent overlay (selected 더 진하게)
  - paintAt: 선택된 region의 in-memory canvas 에 stroke
  - save: 모든 region canvas → PNG blob → IDB 저장 (또는 비어있으면 row 삭제)
  - clear: 선택된 region 의 mask 만 wipe
  - dirty 추적: `splitDirty` 별도 (trim 의 `dirty` 와 분리)
- hydrate: mount 시 `useRegionMasks` 로 IDB 에서 region 목록 가져와 PNG blob → in-memory canvas 로 디코드

### Brush 색깔

split mode 에서 region canvas 에 painting 할 땐 `rgba(255,255,255,1)` 흰색 stamp (alpha=255). region 자체 색깔은 redraw 의 destination-in tint 로 표현 — region canvas는 binary alpha mask, 색상은 UI level 표시.

## 의도적 한계

- **SAM 통합 X**: kickoff 에서 언급했지만 이번 sprint 에서는 brush 만. SAM (Sprint 6.1 backend 활용) 은 별도 follow-up. brush 만으로도 사용자가 layer를 분리할 수 있고, 검증 단계로 충분.
- **Region overlap**: 두 region 이 같은 픽셀을 청구하면 정의상 모호. 일단 brush 가 union 으로 누적되는 것만 (사용자가 직접 erase 로 명확히 할 수 있음). 자동 disambiguation X.
- **Region 색깔 재할당 X**: `+ add` 시 자동 색 cycle. 사용자가 색 직접 선택 X. polish는 추후.
- **No undo/redo within split mode**: trim mode 처럼 stroke history 없음. 잘못 그리면 erase 로 복구.
- **trim mask와는 독립**: split mode 의 region masks 는 trim 의 layer mask 와 별개 채널. layer mask 는 GeneratePanel 의 erase 효과 (post-render destination-out). region masks 는 GeneratePanel 의 multi-region 분배 (E.3 에서 wiring).
- **GeneratePanel 통합 안 됨 (이번 sprint)**: 영구 저장된 regions 가 GeneratePanel 에서 auto-detect 대신 사용되는 흐름은 E.3 에서. 이번 sprint 끝에선 사용자가 region 정의/저장만 가능 — 결과물이 generation 에 영향 X.

## 검증

- typecheck 통과
- biome 통과
- `next build` 통과

## 시각 검증 가이드

```bash
git pull && pnpm install && pnpm dev

# 1. layer (multi-island layer 권장 — 上身 등) 우클릭 또는 layer row → DecomposeStudio 열기
# 2. 헤더에 [trim | split] toggle 보임 (default trim — 기존 동작)
# 3. "split" 클릭 → 사이드바가 regions 리스트로 전환
# 4. "+ add" 클릭 → 첫 region (초록) 등장. name 입력칸에 "torso"
# 5. canvas 위에서 brush 로 torso 영역 paint → 초록 overlay 로 표시
# 6. "+ add" 다시 → 두 번째 region (주황). name "frill" + 그 영역 paint
# 7. region tile 클릭으로 select 전환 — selected region 더 진하게
# 8. "save & close"
# 9. DecomposeStudio 다시 열어 "split" → 저장된 region 들이 그대로 hydrate
# 10. clear 버튼 — 현재 선택된 region 만 wipe (다른 region 은 유지)
```

E.3 에서: GeneratePanel 이 이 region 들을 검출 → manual regions 가 auto-detect 보다 우선. region tile 의 name/색깔이 panel 에도 그대로 반영 + region 별 prompt 분배.

다음: Sprint E.3 — GeneratePanel 이 manual region 우선 사용, auto-detect fallback.
