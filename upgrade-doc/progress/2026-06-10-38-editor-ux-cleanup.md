# #38 — 에디터 UX 소정리 + 죽은 코드 제거

결함: E15 E16 E18 E19 ([02-결함목록](../02-결함목록.md))

## 무엇을 / 어떻게

- **E16**: Move(V) 도구 드래그가 Hand 와 동일한 pan 제스처로 동작 — 툴팁이
  약속하던 "캔버스 이동"이 실제로 됨.
- **E15**: 진짜 1:1 구현 — `viewport.zoomTo(z)` 신설, DecomposeStudio 의
  `actualSize` 가 `source.width / (zoom 1 기준 wrapper 폭)` 으로 픽셀 퍼펙트
  100% 줌을 계산. 기존 "1:1" 은 fit 과 동일했음.
- **E19**: auto-detect region 덮어쓰기 확인창을 2단계로 — 취소가 진짜 취소.
- **E18 죽은 코드 제거**: `applyBrushDab`(StrokeEngine 으로 대체된 잔재),
  `pointerPosRef`(write-only), sync `floodFill.ts` 모듈(임포터 0),
  `clientToSourcePixel`/`panBy`/`actualSize`(미사용 viewport 헬퍼),
  `setMode` 호환 shim, `pushInputs`(호출자 0), `SELECTION_OPS` 상수,
  `CompositorInputs` 미사용 임포트. OptionsBar 의 브러시 단축키 안내 오기
  ("±5px" → "×0.85/×1.15") 정정. lint 의 useOptionalChain 에러 1건도 정리.

## 검증

`pnpm typecheck` 통과, `pnpm lint` 0 error (warning 17→13, 죽은 코드 제거 효과).
