# 07 — Phased Roadmap

V1까지의 단계. 각 Phase는 끝났을 때 "지금 시연 가능한 것"이 명확해야 한다.

## Phase 0 — Spike & Adapter Interface Lock (현재)

**목표**: 코드를 본격적으로 쓰기 전에 두 런타임 PoC로 어댑터 인터페이스의 모양을 확정.

**산출물**:
- [x] `docs/` 전체 스캐폴드와 1차 채움
- [x] 운영 컨텍스트 (solo hobby) 확정 → 라이선스 차단 없음
- [x] P1 dual-primary / P2 업로드 day-1 철학 확정
- [ ] spine-pixi-v8 PoC — 빈 Next.js 페이지에 spineboy 띄우기 + slot 토글
- [ ] untitled-pixi-live2d-engine PoC — 같은 스파이크 Hiyori
- [ ] **두 런타임을 같은 Pixi Application에 동시 마운트 검증** (T-rt1)
- [ ] T1·T3·T9 (런타임 검증) 해소
- [ ] 어댑터 인터페이스 1차 안 ([plan/02 D4](02_architecture.md))이 두 런타임을 다 받아내는지 검증

**완료 조건**: 두 PoC로 slot/drawable 토글이 동등하게 작동, 두 런타임이 같은 Pixi 캔버스에 충돌 없이 동시 마운트, 어댑터 인터페이스 확정.

**예상 기간**: 1주.

## Phase 1 — Dual Runtime + Upload (Render 백본)

**목표**: 내장 자산이든 사용자가 인터넷에서 받은 자산이든 — Spine이든 Cubism이든 — 같은 UI에서 살아있는 미리보기와 레이어 토글이 작동.

**스코프**:
- Next.js 15 + Pixi v8 부트
- `AvatarAdapter` 인터페이스 + **두 어댑터 동시 구현**: SpineAdapter (3.8/4.0/4.1/4.2) + Live2DAdapter (Cubism 4/5; 2/3 best-effort)
- `AvatarRegistry` + `FormatDetector` — 업로드 자산 포맷·버전 자동 감지, low-confidence 시 사용자 모달
- Asset Library:
  - **드래그-드롭 업로드 day-1** (ZIP + 폴더, File System Access API)
  - 내장 샘플 3종 (Live2D 공식 1, Spine 공식 1, 자체 제작 1)
  - 업로드 자산은 IndexedDB(Dexie)에 영구 저장, 재방문 시 복원
- Live Preview: 캐릭터 표시 + 애니메이션 자동 재생 + zoom/pan
- Layers Panel: 레이어 list, 검색, visibility 토글, RGBA tint
- Tools Panel: 애니메이션 라디오, Reset, Hide UI
- Zustand store + Immer
- Undo/Redo (visibility/color만)

**아웃 of 스코프**:
- AI 생성
- Atlas 분해 (region 추출까지는 가능, 마스킹 도구는 다음)
- Export/Import 라운드트립

**완료 조건**:
- V1 시나리오 A·B·C 의 "올리고 보고 토글까지" 단계 모두 시연 가능
- 인터넷 무작위 자산 5종(2 Spine + 3 Live2D, 다양한 버전) 80% 이상 정상 로드

**예상 기간**: 4주. (Phase 0 단축분으로 만회.)

## Phase 2 — Atlas & Decompose Studio v1

**목표**: 레이어의 텍스처 region을 atlas에서 추출하고, 사용자가 마스크를 다듬을 수 있는 도구.

**스코프**:
- Atlas 슬라이싱 (Spine `.atlas`, Cubism atlas page UV)
- Region 미리보기 (LayersPanel 행의 thumbnail)
- DecomposeStudio v1: 알파 임계 + 브러시 마스크 + 라쏘 (SAM 없이)
- mesh silhouette 추출 (mesh attachment / drawable 정점에서) — AI ControlNet 입력 준비
- 자산 출처 메모: 업로드 시 짧은 라벨(선택)

**완료 조건**: 한 레이어를 클릭하면 region PNG가 추출되고, 마스크를 그릴 수 있다.

**예상 기간**: 2주.

## Phase 3 — AI Texture Generation (MVP)

**목표**: AI 텍스처 재생성 핵심 워크플로 동작.

**스코프**:
- /api/ai/generate, /api/ai/status/:jobId 라우트
- Replicate 통합 (옵션 1 — 기존 모델 endpoint)
- GeneratePanel UI: 프롬프트 입력 → 진행 표시 → 결과 적용
- 표준 워크플로 `inpaint-controlnet-v1`: SDXL inpaint + canny ControlNet
- 결과 캐시 (IndexedDB)
- 에러 처리: 타임아웃, 재시도, 후처리 alpha 강제

