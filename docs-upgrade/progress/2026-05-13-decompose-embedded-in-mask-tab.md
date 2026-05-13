# 2026-05-13 hotfix — MASK 탭이 DecomposeStudio 본체를 재사용

**Phase / 작업**: PR #17~#19 follow-up (4차, 사용자 의도 진정 충족)
**상태**: done
**관련 계획**: [../plan/01-Phase1.md](../plan/01-Phase1.md)

## 사용자 지적

> "Edit에서 mask랑 완전히 동일한 메커니즘이여야 하는데 UI부터 시발
> 모든게 다 다르잖아 그냥 동일하게 만들라고"

PR #19까지 GenerateMaskEditor를 reusable primitive로 강화 (`useCanvasViewport`,
`BrushCursor`)했지만 UI 자체 (Toolbox / OptionsBar / HistoryPanel / MarchingAnts
등)는 DecomposeStudio와 달랐다. 사용자가 진짜 원한 건 **DecomposeStudio
와 픽셀 단위로 동일한 UI**.

## 결정 — DecomposeStudio 본체 재사용

별도 컴포넌트 (GenerateMaskEditor) 유지 + Toolbox / OptionsBar 등을
하나씩 prop 매칭하는 길은 결국 DecomposeStudio 사본을 만드는 셈. 이번
PR로 **DecomposeStudio 컴포넌트 자체를 GeneratePanel MASK 탭에 embed**:

- 같은 컴포넌트 → 같은 Toolbox / OptionsBar / BrushCursor / HistoryPanel /
  MarchingAnts / WandActionBar / 단축키 / viewport / 마스크 strokeEngine.
- 출력 채널만 다름: DecomposeStudio mask vs inpaint mask가 의미가
  정반대라 새 콜백 (`onMaskCommit`)으로 분리.

## 변경

### `components/DecomposeStudio.tsx` props 확장

- `embedded?: boolean` — modal wrapper (fixed inset / backdrop /
  click-to-dismiss) 생략. inline child로 마운트 가능.
- `onMaskCommit?: (blob: Blob | null) => void` — set이면 store
  `setLayerMask` 대신 콜백 호출. 두 mask 컨벤션이 정반대라
  intentionally 분리된 destination 사용.
- `onClose?: () => void` — embedded mode 닫기. 표준 모드는
  `setStudioLayer(null)` 그대로.
- `maskBaseline?: Blob | null` — embedded mode가 store의 hide-mask를
  baseline으로 끌어오지 못하게 외부에서 명시. 부모(GeneratePanel)의
  `inpaintMaskBlob`을 전달.

### Wrapper 추상화

`fixed inset-0 z-40 ...` 외곽 div와 modal 본체 div를 `<Wrapper>`
컴포넌트로 추출. `embedded ? inline-flex-col : modal-overlay` 분기.
DecomposeStudio 본체 JSX는 children으로.

### setMask 호출 두 지점에 콜백 분기

- `onSaveMask` (line 1355 부근): `onMaskCommit` set이면 `onMaskCommit(blob)`,
  아니면 기존 `setMask(layer.id, blob)`. close 호출도 `onClose`로 분기.
- Clear mask action (line 1683 부근): 동일 분기로 `onMaskCommit(null)`.

### existingMask 소스 분기

```ts
const existingMaskFromStore = useEditorStore((s) => s.layerMasks[layer.id] ?? null);
const existingMask = embedded ? (maskBaseline ?? null) : existingMaskFromStore;
```

embedded면 store 무시, `maskBaseline` prop을 baseline으로 사용.

### `components/GeneratePanel.tsx` — MASK 탭 교체

이전 `<GenerateMaskEditor ... />` → `<DecomposeStudio embedded ... />`.
DecomposeStudio가 받는 props:
- `adapter`, `layer`, `puppetKey` — 기존 그대로.
- `embedded` — true.
- `maskBaseline={inpaintMaskBlob}` — 탭 전환 시 mask state 보존.
- `onMaskCommit={setInpaintMaskBlob}` — save 시점에 GeneratePanel state로.
- `onClose={() => setActiveTab("gen")}` — DecomposeStudio close 누르면
  GEN 탭으로 돌아옴.

