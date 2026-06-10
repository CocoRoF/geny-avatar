# #41 — GeneratePanel 정합

결함: A2 A4 A5 A6 A10 A11 ([02-결함목록](../02-결함목록.md))

## 무엇을 / 어떻게

- **A2**: focus 모드 푸터 generate 가 non-OpenAI provider 에서 무언 no-op
  하던 것을 whole-layer onSubmit 으로 폴백. 타일별 ↻ 버튼은 이미
  `providerId !== "openai"` 비활성이라 그대로.
- **A4**: 멀티리전 첫 실행 시드가 `new Blob()`(0바이트) 대신 각 region 의
  **isolated source PNG** — 실패 region 이 "변경 없음"으로 합성되어 부분
  성공이 살아남음. 합성 입력에서 0바이트 blob 방어 필터도 추가.
- **A5**: `padInpaintMaskRegionRefToOpenAI` 신설 — layer 치수 마스크를
  region 의 sourceBBox 로 크롭해 paddingOffset 에 배치, image[1](tight-crop
  padded island)과 실제로 정렬. 프롬프트의 "same dimensions and alignment"
  단언이 참이 됨.
- **A6**: refine 캐시에 `scopeKey`(region idx + negative + refs 수) 추가 —
  같은 텍스트의 다른 region 간 vision-grounding 오염 차단.
- **A10**: re-blend effect 를 `aiBlob` identity 로 키잉 + setPhase 에 stale
  가드 — 새 결과를 옛 blend 가 revoke/덮어쓰는 레이스 제거.
- **A11**: `buildSubmitRefs`(user refs + canonical snapshot) 를 whole-layer 와
  per-region 이 공유 — 같은 region 이 버튼에 따라 다른 payload 를 받던 문제
  해소. 멀티리전 fan-out 에 동시성 캡 3 (`allSettledWithConcurrency`).
  `activeRefBlobs` 는 useMemo 로 안정화.

## 검증

`pnpm typecheck` / `pnpm lint` 0 error (warning 14).
