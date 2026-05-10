# 2026-05-10 — GeneratePanel parity upgrades: size + close guard + per-region revert + per-region history

DecomposeStudio가 받은 polish들 ([progress/82](2026-05-09_82_decompose_modal_size_and_close_guard.md), [83](2026-05-10_83_decompose_aspect_ratio_fix.md))을 GeneratePanel 에도 동일 수준 적용 + 사용자가 추가로 요청한 **per-region revert** 와 **per-region history**.

## 사용자 보고

```
Edit 모달 뿐 아니라 Gen 모달도 동일한 수준으로 업그레이드.
얘도 중간에 꺼지면 안 되잖아.
Edit Panel에서 특정 Region만 revert 할 수 있는 기능이 반드시 있어야 하고
그리고 개별 Region 단위로 History가 동작해야 하는데 제대로 동작하지 않아.
```

## 변경 요약

### 1. 모달 사이즈 + 사이드바

이전:
- `h-[90vh] w-[min(92vw,1200px)]` 모달
- `grid-cols-[1fr_1fr_320px]` (sidebar 320px)

이후:
- `h-[95vh] w-[min(96vw,1800px)]` 모달
- `grid-cols-[1fr_1fr_480px]` (sidebar 480px, +50%)

DecomposeStudio 기준과 동등. SOURCE / RESULT / ASIDE 3-column 비율 — 두 preview 가 wider 모달의 추가 공간을 자연스럽게 흡수, sidebar 의 prompt textarea / refs / refine / history 가 cramped 하지 않게 됨.

### 2. Close guard

신규 `requestClose` helper 가 모든 dismiss path 의 게이트키퍼:

```ts
const requestClose = useCallback(() => {
  // 진행 중이면 무조건 reject (alert) — API 호출 비용 이미 지불됨
  if (phase.kind === "running" || phase.kind === "submitting" ||
      phase.kind === "applying" || refining) {
    window.alert("Generation is in progress — please wait or use 'reset · keep generating' to discard the run before closing.");
    return;
  }
  // unapplied result 있으면 confirm (composite or any region succeeded)
  const hasUnappliedComposite = phase.kind === "succeeded";
  const hasUnappliedRegion = regionStates.some((s) => s.status === "succeeded");
  if (hasUnappliedComposite || hasUnappliedRegion) {
    const ok = window.confirm(
      "You have an unapplied generated result.\n\n" +
      "Click OK to discard and close.\n" +
      "Click Cancel to keep editing (use 'apply to atlas' to keep the result)."
    );
    if (!ok) return;
  }
  close(null);
}, [phase.kind, refining, regionStates, close]);
```

3개 path 모두 `requestClose` 거침:
- header "close" 버튼
- 모달 외부 backdrop click
- Esc 키

### 3. Per-region revert

원본 source 추출 + 해당 region 만 revert + 즉시 atlas 반영.

**originalSourceCanvasRef**: mount 시 `extractCurrentLayerCanvas(adapter, layer, { texture: null })` 로 추출 (existingTexture 없을 땐 aiSource 와 동일이라 alias). 항상 layer 의 pristine 상태.

**onRevertFocusedRegion**:
1. `isolateWithMask(originalSourceCanvas, focusedComponent.maskCanvas)` → 그 region 의 pristine isolated canvas
2. blob 변환 → `regionStates[focused].resultBlob` 으로 swap
3. 다른 region 의 현재 blob 들 그대로 + recompose
4. `setLayerTextureOverride(layer.id, composite)` → atlas 즉시 갱신
5. confirm 미리 — "Revert region 'name' to its original atlas content? Other regions' edits stay applied."

`regionStatesRef` 패턴 활용 (G.8 race fix 와 동일) — useState updater 의 비동기성 회피.

신규 actions footer 버튼:
- multi-region focus mode 일 때만 "revert this region" (red border)
- existing "revert texture" → "revert layer · all regions" 로 라벨링 (둘 명확 구분)

### 4. Per-region history

#### IDB 스키마

`AIJobRow` 에 `regionSignature?: string` (optional) 추가. Dexie 스키마 indexes 그대로 — 인덱싱 안 하는 추가 column 만 dynamic insert. v9 schema bump 불필요.

