# 2026-05-13 hotfix — MASK 탭 풀세트화 (zoom/pan/cursor/undo/단축키)

**Phase / 작업**: PR #17/#18 follow-up (3차)
**상태**: done
**관련 계획**: [../plan/01-Phase1.md](../plan/01-Phase1.md) +
[2026-05-13-mask-tab-fixes.md](2026-05-13-mask-tab-fixes.md)

## 사용자 지적

> "브러쉬로 컨트롤해도 되는지 전혀 모르겠고 캔버스의 확대 축소 등
> 고도화 로직이 전혀 제대로 작동하지 않아. Edit 모드에서 제공하는
> MASK와 완벽하게 동일한 로직 / 기능 / 고도화 로직등이 전부 작동할
> 수 있게 만들어."

PR #17/#18로 brush canvas + multiply blend는 갖췄지만 zoom/pan/단축키
/undo가 없어 사용성 부족. DecomposeStudio MASK 모드 수준의 도구가
요구됨.

## 결정 — DecomposeStudio 재사용 vs 풀세트 자체 구현

후보:
- **A. DecomposeStudio 컴포넌트 자체를 GeneratePanel MASK 탭에서
  재사용 (mode prop 추가)**. UX 100% 일치 보장. 다만 DecomposeStudio
  가 자체 modal (fixed inset z-40) + store-binding (close, setMask)
  으로 lifecycle 깊게 묶여 있어 modal-안-modal + 출력 채널 분기 + close
  콜백 재배선 등 거대한 리팩토링.
- **B. DecomposeStudio가 의존하는 reusable primitives를 import해서
  GenerateMaskEditor 자체에 풀세트 구현**. UX 거의 동일 (같은 hook /
  컴포넌트 공유). DecomposeStudio 자체는 안 건드림. 작업량 한 파일.

→ **B 채택**. 추출된 hook (`useCanvasViewport`)과 컴포넌트
(`BrushCursor`)가 이미 `lib/avatar/decompose/` + `components/decompose/`
에 reusable로 분리되어 있어, 그대로 import만 하면 동일한 zoom/pan/
brush-cursor 동작 확보.

## 변경 (components/GenerateMaskEditor.tsx 전면 재작성)

- **`useCanvasViewport` import + 통합** (`lib/avatar/decompose/useCanvasViewport`):
  - container ref 전달, wrapper에 `transform: translate(panX, panY)
    scale(zoom)` CSS 적용.
  - 마우스휠 zoom (cursor 위치 고정).
  - Space (hold) drag = pan, 중간 마우스 버튼 drag = pan.
  - `viewport.isPanning` / `viewport.spaceHeld` 로 pointer 흐름 분기 —
    pan 모드면 viewport pan handler, 아니면 brush.
- **`BrushCursor` import + 통합** (`components/decompose/BrushCursor`):
  - state-tracked canvas element (`displayEl: useState`) 로 mount 감지.
  - 브러시 크기 / source width / paint vs erase 색상을 props로 전달.
  - 240Hz pen에서도 React state 안 쓰는 ref-기반 DOM 변이로 부드러움.
- **Undo/Redo 자체 history stack**:
  - canvas snapshot 배열 (max 30개) + pointer index.
  - 매 stroke commit / fill-all / clear / invert 후 push.
  - Ctrl+Z / Ctrl+Shift+Z 단축키.
  - 툴바에 `undo` / `redo` 버튼 + disabled state (depth 0일 때).
- **Photoshop-style 단축키**:
  - `B` = paint tool
  - `E` = erase tool
  - `[` / `]` = brush size 감소/증가 (BRUSH_STEP=4)
  - `Ctrl+Z` / `Ctrl+Shift+Z` = undo / redo
  - `Ctrl+0` = fit, `Ctrl+1` = 100% zoom
  - input/textarea fokus 시 단축키 비활성화.
- **툴바 강화**: paint/erase + size + undo/redo + fill-all/clear/invert
  + fit/100%/zoom-in/zoom-out 버튼. 각 버튼에 title 툴팁 (단축키 노출).
- **viewport status bar**: 오른쪽에 `white = AI redraws · black = AI
  leaves alone · space = pan · wheel = zoom` 안내.
- **wrapper CSS**: `aspect-ratio: ${w} / ${h}`, `height: 100%`, transform-
  origin center, willChange transform. DecomposeStudio와 동일 패턴.
- **cursor 분기**: pan 모드면 grab/grabbing, 아니면 crosshair.

## 검증

- `pnpm typecheck` ✓
- `pnpm exec biome check components/GenerateMaskEditor.tsx` ✓
- 실호출 검증: 사용자가 dev 재시작 후
  1. GeneratePanel → [MASK] 탭.
  2. **brush cursor (원형 outline)** 가 마우스 따라 보임.
  3. 마우스휠 → cursor 중심으로 zoom in/out.
  4. Space 누르고 drag → pan.
  5. 중간 마우스 버튼 drag → pan.
  6. B / E 단축키 → tool 전환.
  7. [ / ] 단축키 → brush size.
  8. paint → Ctrl+Z 로 undo, Ctrl+Shift+Z 로 redo.
  9. Ctrl+0 / Ctrl+1 → fit / 100% 줌.
  10. fill all / clear / invert 버튼.
  11. [GEN] 탭 ↔ [MASK] 탭 전환 시 mask state + history 보존.

## 결정 (구현 시점)

1. **별도 history stack** (DecomposeStudio의 `useHistory` hook 안 씀).
   useHistory는 multi-canvas CanvasKey pattern으로 분기 — single mask
   에선 over-engineered. 30개 canvas snapshot 단순 배열로 동일 결과.
2. **wrapperRef는 transform 직접 style로 적용**. ref 자체는 사용 안
   하지만 향후 DOM 조작 필요 시 확장 가능. (biome 경고 없음 — 선언
   적 ref는 OK.)
3. **`willReadFrequently: true`** offscreen mask canvas에 명시. 자주
   pixel 조작 (`getImageData` for invert)이 일어나므로 GPU 데모션 회피.
4. **단축키는 window-level listener**. 모달 외부 focus 가도 동작.
   다만 input/textarea focus 시 비활성화 (prompt 입력 중 안 끊김).
5. **DecomposeStudio 자체 미수정**. 두 surface 분리 유지. 공유는 hook
   레벨만.

## 영향

- MASK 탭이 DecomposeStudio 수준의 brush 도구 제공.
- DecomposeStudio 본체 변경 0 — 양쪽 분리된 동작.
- 단축키 충돌 없음 (B/E/[/]는 DecomposeStudio에도 있지만 modal이
  서로 다른 시점에 active).
- BrushCursor / useCanvasViewport 의 향후 개선이 양쪽 동시 혜택.

## 후속 (백로그)

- **magic wand (SAM)**: DecomposeStudio의 wand → mask 흐름을 MASK 탭
  에도. 별도 PR.
- **opacity / hardness brush options**: DecomposeStudio OptionsBar 와
  동등. 별도 PR.
- **HD edge**: alpha-aware soft brush. 별도 PR.
- **decompose components의 Toolbox 컴포넌트 통합**: 현재 inline 툴바.
  Toolbox 컴포넌트 재사용으로 visual consistency.

## 참조

- 손댄 파일 1개: `components/GenerateMaskEditor.tsx` (전면 재작성).
- PR: 이 entry가 포함된 PR이 머지될 때 main에 들어감.
