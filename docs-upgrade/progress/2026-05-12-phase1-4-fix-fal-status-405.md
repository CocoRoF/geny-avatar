# 2026-05-12 Phase 1.4 hotfix — fal.ai status URL 405 fix

**Phase / 작업**: Phase 1 작업 4 hotfix
**상태**: done (fix 적용, 사용자 재검증 필요)
**관련 계획**: [../plan/01-Phase1.md](../plan/01-Phase1.md) 작업 4

## 문제

[#6](https://github.com/CocoRoF/geny-avatar/pull/6)에서 추가한 fal.ai
provider가 실제 호출에서 다음 흐름으로 실패:

```
[falai] queued request_id=019e1ca3-...
[falai] status 405:
[ai/generate] job ... failed: fal.ai status 405:
```

405 Method Not Allowed — `GET https://queue.fal.run/fal-ai/flux-2/edit/requests/{id}/status`
URL이 서버에서 받지 않는다.

(앞서 발생한 403 "User is locked. Exhausted balance"는 사용자가
잔액 충전으로 해결됨 — 이 hotfix와 무관.)

## 원인

PR #6에서 status URL을 다음과 같이 직접 구성:

```ts
const statusUrl = `${QUEUE_BASE}/${MODEL_PATH}/requests/${requestId}/status`;
const resultUrl = `${QUEUE_BASE}/${MODEL_PATH}/requests/${requestId}`;
```

`MODEL_PATH = "fal-ai/flux-2/edit"` — submit endpoint는 이 path가
정답. 하지만 실제 request_id의 status / response는 **model family
path** (`fal-ai/flux-2`)에 머무는 듯, 또는 fal.ai 내부가 다른 라우팅
규칙을 쓰는 듯. 어쨌든 직접 구성한 URL은 405.

fal.ai queue API 문서가 보여준 `https://queue.fal.run/{model-id}/...`
패턴은 일반론이고, 실제로는 **submit 응답이 알려준 `status_url` /
`response_url`을 그대로 사용**해야 한다. 응답 타입은 이미 정의돼
있었지만 ([falai.ts:188](../../lib/ai/providers/falai.ts#L188))
사용하지 않았음.

## 변경

[lib/ai/providers/falai.ts](../../lib/ai/providers/falai.ts) —
폴링 / 결과 URL을 submit response의 값으로 사용. 응답이 빠진 경우만
fallback으로 직접 구성:

```ts
const statusUrl =
  submitted.status_url ?? `${QUEUE_BASE}/${MODEL_PATH}/requests/${requestId}/status`;
const resultUrl = submitted.response_url ?? `${QUEUE_BASE}/${MODEL_PATH}/requests/${requestId}`;
console.info(`[falai] status_url=${statusUrl}\n         response_url=${resultUrl}`);
```

콘솔 로그 추가 — 실제로 사용된 URL을 확인할 수 있게.

## 검증

- `pnpm typecheck` ✓
- `pnpm exec biome check` ✓
- 실호출 검증: 사용자가 GeneratePanel에서 fal.ai FLUX.2 선택 → 동일
  케이스 재시도 → 콘솔에 `[falai] status_url=...` 로그로 실제 URL
  확인 + `[falai] completed in Xms` 결과 정상 도착.

## 결정

1. **submit response의 URL 우선, hardcoded fallback 유지**. 향후
   fal.ai가 응답 schema 변경해도 fallback이 일정 부분 흡수. 다만
   schema 변경이 클 경우 fallback도 같이 깨질 가능성 — 그땐 다시
   schema 확인.
2. **콘솔 로그에 status_url 노출**. 다음 디버깅 시 처음 봐야 할 정보.
   API key는 노출 안 됨 (URL 자체엔 키 안 들어감).
3. **별도 entry로 분리**. 같은 작업 (1.4) 의 hotfix이지만 분명히
   별개 PR / 별개 진행 로그로 기록 — Phase 1 closure entry의
   Criterion 3 검증 trace에서 이 hotfix를 참조할 수 있게.

## 영향

- 사용자가 다시 시도하면 정상 동작해야 함. fal-2/edit의 status
  endpoint가 실제로 어디인지 첫 호출 로그에서 확인 가능.
- 만약 여전히 실패하면: 콘솔의 `status_url=...` 출력값이 의심스러운
  형태인지 확인 (예: undefined로 떨어져 fallback이 그대로 405 가는
  경우). 그땐 submit 응답 body 전체를 한 번 로깅하는 추가 PR.

## Phase 1 closure 영향

[2026-05-12-phase1-closure.md](2026-05-12-phase1-closure.md)의
Criterion 3 (FLUX.2 실호출 검증)이 이 hotfix 머지 후에야 진짜 측정
가능. closure entry의 "측정 결과 기록" 섹션에 hotfix 머지 후 다시
시도 결과를 append.

## 참조

- 손댄 파일 1개: `lib/ai/providers/falai.ts`.
- PR: 이 entry가 포함된 PR이 머지될 때 main에 들어감.
