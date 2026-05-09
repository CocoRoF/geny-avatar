# 2026-05-09 — Sprint F: Pre-Phase-6 GeneratePanel polish

[`72 f_kickoff`](2026-05-09_72_f_kickoff.md) 의 4가지 nopen-blocker 일괄 처리. 한 번에 묶음 (atomic 분할도 가능했지만 서로 의존성 + 검증 단위가 합쳐져서 한 PR로):

- F.1: aside layout sticky actions footer + scrollable content
- F.2: per-region 선택 재생성 (↻ button + 상태 추적)
- F.3: applied texture revert 버튼

## 변경 surface

### `components/GeneratePanel.tsx`

#### F.1 — Layout

aside 의 단일 column → 두 영역:
- `flex-1 overflow-y-auto p-4` — 모든 control / regions / refs / refine / history / flow
- `flex-none border-t p-3` — actions: generate / apply / reset / revert texture

scroll이 길어도 actions는 항상 modal 내 visible. 6 regions 같은 케이스에서도 generate 버튼 잡힘. history 도 자동으로 scrollable area 안에 있어 modal close → reopen 시 그대로 복원.

generate 버튼 라벨 동적: `generate N regions` (multi) / `generate` (single).

#### F.2 — Per-region selective regenerate

새 state:
```ts
type RegionRunState = {
  resultBlob: Blob;       // 현재 이 region이 composite에 기여하는 blob
  status: "idle" | "running" | "succeeded" | "failed";
  failedReason?: string;
};
const [regionStates, setRegionStates] = useState<RegionRunState[]>([]);
const preparedRef = useRef<PreparedComponent[] | null>(null);
```

mount 시:
- 각 region의 isolated source canvas → blob → `regionStates[i].resultBlob` (status: "idle")
- `preparedRef.current` 캐시 (다음 호출에서 재사용)

새 helper들:
- `runRegionGen(idx, prepared, baseText, refsBlobs)` — 단일 region OpenAI 호출 + postprocess. generate-all 과 per-region regen 둘 다 사용
- `recompositeResult(blobs)` — `compositeProcessedComponents` 로 N blob 합성 + RESULT preview 갱신 + lastResultBlob 업데이트
- `regenerateOneRegion(idx)` — 단일 region 만 다시 호출:
  - regionStates[idx].status = "running"
  - cached refinement 재사용 (prompt 안 바뀌었을 때) — 새 chat call X
  - runRegionGen → 새 blob
  - regionStates[idx] 업데이트 + 다른 region 의 현재 blob 그대로 둔 상태로 recomposite

`onSubmit` (generate-all) 변경:
- preparedRef cached 사용 → isolation/pad 한 번만
- 모든 regionStates.status = "running" 표시
- `Promise.allSettled(prepared.map((_, idx) => runRegionGen(idx, ...)))`
- settled 결과로 regionStates 일괄 update + finalBlobs 수집
- 전부 실패면 `phase.failed` throw, 부분 실패는 per-tile flag로 처리
- composite from finalBlobs

region tile UI:
- 이름 input/readonly 옆에 `↻` 버튼 (per-region regen)
- 썸네일에 status overlay: running 시 "…" 어두운 overlay, failed 시 빨간 ! 배지
- bbox dim 옆에 succeeded → ✓ generated, failed → "failed" (tooltip 으로 reason)
- ↻ disabled: phase running/applying, region 자체 running, refining 중

#### F.3 — Revert texture

새 handler `onRevertTexture`:
- confirm dialog (window.confirm)
- `setLayerTextureOverride(layer.id, null)` → store 갱신 → atlas re-composite
- `deleteLayerOverride(puppetKey, layer.externalId, "texture")` → IDB 정리 (refresh 재로드 시도 원복 안 되게)
- `setPhase({ kind: "idle" })` + regionStates status reset + lastResultBlob = null
- mask 는 그대로 (texture 채널만)

actions footer 에 빨간색 작은 버튼 "revert texture":
- `existingTexture` 가 없으면 disabled (tooltip "no AI texture applied")
- 있으면 enabled

### Side effect: history 가시성

F.1 의 sticky-actions-footer 부산물. history 가 항상 scrollable area 에 있어 modal 닫고 재오픈 시 그대로. IDB persist 동작은 이미 되어있었지만 long content에 가려져 있었음. F.1 끝나면 자동 해결.

## 의도적 한계

- **per-region 동시 호출 가능**: ↻ 클릭 두 개 빠르게 → 두 region 동시 running. 충돌 없음 (각자 자기 idx 만 update). 다만 recomposite 가 두 번 일어나서 마지막 한 번만 화면에 남음.
- **revert undo X**: revert 후 "되돌리기" 버튼 없음. 사용자가 history 에서 revisit → apply 로 복원 가능.
- **per-region regen 의 refinement**: prompt 바뀌었으면 cached refined 안 씀 → raw prompt 그대로 사용. 새 refine 원하면 generate-all 한 번.
- **regionStates 가 undefined 일 때 가드**: 일부 race 가능성 — initial 빌드 도중 user 가 generate 클릭. fallback로 `prepared` 가 있으면 재계산 (캐시 miss).
- **reset states 시 status idle**: revert 후 "이전 generated 상태"가 시각적으로 사라짐. resultBlob 은 isolated source 로 reset 안 함 — composite 에 마지막 generated blob이 남아있을 수 있음 (사용자가 "혹시 다시 apply 하면 그 결과로 복원 가능"). 깔끔히 reset 하려면 panel close-reopen.

## 검증

- typecheck 통과
- biome 통과
- `next build` 통과

## 시각 검증 가이드

```bash
git pull && pnpm install && pnpm dev

# F.1 — 6+ region layer (胸 등) 진입
# 1. aside 가 길어져도 generate / apply / revert texture 항상 visible
# 2. scroll 안에 history / flow 까지 들어있음
# 3. modal close 후 다시 열면 history 그대로

# F.2 — multi-component layer
# 1. generate (예: 3 regions) → 모두 succeeded
# 2. region 2 만 마음에 안 들음 → region 2 tile 의 ↻ 클릭
# 3. region 2 썸네일에 "…" overlay, status 표시
# 4. 1~5초 후 region 2 만 새 결과로 갱신, region 1/3 은 그대로
# 5. RESULT preview 도 새 region 2 + 기존 region 1/3 의 composite
# 6. apply → atlas 에 composite 그대로 반영
# 7. region별 prompt 바꾸고 ↻ 또 누르면 그 prompt 가 적용됨

# F.3 — revert
# 1. 위에서 apply 후 atlas 에 AI texture 들어가 있음
# 2. revert texture 클릭 → confirm → atlas 가 원본 으로 복귀
# 3. revert texture 가 disabled 로 변경 (existingTexture 없음)
# 4. history 그대로 남아있음 → revisit + apply 로 복원 가능
```

## Phase 6 진입 가능 신호

- 모달 layout 막힘 해소
- per-region 비용 통제 + 부분 재생성 가능
- texture revert 가능
- history visibility 회복

이걸로 GeneratePanel UX 완성도 phase 6 진입 가능 수준. SAM segment mode (Sprint 6.2) 는 DecomposeStudio 쪽 사이드라 GeneratePanel 추가 변경 없음.
