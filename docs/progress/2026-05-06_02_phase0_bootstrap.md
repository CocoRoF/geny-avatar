# 2026-05-06 — Phase 0 Bootstrap (Next.js + Git Init + Remote)

Phase 0의 기술 부트스트랩. 첫 코드 작성 + 새 GitHub 레포에 push까지.

## 환경 확인 (시작)

- [x] node v24.15.0
- [x] git 2.43.0
- [x] gh 2.89.0 — 인증된 계정: `CocoRoF`
- [x] git identity: `JangHaryeom <101104772+CocoRoF@users.noreply.github.com>` (메모리 reference)
- [x] pnpm 10.33.3 (corepack 활성화)

## 체크리스트 — 진행 중

- [x] Next.js 15 + TS + Tailwind v4 + Biome 수동 스캐폴드 (docs/ 보존)
- [ ] `pnpm install` 의존성 설치 (진행 중)
- [x] 최소 랜딩 페이지 — docs 상태와 연결되는 placeholder
- [ ] dev 서버 부팅 확인
- [ ] `git init` + `.gitignore` + 첫 커밋
- [x] GitHub 레포 가시성 확인 — **둘 다 private. 메인 `geny-avatar` + 폐쇄 바이너리 전용 `geny-avatar-vendor` (submodule). main 브랜치.**
- [ ] `geny-avatar-vendor` private 레포 생성 (placeholder README만)
- [ ] `geny-avatar` private 레포 생성 + push
- [ ] vendor 레포를 `vendor/` 경로 submodule로 등록 (실제 바이너리는 Phase 0 PoC 시점에 채움)
- [ ] 메모리 reference에 신규 레포 두 개 추가
- [ ] plan/03_tech_stack에 vendor submodule 패턴 명문화

## 결정 — 스캐폴드 방식

`create-next-app`이 비어있지 않은 디렉터리(`docs/` 존재)에서 fail하거나 prompt를 띄우므로 **수동 스캐폴드**. Next.js 15 minimal에 필요한 파일은 그렇게 많지 않다 — `package.json`, `tsconfig.json`, `next.config.ts`, `app/{layout,page}.tsx`, `app/globals.css`, `postcss.config.mjs`, `biome.json`, `.gitignore`.

**Why 수동**: 빌드 도구 자동 생성물 대신 우리가 의도한 최소 구성부터 시작. 군더더기 없음.

## 진행 노트

### 2026-05-06 10:24 — 수동 스캐폴드 작성

생성된 파일:
- `package.json` — Next.js 15, React 19, Tailwind v4, Biome 2, pnpm 10
- `tsconfig.json` — strict, `@/*` alias, docs/ exclude
- `next.config.ts` — reactStrictMode 외 비어 있음
- `postcss.config.mjs` — `@tailwindcss/postcss`
- `biome.json` — formatter (space 2, lineWidth 100, double quote, semicolons), linter recommended
- `.gitignore` — Next.js standard
- `app/globals.css` — Tailwind v4 `@import "tailwindcss"` + 다크 테마 토큰(`@theme`)
- `app/layout.tsx` — 한국어 lang, body min-h-screen
- `app/page.tsx` — 8 phase 로드맵 + 두 철학(P1·P2) 카드 표시
- `README.md` — 프로젝트 한 줄 소개 + 두 철학 + dev 명령 + 디렉터리 + 현재 상태
- 빈 디렉터리: `lib/{adapters,atlas,store}`, `components/`, `public/`

### 2026-05-06 10:25 — pnpm install 1차 시도

`pnpm install 2>&1 | tail -40` 백그라운드 실행 — output 파일이 0 byte이고 lockfile 미생성. 같은 시점에 다른 셸에서도 같은 명령이 실행되어 두 프로세스가 동시에 lockfile/store에 접근 시도, 서로 막힘 가능성.

### 2026-05-06 10:35 — 정리 + 클린 재실행

기존 두 pnpm 프로세스 kill, `node_modules`/`pnpm-lock.yaml` 삭제 후 재실행:
```
pnpm install --reporter=ndjson > /tmp/pnpm-install.log 2>&1
```
`ndjson` reporter로 진행이 실시간 로그 — `next@15.5.15` 다운로드 진행 확인.

### 2026-05-06 10:38 — install 진행 중 (next 다운로드)

(완료 시 갱신)

