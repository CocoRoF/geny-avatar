# 2026-05-10 — Phase A.2: basePath / assetPrefix env-driven

[Geny 의 GENY_AVATAR_INTEGRATION plan](https://github.com/CocoRoF/Geny/blob/main/docs/plan/GENY_AVATAR_INTEGRATION.md) 의 Phase A 두 번째. geny-avatar 가 reverse-proxy 하의 prefix 경로 (`/avatar-editor/`) 에서 동작 가능하도록.

## 변경 surface

### `next.config.ts`

`NEXT_PUBLIC_BASE_PATH` env 기반으로 `basePath` + `assetPrefix` 동적화. 빈 문자열일 때 (= unset) 두 옵션 모두 `undefined` 로 떨어져 root mount 동작 유지 (기존 standalone 사용 그대로).

```ts
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
basePath: basePath || undefined,
assetPrefix: basePath || undefined,
```

`NEXT_PUBLIC_*` 라 build time 에 inline 됨 → 같은 환경 변수를 server (next.config) 와 client code 둘 다 읽을 수 있다.

### `lib/basePath.ts` (신규)

`apiUrl(path)` 헬퍼. `<Link>` / `useRouter().push()` 는 Next.js 가 basePath 자동 prepend 하지만, raw `fetch("/api/...")` 는 그렇지 않음 → reverse-proxy 환경에서 그대로 두면 404. 모든 client-side fetch 가 이 헬퍼 통과해야 안전.

```ts
export const BASE_PATH: string = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
export function apiUrl(path: string): string {
  return `${BASE_PATH}${path}`;
}
```

### fetch 호출 6개 갱신

전수조사로 확인된 6개 hardcoded `/api/...` fetch 모두 `apiUrl()` 으로 wrap:

- `lib/ai/client.ts` — `/api/ai/providers`, `/api/ai/refine-prompt`, `/api/ai/generate`, `/api/ai/status/<jobId>`, `/api/ai/result/<jobId>`
- `lib/ai/sam/client.ts` — `/api/ai/sam`

### 5개 navigational `<a href>` → `<Link>`

plain `<a>` 는 basePath 자동 prepend 안 됨. `next/link` 의 `<Link>` 로 교체 (client-side navigation 보너스):

- `app/edit/[avatarId]/page.tsx` — 헤더 `← library`
- `app/edit/builtin/[key]/page.tsx` — unknown sample fallback `home`, 헤더 `← home`
- `app/page.tsx` — `BUILTIN_SAMPLES` 카드 (`/edit/builtin/<key>`), `LibraryCard` (`/edit/<id>`)

`router.push()` 호출 (dropzone redirect) 은 변경 불필요 — Next.js router 는 자체적으로 basePath prepend.

`AttributionFooter` / library card `i` 의 외부 라이선스 링크는 absolute URL 이라 영향 없음.

## 검증

- typecheck 통과
- biome 통과
- `pnpm build` (default, basePath unset) 통과
- `NEXT_PUBLIC_BASE_PATH=/avatar-editor pnpm build` 통과
- 빌드 후 `.next/standalone/server.js` 안에 `"basePath":"/avatar-editor"` + `"assetPrefix":"/avatar-editor"` + image 경로 `/avatar-editor/_next/image` 모두 정상 배이크 확인
- 기본 사용 시 (env unset) 모든 라우트가 root 그대로 — 기존 hobby 단독 사용 동작 무손상

## 시각 검증 가이드

```bash
git pull && pnpm install

# 1) 기본 (단독 사용 — 변화 없어야 함)
pnpm dev
# → http://localhost:3000/ 정상

# 2) prefix 모드 (Geny 통합 시뮬레이션)
NEXT_PUBLIC_BASE_PATH=/avatar-editor pnpm build
NEXT_PUBLIC_BASE_PATH=/avatar-editor PORT=3000 node .next/standalone/server.js
# → http://localhost:3000/                  → 404 (expected — 이제 root 안 듣음)
# → http://localhost:3000/avatar-editor/    → home 정상
# → http://localhost:3000/avatar-editor/edit/builtin/spineboy → editor 정상
# → AI generate 호출 시 /avatar-editor/api/ai/generate 으로 POST (DevTools 로 확인)
# → 모든 _next 자산이 /avatar-editor/_next/... 경로
```

## 의도적 한계

- **NEXT_PUBLIC_ prefix 강제**: build time inline 이 핵심. server-only 변수 (`GENY_AVATAR_BASE_PATH` 같은) 로 분리할 수도 있지만 이중 관리 복잡도 vs single env 단순성 trade — 후자 선택.
- **기존 코드의 `apiUrl()` 미사용 fetch 가 추후 추가될 위험**: lint 규칙 안 깜. PR 리뷰 시 grep 으로 확인 가이드를 README 에 추가할지는 후속 결정.
- **Next.js dev server 의 basePath HMR 호환성**: production build 에서만 검증. dev 모드는 Geny 의 prod compose 가 standalone 만 쓸 거라 우선순위 낮음.
- **i18n 라우팅 / catchall 등 고급 라우팅 X**: 단순 prefix 만. 복잡 라우팅 필요 시 별도 sprint.

## 다음 — Phase A.3

`ExportButton` 에 "Send to Geny" 모드 추가. `NEXT_PUBLIC_GENY_HOST==="true"` 일 때 활성. `app/api/send-to-geny/route.ts` 신규 — multipart 받아서 `process.env.GENY_BAKED_EXPORTS_DIR` 에 timestamped 파일명으로 fs.write.
