# 2026-05-06 — Phase 0 Bootstrap (Next.js + Git Init + Remote)

Phase 0의 기술 부트스트랩. 첫 코드 작성 + 새 GitHub 레포에 push까지.

## 환경 확인 (시작)

- [x] node v24.15.0
- [x] git 2.43.0
- [x] gh 2.89.0 — 인증된 계정: `CocoRoF`
- [x] git identity: `JangHaryeom <101104772+CocoRoF@users.noreply.github.com>` (메모리 reference)
- [x] pnpm 10.33.3 (corepack 활성화)

## 체크리스트 — 완료

- [x] Next.js 15 + TS + Tailwind v4 + Biome 수동 스캐폴드 (docs/ 보존)
- [x] `pnpm install` 의존성 설치 (Next 15.5.15 + 9 packages, 약 19분 소요)
- [x] 최소 랜딩 페이지 — 8 phase 로드맵 + 두 철학(P1·P2) 카드
- [x] dev 서버 부팅 확인 — Turbopack, 980ms ready, HTTP 200, Tailwind 적용 확인
- [x] `git init` + `.gitignore` + 첫 커밋 (`485fb5b`)
- [x] GitHub 레포 가시성 확인 — 둘 다 private, main 브랜치
- [x] `geny-avatar-vendor` private 레포 생성 + placeholder push → https://github.com/CocoRoF/geny-avatar-vendor
- [x] `geny-avatar` private 레포 생성 + push → https://github.com/CocoRoF/geny-avatar
- [x] vendor 레포를 `vendor/` 경로 submodule로 등록 + push (`477a7a4`)
- [x] plan/03_tech_stack에 "레포 구성 — 메인 + Vendor Submodule" 섹션, plan/02에 D9 추가
- [x] 메모리 reference 갱신 (이 progress 종료 후)

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

연결이 느려 `next@15.5.15` (~50MB) + `@next/swc-linux-x64-gnu` (~30MB)에 19분 소요. ndjson reporter 로그가 진행 상황 추적에 유용.

### 2026-05-06 10:56 — install 완료 + dev 부팅 검증

`pnpm-lock.yaml` 생성, `node_modules/next/package.json` 확인 (15.5.15). `pnpm dev` (Turbopack) 실행 → 980ms ready. `curl http://localhost:3000/` → HTTP 200, HTML에 `<title>geny-avatar</title>`, Tailwind CSS chunk 로드, 한국어 lang 적용 확인. 서버 종료.

### 2026-05-06 10:58 — git init + 첫 커밋

`git init -b main` + identity 설정 (메모리 reference 따름) + `node_modules/`, `.next/`, `.env*` gitignore 확인 후 모든 신규 파일 stage → 커밋 `485fb5b "Initial commit — Phase 0 bootstrap"`. 28 files, 2400+ lines.

### 2026-05-06 11:00 — vendor 레포 생성 + push

`/tmp/geny-avatar-vendor/` 에 placeholder README + .gitignore → `git init -b main` → 커밋. `gh repo create geny-avatar-vendor --private --source=. --push`로 GitHub에 한 번에 생성·push.

### 2026-05-06 11:02 — 메인 레포 생성 + push

`gh repo create geny-avatar --private --source=. --push`로 GitHub 생성·push. 28 files initial commit이 그대로 올라감.

### 2026-05-06 11:03 — vendor submodule 등록 + push

`git submodule add https://github.com/CocoRoF/geny-avatar-vendor.git vendor` → `.gitmodules` 자동 생성, `vendor/` 클론됨 (placeholder README만). 커밋 `477a7a4 "Add vendor submodule"` → push.

## 산출물

| 레포 | URL | 가시성 | 첫 커밋 | 두 번째 커밋 |
|---|---|---|---|---|
| `geny-avatar` | https://github.com/CocoRoF/geny-avatar | private | `485fb5b` Initial bootstrap | `477a7a4` Add vendor submodule |
| `geny-avatar-vendor` | https://github.com/CocoRoF/geny-avatar-vendor | private | `9ec4e8a` placeholder | — |

## 다음 (Phase 0 본 작업)

이 부트스트랩은 Phase 0의 환경 준비. Phase 0의 본 작업은 PoC 두 개:

1. **spine-pixi-v8 PoC** — `pnpm add @esotericsoftware/spine-pixi-v8 pixi.js` 후 spineboy 띄우고 slot 토글 → 어댑터 인터페이스 1차 안 검증
2. **untitled-pixi-live2d-engine PoC** — Cubism Core를 `vendor/` 레포에 추가 → 메인에서 import → Hiyori 띄우고 drawable 토글
3. **T-rt1 검증** — 두 런타임을 같은 Pixi Application에 동시 마운트, GL state 충돌 확인
4. **T-rt2·T9 검증** — Spine 3.8 / Cubism 2 호환성 실측

이 네 가지가 끝나면 Phase 0 종료, Phase 1 (Dual Runtime + Upload) 진입.

## 학습

- pnpm install이 첫 백그라운드 시도에서 stuck됨 — `tail -40` 파이프 버퍼링이 출력 0 byte처럼 보이게 만들었지만 실제로는 같은 디렉터리에 두 인스턴스가 동시에 떠서 lockfile 경합 가능성. 클린 재실행 + ndjson reporter로 해결. 다음번 install은 한 인스턴스만 실행 + ndjson로 진행.
- `gh repo create --source=. --push`가 init 안 된 레포에는 작동 안 함. 먼저 `git init` + 첫 커밋 후 호출. 정상 작동.
- submodule 등록 후 `vendor/` 안에 README가 보이려면 vendor 레포가 먼저 push 되어 있어야 함 (위 순서대로 했으므로 OK).


