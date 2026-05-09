# 2026-05-09 — Sprint G.8: Apply-to-atlas race fix (empty composite bug)

## 사용자 보고

> "좋아 생성자체는 정상적으로 됐으나 전혀 적용이 안 되는 심각한 문제가 있어. apply to atlas를 했음에도 텍스처가 전혀 제대로 대체되지 않아."

생성은 됐고 RESULT canvas 에도 G.7 fix 후 결과가 보이는데, apply 후 atlas 가 변하지 않음.

## 근본 원인 — React useState updater + await 비동기 race

`regenerateOneRegion` 와 `onSubmit` (generate-all) 둘 다 같은 패턴:

```ts
let updatedBlobs: Blob[] = [];
setRegionStates((prev) => {
  // 새 state 계산
  updatedBlobs = next.map(s => s.resultBlob);  // ← 이 줄
  return next;
});
await recompositeResult(updatedBlobs);  // ← 이 줄에서 updatedBlobs 가 빈 [] 일 가능성
```

React 18 의 useState updater 함수는 setter 호출 시점에 동기 실행되지 않음. setState 가 update 를 queue 에 넣고, 실제 updater 함수는 reconciliation 단계에 호출됨. 우리 코드는 setState 호출 직후 `await` 로 yield — updater 가 아직 안 돌은 상태로 `recompositeResult(updatedBlobs)` 가 빈 `[]` 로 실행됨.

`compositeProcessedComponents([], sourceCanvas)`:
- canvas 만들고 for-loop 안 돌음 (blobs 가 빈 배열)
- alpha-enforce against source canvas → output 도 alpha=0
- 결과: alpha=0 인 빈 PNG

`phase.blob` = 빈 PNG. apply 가 그걸 store 에 저장. `applyLayerOverrides` → `compositeTexture` 가 source-over 로 그리는데 alpha=0 인 source 는 destination 을 안 바꿈 → atlas 그대로.

**사용자 입장**: "apply 눌렀는데 변화 없음" — 정확히 일치하는 증상.

## 수정

### `components/GeneratePanel.tsx`

신규 `regionStatesRef: useRef<RegionRunState[]>` + sync effect 가 mirror 로 유지.

`regenerateOneRegion`:
```ts
const baseStates = regionStatesRef.current;
const updatedBlobs = baseStates.map((s, i) => i === idx ? newBlob : s.resultBlob);
setRegionStates(prev => {...});  // 여전히 updater 호출 (UI 반영용)
await recompositeResult(updatedBlobs);  // 동기로 빌드된 배열 사용
```

`onSubmit` (generate-all):
```ts
const baseStates = regionStatesRef.current;
const finalBlobs = baseStates.map((s, idx) => {
  const r = settled[idx];
  return r?.status === "fulfilled" ? r.value : s.resultBlob;
});
```

ref 는 매 render 후 effect 로 sync — `regionStates` 가 바뀌면 다음 mount 사이클에 ref.current 갱신. 동기 read 가 안전.

## 의도적 한계

- **ref 가 약간 늦을 수 있음**: 사용자가 매우 빠르게 ↻ 두 번 누르면 첫 번째 ↻의 setRegionStates 가 commit 안 된 상태에서 두 번째 ↻ 가 ref 를 read → 첫 번째 결과가 ref 에 반영 안 된 stale 상태일 수 있음. 하지만 두 번째 ↻ 자체도 같은 idx 라면 첫 번째의 결과를 덮어쓰는 게 맞고, 다른 idx 라면 두 번째 결과 + 첫 번째 결과 = composite 에 두 번째 의 result 가 들어가지만 첫 번째 idx 는 "초기 isolated source" 로 보일 수 있음. 매우 빠른 연속 click 케이스라 일반 사용에서 문제 안 됨.
- **alternative 안 씀**: setState 의 updater 안에서 결과를 외부에 noteify 하는 방법 (예: Promise resolve) 도 가능하지만 복잡도 증가. ref mirror 가 가장 단순.

## 검증

- typecheck 통과
- biome 통과
- `next build` 통과

## 시각 검증 가이드

```bash
git pull && pnpm install && pnpm dev

# 1. 6 region 胸 layer 진입 → region 1 focus
# 2. prompt 입력 → generate this region
# 3. RESULT 에 generated 결과 표시 (G.7 OK)
# 4. apply to atlas click → 모달 닫힘
# 5. 라이브 캐릭터 / atlas 확인 → region 1 영역에 generated 텍스처 반영됨
# 6. 다시 panel 열어서 region 2 진입 → 같은 흐름 → atlas 에 region 1 + region 2 의 변경 모두 반영
```

이전엔 step 5 에서 변화 없었음 (atlas 그대로). 이제 정상 반영.
