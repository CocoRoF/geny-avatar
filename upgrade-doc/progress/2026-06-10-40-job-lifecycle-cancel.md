# #40 — Gen job 수명주기: 취소·재시도·타임아웃·정리

결함: A1 A3 A7 A8 A9 A12 A13 ([02-결함목록](../02-결함목록.md))

## 무엇을 / 어떻게

- **A1 취소 체계 (end-to-end)**: ServerJob 에 AbortController 부여 →
  `DELETE /api/ai/status/:id` = `cancelJob` (status canceled + abort) →
  provider fetch 전부에 `input.signal` 배선 (openai/gemini/falai) →
  클라 `submitGenerate({signal})` 가 abort 시 서버 취소 후 throw →
  GeneratePanel running 상태에 "취소" 버튼 + requestClose 가
  하드락 alert 대신 "취소하고 닫기" confirm 제공.
- **A3**: 폴링이 연속 4회까지 transient 실패 허용 (선형 백오프). 404 는
  hard fail (서버 재시작 — 재시도 무의미).
- **A7**: result 라우트가 bytes 전송 후 `deleteJob` — 결과 blob 1h 잔류 제거.
  타임아웃 만료 시에도 클라가 서버 job 취소.
- **A8**: 서버측 290s 천장 (`runJob` 타이머가 controller abort + failed).
  fal 폴링 타임아웃이 무언 fall-through 하던 것을 명시적 throw 로.
- **A9**: Replicate 를 picker 에서 항상 unavailable 처리 (generate 는 stub,
  SAM 은 별도 라우트라 영향 없음).
- **A12 (부분)**: running 문구를 실제 소요시간(OpenAI 1–3분)으로 정정.
  진행률 바는 보류.
- **A13**: dead code 제거 — `lib/ai/router.ts`, `buildOpenAIEditMask`,
  `convertInpaintMaskToOpenAIPadded`, 존재하지 않는 maskConvert.ts 주석 2곳
  정정. providerConfigs 순서를 OpenAI 우선으로 (첫 available = 기본 선택,
  docs-upgrade 결론 반영).

## 검증

`pnpm typecheck` / `pnpm lint` 0 error.

## 남긴 것

- 진행률(progress 필드/fal queue_position) 표시와 refine 비용 절감(A14)은 보류.
- canceled 상태에서 늦게 도착한 provider 결과는 의도적으로 폐기 (setResult 가드).