**아웃 of 스코프**:
- IP-Adapter / 사용자 LoRA (다음 Phase)
- 자체 ComfyUI (다음)
- Decompose의 SAM 자동 마스크 (다음)

**완료 조건**: V1 시나리오 A의 3~4단계 시연 가능. "이 옷을 다른 옷으로"가 30초 안에 미리보기 갱신.

**예상 기간**: 3주.

## Phase 4 — Variant System & Export

**목표**: 의상 변형 시스템 + Export/Import 라운드트립.

**스코프**:
- Variant 모델 + UI: "이 layer 변형을 새 Variant로 저장"
- Spine Skin → Variant import
- Live2D part group 가시성 → Variant import
- Export: `*.geny-avatar.zip` 생성 (메타 + textures + 변경된 atlas + LICENSE.md 자동 첨부)
- Import: 같은 ZIP을 받아 동일 상태 복원

**완료 조건**: V1 시나리오 C 시연 가능 + 사용자가 작업을 export 후 다시 import해서 동일 상태 재현.

**예상 기간**: 2주.

## Phase 5 — AI Quality Push

**목표**: 캐릭터 일관성 + 품질 향상.

**스코프**:
- IP-Adapter 통합 (캐릭터 ref 이미지)
- 사용자 LoRA 업로드 + 적용
- 자체 ComfyUI 워크플로 deploy (Replicate에 Cog 또는 자가호스팅)
- 결과 품질 회귀 테스트 셋: 10개 샘플 puppet × 5 프롬프트로 매트릭스 평가

**완료 조건**: 같은 캐릭터로 여러 layer를 재생성해도 톤이 어긋나지 않는다.

**예상 기간**: 3주.

## Phase 6 — Decompose Studio Pro

**목표**: SAM 기반 자동 마스크 + 마스킹 UX 개선.

**스코프**:
- SAM 서버 inference 통합
- 후보 마스크 N개 제시 → 클릭 선택
- 마스크 합성 (여러 마스크의 union/intersection)
- "auto-decompose all layers" 일괄 처리
- DecomposeStudio 풀스크린 모드

**예상 기간**: 2주.

## Phase 7 — Polish & V1 Release

**목표**: 첫 외부 시연 가능한 상태.

**스코프**:
- 성능 최적화 (첫 페인트 1.5s 목표)
- 에러 메시지 한국어화
- 단축키 도움말
- 온보딩 hint 카드
- 라이선스 표시 명확화
- README + landing copy

**완료 조건**: V1 시나리오 A·B·C 모두 영상 시연 가능. 외부 사용자 5명 베타 → 피드백 반영.

**예상 기간**: 2주.

## V1 마일스톤 — 합산

총 ~17주 (Phase 0~7). 1인 hobby 작업 가정. Phase 1이 두 런타임 + 업로드로 4주로 늘었지만 Phase 2는 분해 핵심으로 좁혀져 2주. 매주의 시간 투자가 들쑥날쑥할 수 있으니 달력상 더 길어질 수 있음.

## V2 이후 (참고)

- 페이스 트래킹 / VTubing 라이브 모드
- 공유 갤러리 + 사용자 계정
- 모바일 반응형
- 캐릭터 LoRA 학습 UI
- 본 추가/메시 편집 (간단한 변경부터)

## 진행 추적

각 Phase 시작·종료 시점에 [progress/](../progress/INDEX.md) 디렉터리에 기록. PR이 머지될 때마다 progress 항목 추가.

## 변경 이력

이 로드맵은 산 동물이다. Phase 끝날 때마다 아래 표 갱신.

| 날짜 | 변경 | 이유 |
|---|---|---|
| 2026-05-06 | 초안 작성 | 프로젝트 부트스트랩 |
| 2026-05-06 | Phase 1을 dual-runtime + 업로드 day-1로 확장, Phase 2 축소 | 사용자 P1·P2 철학 ([README](../README.md)) — 두 포맷 1차, 업로드 V1 핵심 흐름 |
| 2026-05-06 | Phase 1을 1.1 / 1.2 / 1.3 / 1.4 sub-phase로 쪼갬 | 1.1 어댑터 인터페이스 / 1.2 registry+훅+PoC 리팩터 / 1.3 업로드+영구저장 / 1.4 store+본 컴포넌트 — PR 단위가 너무 커지지 않도록 |
