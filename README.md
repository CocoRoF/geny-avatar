# geny-avatar

Web-based 2D Live Avatar editor with AI-driven texture generation. **1인 hobby 프로젝트.**

> 인터넷에서 받은 puppet (Cubism 또는 Spine)을 드래그-드롭으로 올리고, 레이어를 정리하고, 생성형 AI로 텍스처를 새로 그려서 라이브 미리보기로 즉시 확인한다.

## 두 가지 철학 (lock-in)

- **P1 — Cubism + Spine 모두 1차** — 어느 한쪽이 "후순위"가 아니다. 두 어댑터를 처음부터 같이 구현.
- **P2 — Upload Day-1** — 인터넷에서 받은 파일을 바로 올려서 쓰는 흐름이 V1 시연 1번 시나리오. Spine 3.8/4.0/4.1/4.2 + Cubism 4/5 (best-effort 2/3) 모두 받는다.

## 시작 (개발)

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

## 스택

- Next.js 15 (App Router) + React 19 + TypeScript
- Pixi.js v8 (예정 — Phase 0 PoC에서 도입)
- Spine 런타임: `@esotericsoftware/spine-pixi-v8` (예정)
- Live2D 런타임: `untitled-pixi-live2d-engine` + Cubism Core (예정)
- Tailwind CSS v4
- Biome (lint/format)
- pnpm 10

## 디렉터리

```
geny-avatar/
├─ app/                        Next.js App Router
├─ public/                     정적 자산 (samples, runtime 정적 파일)
├─ docs/                       설계 문서 (analysis / plan / progress)
└─ ...
```

## 문서

- [docs/README](docs/README.md) — 진입점
- [docs/analysis](docs/analysis/INDEX.md) — 사실 정리 (포맷, 런타임, AI, 라이선스 등)
- [docs/plan](docs/plan/INDEX.md) — 결정과 근거 (north star, architecture, tech stack, roadmap …)
- [docs/progress](docs/progress/INDEX.md) — 시간순 작업 기록

## 현재 상태

**Phase 0** — Spike & Adapter Interface Lock. 다음:
- spine-pixi-v8 PoC
- untitled-pixi-live2d-engine PoC
- 두 런타임 동시 마운트 검증 (T-rt1)
- 어댑터 인터페이스 1차 안 확정

## 라이선스

비공개 hobby 프로젝트 — 별도 라이선스 미부여.