import:
```ts
- import { GenerateMaskEditor } from "./GenerateMaskEditor";
+ import { DecomposeStudio } from "./DecomposeStudio";
```

### `components/GenerateMaskEditor.tsx` 삭제

DecomposeStudio가 100% 대체. PR #17~#19에서 한 작업이 통째로
DecomposeStudio embed로 교체됨. 다만 그 PR들의 시도 (multiply blend
색감 fix, source alpha auto-derive, viewport import 등)는 향후
DecomposeStudio가 같은 인프라 위에 동작하니 그 작업이 헛수고는
아니었음 — 다만 DecomposeStudio가 이미 그 모든 걸 가지고 있어서
recreation이 무의미했다는 게 이번 PR의 인정.

## 검증

- `pnpm typecheck` ✓
- `pnpm exec biome check` ✓ (기존 unused-var 경고 3건은 손 안 댄 곳)
- 실호출 검증: 사용자가 dev 재시작 후
  1. GeneratePanel → [MASK] 탭.
  2. DecomposeStudio 본체가 inline mount — Toolbox / OptionsBar /
     HistoryPanel / 모든 단축키 / 마우스휠 zoom / Space pan / HD edge
     등 100% DecomposeStudio와 동일.
  3. mask 그리고 "save & close" → GEN 탭으로 돌아옴 + inpaintMaskBlob
     갱신.
  4. GEN ↔ MASK 자유 전환, mask state 보존.
  5. mask 그린 채 fal.ai flux-inpainting → generate → 콘솔에
     `user-painted in MASK tab (NNNB)`.

## 결정

1. **GenerateMaskEditor 시도는 폐기 (PR #17~#19)**. 사용자 의도가
   "동일 UX"인데 sub-component 매칭 식으로 만들면 결국 사본. 본체
   재사용이 답.
2. **mode 토글 (mask/split/paint) 은 embedded mode에서도 그대로 노출**.
   사용자가 split 또는 paint 모드로 전환 가능 — 그러나 그쪽 출력은
   `onMaskCommit`이 받지 않으므로 결과적으로 GeneratePanel inpaint
   에 영향 없음. 향후 split/paint mode를 embedded에서 hide하는 게
   더 깔끔할 수 있지만 이번 PR 범위 외.
3. **`maskBaseline` prop으로 state 보존**. inpaintMaskBlob을 baseline
   으로 전달 → DecomposeStudio가 매 mount시 기존 mask 위에서 시작.
4. **DecomposeStudio 본체 미수정 (mask 로직 / brush / viewport / 단축키
   / Toolbox / OptionsBar)**. Wrapper 추상화 + 콜백 분기 + baseline
   prop 외 추가 동작 변경 없음. 표준 모드 회귀 없음.

## 영향

- MASK 탭 UI가 DecomposeStudio와 픽셀 단위로 일치.
- DecomposeStudio 의 향후 개선이 양쪽 동시 혜택.
- GeneratePanel 의 `inpaintMaskBlob` state + `buildInpaintMaskFromAlpha`
  fallback 흐름 (mask 안 그리면 source alpha auto-derive) 은 그대로.
- DecomposeStudio 표준 모드 (LayersPanel → 일반 mask 흐름) 회귀 없음.

## 후속 (백로그)

- **embedded mode에서 split/paint mode 토글 hide**. mask mode만 노출.
- **`save & close` 텍스트 embedded mode 시 "save → return to GEN"** 같은
  명시. UX hint.
- **DecomposeStudio가 embedded일 때 fullscreen 토글 hide**. 이미
  fixed inset 없으니 fullscreen 무의미.

## 참조

- 손댄 파일 3개:
  - `components/DecomposeStudio.tsx` (props 확장 + Wrapper 추상화 +
    콜백 분기 + baseline 분기)
  - `components/GeneratePanel.tsx` (MASK 탭 mount 교체 + import)
  - `components/GenerateMaskEditor.tsx` (삭제)
- PR: 이 entry가 포함된 PR이 머지될 때 main에 들어감.