`saveAIJob` 가 input 에서 그대로 통과.

#### onApply 수정

apply 시 focused region 의 bbox signature 를 row 에 기록:

```ts
const focusedComp = isFocusedMulti && focusedRegionIdx !== null
  ? components[focusedRegionIdx]
  : null;
const regionSig = focusedComp ? componentSignature(focusedComp.bbox) : undefined;
await saveAIJob({ ..., regionSignature: regionSig });
```

single-source / picker view 의 apply 는 undefined → 모든 view 에서 보임.
multi-region focus mode 의 apply 는 그 region 의 sig → 해당 region focus 시에만 보임.

#### history filter

신규 `visibleHistory` derived state:

```ts
const visibleHistory = useMemo(() => {
  if (!isFocusedMulti || focusedRegionIdx === null) return history;
  const sig = componentSignature(components[focusedRegionIdx].bbox);
  return history.filter((r) => r.regionSignature === sig);
}, [history, isFocusedMulti, focusedRegionIdx, components]);
```

history rendering + comparison 에 `visibleHistory` 사용.

헤더에 indicator: focus mode 면 "history · N (this region · M total)" 로 filter 활성 표시.

## 의도적 한계

- **revert this region 은 confirm dialog 1번**: 잘못 클릭 방지. 더 부드럽게 toast로는 후속 polish.
- **regionSignature 가 undefined 인 옛 row**: focus mode 에서 안 보임. picker / single-source 에서만 등장. 의도된 동작 (어느 region 인지 모름).
- **per-region history 가 apply 단위만**: regenerate 만 하고 apply 안 한 시도 들은 history 에 안 들어감. apply 가 commit 점.
- **revert this region 후 history**: 새 entry 안 만듦. revert 가 "되돌리기" 라 history 에 안 들어가는 게 맞다고 판단. 향후 polish 가능.
- **picker view 에서 close guard**: picker 에선 `phase.kind === "succeeded"` 가 거의 false (regen 안 했으니), 그래서 confirm 거의 안 뜸 — picker mode 사용감 동일.

## 검증

- typecheck 통과
- biome 통과
- `next build` 통과

## 시각 검증 가이드

```bash
git pull && pnpm install && pnpm dev

# 1. multi-region layer (예: 胸) → GeneratePanel
# 2. 모달 사이즈가 이전보다 훨씬 큼 (1080p 에서 거의 96vw)
# 3. sidebar 가 480px 라 prompt / refs / refine / history 모두 cramped 안 함
#
# Close guard:
# 4. picker view 에서 close 클릭 → 즉시 닫힘 (변경 없음)
# 5. region 1 진입 → "generate this region" 클릭 → 진행 중에 close → alert "in progress, please wait"
# 6. generation 완료 후 close → confirm "You have an unapplied generated result..."
#    Cancel → 모달 유지, OK → 잃고 닫힘
# 7. apply to atlas → 모달 그대로, 다시 close → 즉시 닫힘 (apply 후 phase=succeeded 지만 regionStates 도 정리됨)
#    실제로는 phase.kind succeeded 면 confirm 뜸 — apply 후엔 reset 도 권장
#
# Per-region revert:
# 8. region 1 generate → apply (atlas 반영됨)
# 9. region 2 generate → apply (region 1 + region 2 모두 반영)
# 10. region 1 focus → "revert this region" 클릭 → confirm → atlas 의 region 1 만 원본 복귀, region 2 는 그대로
# 11. "revert layer · all regions" 클릭 → atlas 의 모든 AI texture 제거
#
# Per-region history:
# 12. 같은 layer 에서 region 1 apply 2회, region 2 apply 1회
# 13. picker view → history 3 (전체)
# 14. region 1 focus → history 2 (this region · 3 total) — region 1 만
# 15. region 2 focus → history 1 (this region · 3 total) — region 2 만
```

## 남은 polish

- 인라인 toast / banner UI (window.confirm/alert 대체)
- region revert 도 history entry 로 기록 (revisit 으로 되돌리기 취소)
- regionSignature 없는 옛 row 처리 옵션 ("legacy" 라벨로 항상 보이게)
- picker view 에 region 별 history count badge
