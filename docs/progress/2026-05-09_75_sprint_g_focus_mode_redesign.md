# 2026-05-09 — Sprint G: GeneratePanel multi-region UX redesign — picker → focus mode

사용자 보고 (요약):

> "어차피 6 region을 동시에 변경하기는 매우 어렵고 그 region을 여러개로 같이 처리하는게 아니잖아. region이 여러개 있으면 modal 내에서 특정 Region source만 선택할 수 있게 만들고 그렇게 하면 modal에서 특정 region으로 진입하고 그 부분만 처리하게 만들어야 한다고."

A+B+E+F 가 multi-region 의 "동시 N 호출 (generate-all)" + "tile 별 ↻" 를 깔았는데 — 그 모델이 사용자의 실제 작업 방식과 안 맞음. 사용자는 region 하나씩 진입해서 그 region 만 보고, 그 region 만 prompt 쓰고, 그 region 만 generate 하고 싶음. 동시 처리는 거의 안 씀.

이번 sprint 가 그 흐름을 modal 의 first-class UX로 바꾼다.

## 새 UX (multi-region layer)

```
modal 진입
  ↓
PICKER VIEW
  - 큰 region 카드 그리드 (color + thumb + name + size + status)
  - 클릭 = focus 진입
  - 가장 위에 설명 + 하단에 revert texture (layer level)
  ↓
사용자 클릭 region N
  ↓
FOCUS MODE
  - 헤더: "generate · v1   layer name · [color] regionName  [← regions]"
  - SOURCE: tight-cropped isolated region (다른 region 안 보임)
  - RESULT: composite preview (그 region 만 갱신된 합성)
  - ASIDE: provider / model / [PROMPT] (이 region 전용) / refs / refine / history
  - ACTIONS: [generate this region] / apply / reset / revert texture
  ↓
"← regions" 클릭 → PICKER VIEW로 복귀 (다른 region 진입 가능)
```

single-component layer (자동 검출 1개 또는 manual region 1개):
- 자동으로 focus mode 진입 (focusedRegionIdx = 0)
- 헤더에 breadcrumb / back button 없음
- 기존 single-source UX 와 동일 — regression 0

Gemini single-source (no detection):
- 기존 흐름 그대로

## 변경 surface

### `components/GeneratePanel.tsx`

#### state

- 신규 `focusedRegionIdx: number | null` — null 이면 picker view, non-null 이면 focus mode
- mount effect 끝에서 자동 결정: `regionList.length === 1 ? 0 : null`

#### header

multi-region focus mode 일 때:
- 색깔 dot + region 이름 (label, manual.name, 또는 ordinal fallback)
- "← regions" 버튼 → `setFocusedRegionIdx(null)`

#### body 분기

```jsx
{components.length > 1 && focusedRegionIdx === null ? (
  <PickerView />
) : (
  <ThreeColumnFocusView />
)}
```

#### PickerView

- responsive grid (`grid-cols-2 sm:grid-cols-3 lg:grid-cols-4`)
- 각 카드:
  - h-32 thumb area + region 색 border + 좌상단 번호 배지
  - status overlay (succeeded ✓ / running … / failed !)
  - 이름 + bbox dim/area
- 카드 클릭 = `setFocusedRegionIdx(idx)`
- 하단에 "revert texture" 만 (generate / apply 는 region 선택 후 가능)

#### ThreeColumnFocusView (기존 3-column 재사용)

변경:
- SOURCE preview 가 focus mode 에서 isolated region tight crop 으로 paint:
  ```ts
  display.width = c.bbox.w;
  display.height = c.bbox.h;
  ctx.drawImage(aiSource, bbox crop);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(c.maskCanvas, bbox crop);
  ```
- SOURCE 헤더: "source · region N of M"
- bbox SVG overlay 제거 (이제 단일 region 만 보이니 outline 의미 없음)
- ASIDE 의 REGIONS 섹션 (`F.2/F.4` 의 tile list with ↻ + ✕) 완전히 hide — picker 와 중복
- PROMPT 라벨 / placeholder / textarea 가 focused region 에 binding:
  - `isFocusedMulti` 일 때 textarea value = `componentPrompts[focusedRegionIdx]`
  - 그 외엔 기존 panel-level `prompt`
  - PROMPT 헤더 옆 status indicator (✓ / running… / failed) + "clear" 버튼
  - failed 시 inline 빨간 panel 에 reason
