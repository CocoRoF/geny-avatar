# #45 — Paint 강화 1: Opacity + Shift 직선 + 커서 색 미리보기

계획: [03-에디터-강화.md](../03-에디터-강화.md) P-1, P-2(부분)

## 무엇을 / 어떻게

- **Opacity 슬라이더 (1–100%)**: `BrushConfig.opacity` 신설 — dab 알파에 곱,
  pressure-opacity 다이내믹과 곱으로 합성. OptionsBar 의 brush/eraser 섹션에
  슬라이더 (eraser 에도 적용 — 부분 지우기 가능해짐).
- **Shift+클릭 직선**: 직전 스트로크 끝점(`lastStrokeEndRef`, 드래그 중에도
  갱신)에서 클릭 지점까지 StrokeEngine 의 spacing 보간으로 직선 스탬프 —
  포토샵 표준 동작. 모든 모드(mask/split/paint)에서 동작.
- **커서 색 미리보기**: paint 모드 + brush 도구일 때 BrushCursor 링이
  전경색으로 표시 (기존 props 활용).

## 검증

`pnpm typecheck` / `pnpm lint` 0 error.

## 남긴 것 (03 문서의 후속 항목)

- P-2 잔여: X 색 스왑(현재 brush↔eraser 토글과 충돌 — 재배정 결정 필요),
  최근 색 스와치. P-3 블렌드 모드, P-4 선택 결합, P-5 HSL 조정, P-6 페이지
  편집 진입점 → #46-47.
