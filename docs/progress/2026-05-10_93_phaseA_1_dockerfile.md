# 2026-05-10 — Phase A.1: Dockerfile (Geny 통합 준비)

[Geny 의 GENY_AVATAR_INTEGRATION plan](https://github.com/CocoRoF/Geny/blob/main/docs/plan/GENY_AVATAR_INTEGRATION.md) 의 Phase A 첫 sprint. geny-avatar 가 standalone production image 로 빌드되도록 준비. Geny 의 docker compose 가 본 레포를 submodule 로 참조해서 build 할 수 있게 만든다.

## 변경 surface

### `next.config.ts`

`output: "standalone"` 추가. Next.js 가 `.next/standalone/server.js` + 최소 node_modules 를 emit 해서 runtime 에 full node_modules 트리 없이 `node server.js` 한 줄로 동작.

```diff
 const nextConfig: NextConfig = {
   reactStrictMode: true,
+  output: "standalone",
 };
```

### `Dockerfile` (신규)

3-stage multi-stage build:

1. **deps** (`node:20-alpine`) — `corepack enable` + `pnpm install --frozen-lockfile`. `package.json` + `pnpm-lock.yaml` 변경 없으면 cache hit.
2. **builder** — deps 의 node_modules 가져와서 `pnpm build` (predev/sync-vendor.mjs → next build). standalone + static 생성.
3. **runner** (`node:20-alpine`) — builder 의 `.next/standalone/` + `.next/static/` + `public/` 만 복사. non-root user (nextjs:1001). EXPOSE 3000, `CMD ["node", "server.js"]`.

### `.dockerignore` (신규)

`.gitignore` mirror + 추가로 `.git`, `docs`, `.next`, `node_modules`, `public/samples`, `public/runtime` 제외 (sync-vendor 가 이미지 안에서 다시 실행).

## vendor/ 처리

`scripts/sync-vendor.mjs` 는 vendor/ 가 비어있을 때 missing 경고만 내고 빌드는 성공. 즉 두 시나리오 모두 OK:

- **Geny 의 권장 방식**: `git submodule update --init --recursive` 로 geny-avatar + 그 안의 vendor/ 까지 미리 채워둔 상태에서 build → Cubism Hiyori 샘플도 image 안에 포함.
- **Fallback**: vendor/ 없이 build → image 빌드 성공, Cubism 샘플 라우트만 자산 없어서 깨짐 (사용자가 puppet 직접 upload 하면 정상).

## 의도적 한계

- **dev mode 이미지 안 만듦**: 이번 sprint 는 production standalone 만. Geny 의 dev compose 에서 hot-reload 가 필요하면 별도 `target: dev` multi-stage 또는 `Dockerfile.dev` 추가 (Phase B.3 또는 B.5 에서 결정).
- **docker build 실제 검증 불가**: 작업 환경의 docker daemon socket 접근이 막혀있어 `docker build` 실행 못 함. Dockerfile 은 Next.js 공식 standalone 예제 패턴을 따라가고, `pnpm build` 는 standalone 출력을 정상 생성함을 확인. 사용자가 로컬에서 `docker build -t geny-avatar:test .` 한 번 실행 권장.
- **healthcheck 안 넣음**: standalone server.js 가 별도 health endpoint 노출하지 않음. Geny compose 측에서 `curl -fsS http://localhost:3000/` 같은 simple HTTP 확인으로 healthcheck 정의 (B.2 에서).
- **multi-arch 안 함**: `--platform` 안 명시. host 아키텍처 그대로 build. 필요 시 buildx 로 후속.

## 검증

- `pnpm build` 통과 (`.next/standalone/server.js` 생성 확인)
- typecheck 통과 (next.config 의 NextConfig 타입 만족)
- docker build 미검증 (환경 제약 — 사용자 검증 필요)

## 시각 검증 가이드

```bash
# 로컬에서:
git pull
pnpm install
pnpm build                                        # standalone 출력 확인
ls .next/standalone/server.js                     # 존재해야 함

# Docker:
docker build -t geny-avatar:a1-test .             # 5~7 분 소요 예상
docker run --rm -p 3001:3000 geny-avatar:a1-test  # 별도 포트로 실행
# → http://localhost:3001/ 접속 → home 화면 정상 → /edit/builtin/spineboy 동작
```

## 다음 — Phase A.2

`next.config.ts` 의 `basePath` / `assetPrefix` 를 `GENY_AVATAR_BASE_PATH` env 기반으로 동적화. Geny 가 nginx 로 `/avatar-editor/` prefix 에 mount 할 수 있도록.