- 메인 generate 버튼:
  - multi-region focus 일 때 라벨 "generate this region", click = `regenerateOneRegion(focusedRegionIdx)`
  - 그 외 기존 "generate" + `onSubmit`
  - disabled: focusedRegionState 가 running 이거나 prompt 비어있으면

#### 헬퍼 추가

- `isFocusedMulti` — `components.length > 1 && focusedRegionIdx !== null`
- `focusedPromptValue`, `setFocusedPromptValue` — 위에서 설명한 binding
- `focusedRegionState` — `regionStates[focusedRegionIdx]` 안전 접근
- `submitDisabled` 에 `focusedRegionState?.status === "running"` + `!focusedPromptValue.trim()` 추가

## 의도적 한계

- **"generate all" 제거**: 사용자가 명시적으로 안 쓴다고 함. `onSubmit` 함수는 코드 상에 남아있음 (single-component / Gemini path 가 호출). multi-region picker view 에서는 generate 버튼 자체가 disabled (focus 진입해야 가능).
- **per-region history X**: history 는 layer 단위 그대로. apply 시 composite 가 IDB row. 향후 polish 가능.
- **picker view 에서 prompt 입력 X**: focus 진입해야 prompt 입력 가능. picker 는 selection 만 — UX 의 명확성 우선.
- **focus 진입 후 prompt 보존**: `componentPrompts[idx]` 에 입력한 텍스트는 region 전환해도 메모리 유지 (panel close 시까지). 다른 region 갔다 돌아와도 그대로.
- **dead code**: `false && ...` 한 곳 (REGIONS aside section) — render 안 되지만 코드상 보존. 향후 정리 가능. 일단 한 sprint 내 변경 최소화.
- **single-component layer**: 자동 focus 0 으로 picker 안 거침. 헤더에 breadcrumb / back 없음. 기존 UX 100% 동일.

## 검증

- typecheck 통과
- biome 통과
- `next build` 통과

## 시각 검증 가이드

```bash
git pull && pnpm install && pnpm dev

# 케이스 1 — multi-region picker → focus
# 1. 6 region 胸 layer 진입 → PICKER VIEW
#    - "pick a region to edit" 설명 + region 6개 큰 카드 그리드
#    - 각 카드에 region 색 / 번호 / thumb / 이름 / 사이즈
#    - revert texture 만 보이고 generate / apply 안 보임 (region 선택 안 했으니)
# 2. region 1 카드 click → FOCUS MODE
#    - 헤더에 "胸 · [color dot] breast [← regions]" 표시
#    - SOURCE 가 region 1 만 tight crop (다른 region 안 보임)
#    - PROMPT 라벨 옆 "· this region only"
#    - generate 버튼: "generate this region"
# 3. prompt 입력 ("round soft volume") → generate
#    - region 1 만 호출, 다른 region 영향 X
#    - succeeded 시 PROMPT 헤더 옆 ✓ 표시, 인라인 status
# 4. "← regions" click → 다시 PICKER VIEW
#    - region 1 카드 우측 상단에 ✓ 표시 (succeeded)
# 5. region 3 click → FOCUS MODE for region 3
#    - region 3 의 SOURCE / region 3 의 prompt textarea (이전 region 1 의 prompt 와 별개)
# 6. apply → atlas 에 region 1 + region 3 의 generated 가 composite 로 반영
# 7. revert texture → atlas 원본 복귀

# 케이스 2 — single component
# 1. 단일 component layer 진입 → 바로 FOCUS MODE (picker 안 거침)
# 2. 기존 single-source UX 그대로 (헤더에 breadcrumb 없음)
# 3. prompt + generate 동작 동일

# 케이스 3 — Gemini
# 1. Gemini provider 선택 → 기존 single-source flow
# 2. 변화 없음
```

## 커밋 메시지 / 진행

A+B+E+F 의 multi-region UX 가 사용자 작업 흐름과 어긋났던 걸 G 가 정공 보정. 이걸로 GeneratePanel 의 multi-region 흐름이 사용자 의도 (one-region-at-a-time) 와 일치. Phase 6 진입 가능.

## 남은 follow-up

- per-region history (옵션) — region 진입 시 그 region 의 generated history 만 표시
- picker view 에 sort/filter (이름 / status / 크기 순)
- Live2D 모델 위 region 위치 viz (별도 sprint)
