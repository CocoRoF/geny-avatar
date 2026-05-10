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

## 주요 기능

- **Dual runtime upload** — Spine 3.8/4.x `.skel` + atlas, Cubism 4/5 `.model3.json` + moc3 zip 드롭 → IndexedDB 저장 → 라이브 미리보기
- **Layer / Variant 패널** — 슬롯·파트별 visibility 토글, 변형(skin) 저장/전환
- **Decompose Studio** — alpha component 자동 검출 + brush 마스킹 + SAM 자동 세그먼트 (split mode 에서 region 직접 정의)
- **AI texture generation** — gpt-image-2 multi-image edits API (focus mode region별 프롬프트, Reference 이미지 첨부, per-region revert / history)
- **Export / Import** — `*.geny-avatar.zip` 라운드트립 (avatar.json + bundle + overrides + LICENSE.md)
- **Help / Onboarding** — `?` 키 단축 modal + 첫 진입 배너

## 스택

- Next.js 15 (App Router) + React 19 + TypeScript
- Pixi.js v8 (렌더 엔진)
- Spine 런타임: `@esotericsoftware/spine-pixi-v8`
- Live2D 런타임: `untitled-pixi-live2d-engine` + Cubism Core
- AI: OpenAI gpt-image-2 (`/v1/images/edits`), SAM (Replicate) for segmentation
- 영구화: Dexie (IndexedDB v9)
- Tailwind CSS v4 / Biome / pnpm 10

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

**Phase 7 — Polish & V1 Release** 진행 중. Phase 0~6 완료 (dual runtime / upload / decompose / AI generation / variant export / SAM 통합 / per-region revert·history). 7.1 Help modal + 7.2 onboarding + 7.3 한국어화 + 7.4 attribution 완료. 다음:

- 7.5 README + landing copy 정비 (이 PR)
- 7.6 첫 페인트 1.5s 목표 성능 최적화

자세한 시간순 기록은 [`docs/progress/INDEX.md`](docs/progress/INDEX.md).

## 라이선스

자체 코드: 비공개 1인 hobby 프로젝트 — 별도 라이선스 미부여 (private).

### 제3자 자산 / Third-party

이 도구는 다음 외부 SDK / 모델을 사용한다. 상업적 배포 시에는 각 권리자의 라이선스를 별도로 확보해야 한다.

| 자산 | 권리자 | 라이선스 |
|---|---|---|
| [Spine Runtime v4](https://esotericsoftware.com/spine-runtimes-license) | Esoteric Software | Spine Runtimes License (Spine SDK 라이선스 별도 보유 필요) |
| [Live2D Cubism Core](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html) | Live2D Inc. | Live2D Proprietary Software License (EULA) — `vendor/` 격리 |
| [Pixi.js v8](https://github.com/pixijs/pixijs/blob/main/LICENSE) | PixiJS contributors | MIT |
| [OpenAI gpt-image-2](https://openai.com/policies/terms-of-use) | OpenAI | OpenAI API Terms of Use — 사용자 본인 API key 필요 |

내장 샘플 puppet (Hiyori, spineboy)은 각 SDK 공식 샘플로 학습/개발용으로 동봉. 상업적 사용 시에는 원 배포처의 라이선스 조건을 따른다.

내보낸 `*.geny-avatar.zip` 의 `LICENSE.md` 에는 export 시점의 origin / AI provenance 가 자동 기록된다 — 외부 공유 시 함께 보존하자.
