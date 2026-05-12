# 2026-05-12 hotfix — jobs Map을 globalThis 기반 singleton으로

**Phase / 작업**: 인프라 hotfix (Phase 1 검증 차단 해소)
**상태**: done (fix 적용, 사용자 재검증 필요)
**관련 계획**: —

## 문제

[PR #9](https://github.com/CocoRoF/geny-avatar/pull/9)로 fal.ai status URL
이슈 해소된 후, 사용자 재시도 콘솔:

```
GET /api/ai/status/3d32accc-3382-462a-a9aa-61a33a4e565b 404 in 262ms
[falai] queued request_id=019e1ca7-...
[falai] status_url=https://queue.fal.run/fal-ai/flux-2/requests/.../status
         response_url=https://queue.fal.run/fal-ai/flux-2/requests/...
```

POST `/api/ai/generate`는 정상으로 jobId `3d32accc-...`를 발급했지만,
1.5 s 뒤 client가 GET `/api/ai/status/3d32accc-...`를 폴링하면 우리
자체 server에서 **404 job not found**. fal.ai 호출 자체는 그 사이에
정상 진행 중 (status_url 출력 확인).

## 원인

[lib/ai/server/jobs.ts](../../lib/ai/server/jobs.ts)의 `jobs` Map이
module-level 변수였다. Next.js 개발 모드 (Turbopack)에서는 같은
모듈이 라우트 번들마다 별개 instance로 evaluate되어 **`/api/ai/generate`
가 쓴 Map과 `/api/ai/status/[jobId]`가 읽는 Map이 분리**된다.
generate route에서 `createJob` 호출은 자기 module의 Map에 저장,
status route는 자기 module의 Map (비어 있음)을 보고 404.

HMR이 자주 발생하는 환경에서도 같은 증상이 나타난다 — module
reload 시 module-level Map이 초기화.

`captureThumbnail` 같은 client-side 모듈은 React state로 격리되어
이 문제와 무관. server-side singleton state가 정확한 이슈 진입점.

## 변경

[lib/ai/server/jobs.ts](../../lib/ai/server/jobs.ts) — `jobs` Map을
`globalThis.__genyAvatarJobs__`에 매단다. Next.js 공식 문서 (Prisma
가이드 등)에서 서버 singleton에 권장하는 패턴.

```ts
type JobGlobal = typeof globalThis & {
  __genyAvatarJobs__?: Map<AIJobId, ServerJob>;
};
const jobsGlobal = globalThis as JobGlobal;
if (!jobsGlobal.__genyAvatarJobs__) {
  jobsGlobal.__genyAvatarJobs__ = new Map<AIJobId, ServerJob>();
}
const jobs = jobsGlobal.__genyAvatarJobs__;
```

`globalThis`는 module instance와 무관하게 process 전체에서 단일.
HMR도 globalThis는 reset 안 함. 따라서 generate / status / result
route가 같은 Map 인스턴스를 본다.

doc 코멘트에 사유 명시 — 다음 사람이 "왜 globalThis?" 질문 안 하도록.

## 검증

- `pnpm typecheck` ✓
- `pnpm exec biome check lib/ai/server/jobs.ts` ✓
- 실호출 재검증: 사용자가 dev 서버 재시작 (코드 변경 반영) 후
  fal.ai FLUX.2로 다시 generate → 우리 status route가 정상 200으로
  status 응답 → falai provider 폴링 완료 → 결과 표시.

## 결정

1. **Redis / 외부 store로 가지 않음**. solo hobby scale + 단일
   process. globalThis 패턴이면 prod single-instance에서도 동일하게
   동작. 멀티 인스턴스 prod로 가면 그때 Redis.
2. **TTL은 그대로 1h**. globalThis로 옮긴다고 leak 변하지 않음.
3. **다른 module-level state는 점검 안 했음**. provider registry 같은
   stateless module은 영향 없음. 향후 server-side state 추가 시 같은
   패턴 적용해야 함.

## 영향

- Phase 1 closure entry의 Criterion 3 (FLUX.2 실호출 검증) 차단
  해소. 이 hotfix 머지 + dev 재시작 후 정상 측정 가능.
- prod 빌드에선 module-level Map이 동작했을 가능성도 있지만 (Next.js
  prod route handler가 single module instance) globalThis 패턴은 더
  강한 보장. prod 영향 없음.

## 참조

- 손댄 파일 1개: `lib/ai/server/jobs.ts`.
- PR: 이 entry가 포함된 PR이 머지될 때 main에 들어감.
