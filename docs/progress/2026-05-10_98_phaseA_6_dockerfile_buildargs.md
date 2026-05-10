# 2026-05-10 — Phase A.6 (hotfix): Dockerfile build args for basePath

A.1 의 Dockerfile 이 `NEXT_PUBLIC_BASE_PATH` 같은 build-time 환경 변수를 받아주지 못하던 문제를 hotfix. Geny prod compose 가 `/avatar-editor` prefix 로 mount 하려면 next build 시점에 이 env 가 inline 돼야 함 — runtime ENV 로는 너무 늦다 (Next.js 가 이미 build 끝낸 standalone 번들 안에 basePath 가 빈 문자열로 박힌 상태).

## 변경 surface

### `Dockerfile` — builder stage

```diff
 FROM node:20-alpine AS builder
 WORKDIR /app
 RUN corepack enable
 COPY --from=deps /app/node_modules ./node_modules
 COPY . .
+ARG NEXT_PUBLIC_BASE_PATH=""
+ARG NEXT_PUBLIC_GENY_HOST=""
+ENV NEXT_PUBLIC_BASE_PATH=${NEXT_PUBLIC_BASE_PATH}
+ENV NEXT_PUBLIC_GENY_HOST=${NEXT_PUBLIC_GENY_HOST}
 ENV NEXT_TELEMETRY_DISABLED=1
 RUN pnpm build
```

ARG → ENV 패턴. 디폴트 빈 문자열이라 ARG 안 넘기면 단독 사용 동작 그대로 (root mount, integrate-mode off). compose 가 `build.args` 로 넘기면 그 값으로 빌드.

### `package.json` — `0.2.0` → `0.2.1`
### `app/page.tsx` — landing chip `v0.2.0` → `v0.2.1`

## 검증

- `pnpm build` 통과 (디폴트 빈 ARG)
- 이후 Geny 측에서 `--build-arg NEXT_PUBLIC_BASE_PATH=/avatar-editor` 시 standalone 번들에 prefix inline 검증 (Geny B.4 에서 docker compose config 확인)

## 다음

geny-avatar 에 git tag `v0.2.1` 부여 + push. Geny 의 `vendor/geny-avatar` submodule pin 을 v0.2.0 → v0.2.1 로 갱신 (Geny B.4 의 일부).
