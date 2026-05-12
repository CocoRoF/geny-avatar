# 2026-05-12 Phase 1.4 — fal.ai FLUX.2 [edit] provider 추가

**Phase / 작업**: Phase 1 작업 4 (FLUX.2 Edit provider 추가)
**상태**: done (코드 완료, 사용자 키 발급 시 즉시 동작)
**관련 계획**: [../plan/01-Phase1.md](../plan/01-Phase1.md) 작업 4

## 조사 — fal.ai API 계약

`https://fal.ai/models/fal-ai/flux-2/edit/api` + `https://fal.ai/docs/model-endpoints/queue` WebFetch:

- 인증: `Authorization: Key $FAL_KEY` 헤더.
- Submit: `POST https://queue.fal.run/fal-ai/flux-2/edit`, JSON body
  `{ prompt, image_urls: string[1..4], output_format, seed? }`.
- Status: `GET https://queue.fal.run/fal-ai/flux-2/edit/requests/{id}/status`
  — `IN_QUEUE | IN_PROGRESS | COMPLETED | FAILED | CANCELED`.
- Result: `GET https://queue.fal.run/fal-ai/flux-2/edit/requests/{id}`
  — `{ images: [{ url, ... }], seed, ... }`.
- `image_urls`는 public URL 또는 `data:image/...;base64,` data URI.
  data URI 사용 시 별도 upload step 불필요.
- `flux-2/edit`는 **instruction-following editor**라서 별도 mask 필드
  없음 (`supportsBinaryMask: false`). 소스 알파가 silhouette 역할.

## 변경

- **신설** [lib/ai/providers/falai.ts](../../lib/ai/providers/falai.ts)
  — `FalAIProvider`. queue submit → 1.5 s 폴링 → result fetch →
  fal.media URL에서 PNG 다운로드. SDK 의존 0, raw `fetch`만 사용.
  3 분 timeout, 4xx 즉시 중단 / 5xx는 재시도, IN_QUEUE / IN_PROGRESS
  는 계속 폴링.
- **수정** [lib/ai/types.ts](../../lib/ai/types.ts) — `ProviderId`에
  `"falai"` 추가.
- **수정** [lib/ai/providers/registry.ts](../../lib/ai/providers/registry.ts)
  — `falaiConfig` import / `providerConfigs` 배열에 추가 /
  `getProvider("falai")` 케이스 / `envKeyForProvider` 매핑.
- **수정** [app/api/ai/generate/route.ts](../../app/api/ai/generate/route.ts)
  — `isProviderId` type guard에 `"falai"` 추가.
- **수정** [.env.example](../../.env.example) — `FAL_KEY` 항목 추가.

## 검증

- `pnpm typecheck` ✓
- `pnpm exec biome check` ✓ (4 touched files)
- 실호출 검증: 사용자가 `FAL_KEY` 환경변수 세팅 후 `/api/ai/providers`
  결과에서 `falai` available=true 확인 → GeneratePanel picker에서
  선택 → 실제 generate 동작.

## 결정

1. **SDK 의존 0**. `@fal-ai/client` npm 패키지가 있지만 raw `fetch`
   로 충분. queue API가 단순하고, OpenAI provider도 raw fetch라 일관
   성. `pnpm add` 없이 머지 가능.
2. **base64 data URI**. `image_urls`에 public URL을 보내려면 사전
   업로드 endpoint를 또 호출해야 함. data URI는 한 번의 POST로 끝.
   1 MB PNG → ~1.4 MB base64. queue.fal.run JSON 본문 한도 안에서
   안전.
3. **3분 timeout, 1.5 s 폴링**. FLUX.2 Schnell이 보통 <5 s, Dev/Pro
   는 15-30 s. 1.5 s 폴링이 perceived latency vs API pressure 균형.
   3 분 한도는 upstream 정체 시 사용자에게 분명한 실패 메시지.
4. **safety checker off**. `enable_safety_checker: false`. anime
   character edit이 가짜 NSFW로 잡혀 빈 결과가 나오는 케이스 봉쇄.
   사용자가 의도적으로 그런 시도하면 본인 책임. 기본 옵션은 코드에
   하드코딩 — UI 노출 안 함.
5. **flux-2/edit만**. flux-2/dev, flux-2/pro 같은 vrant은 다른 모델
   path (`fal-ai/flux-2`). Phase 1에선 edit-only 한 모델만 노출.
   추가 모델은 후속 PR.
6. **별도 router는 다음 PR**. provider 추가는 user-explicit 선택만
   지원. 자동 라우팅 (`router.ts`)은 Phase 1 작업 5로 분리.

## 영향

- `GET /api/ai/providers` 응답에 `falai` 항목 자동 노출. UI picker
  drops down에 새 옵션. `FAL_KEY` 없으면 `available: false, reason:
  "FAL_KEY not set"`로 표시.
- GeneratePanel의 기존 흐름은 변경 없음. user가 명시 선택 시 onSubmit
  의 `useMultiComponent = providerId === "openai"` 분기가 false라서
  Gemini path (single source + ref) 와 동일 흐름으로 처리. flux-2/edit
  도 single source + N refs라 호환됨.
- mask 미지원: GeneratePanel에서 fal 선택 시 mask는 보내지 않음
  (`maskImage` 안 attach). DecomposeStudio mask는 어차피 generate
  시점에 무시되는 기존 정책이므로 변화 없음.

## 다음 작업

Phase 1 작업 5 — Router 신설. provider 자동 라우팅 룰:
- 단일 drawable 편집 → openai (literal).
- bulk fan-out → falai (cost).
- 명시적 user pick은 우회.

## 참조

- 손댄 파일 5개: 위 변경 섹션 참조.
- PR: 이 entry가 포함된 PR이 머지될 때 main에 들어감.
