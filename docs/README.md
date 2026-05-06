# geny-avatar — Documentation Root

이 디렉터리는 `geny-avatar` 프로젝트의 **사전 조사 / 설계 / 진행 기록**을 담는다. 코드보다 먼저 작성하며, 모든 의사결정은 여기에서 합의된 다음 구현으로 내려간다.

## 프로젝트 한 줄 정의

> **2D Live Avatar 편집기 — 무료 뼈대 샘플을 가져와 레이어를 정리하고, 생성형 AI로 텍스처를 만들어 입혀, 라이브 미리보기 옆에서 바로 다듬는 웹 애플리케이션 (Next.js).**

UI 톤은 [nikke-db.pages.dev/visualiser](https://nikke-db.pages.dev/visualiser)의 좌측 캐릭터 리스트 / 중앙 프리뷰 / 우측 도구·레이어 패널 구성을 레퍼런스로 한다. 단, NIKKE의 visualiser는 **Spine 2D 4.0/4.1**을 그대로 보여주는 뷰어인 반면, 우리는 **편집기 + 생성기**가 목표다.

## Operating Context — Solo Hobby

이 프로젝트는 **혼자 재미로 만드는 1인 개발 작업**이다. 사업자도 아니고 상업 배포 계획도 없다. 이게 모든 라이선스 관련 의사결정에 영향을 준다:

- Live2D Sample EULA의 "General Users" — 우리는 여기에 들어간다. 상업 이용도 허용.
- Spine 런타임 평가/개인 사용 — 통과.
- shiralive2d 등 서드파티 무료 모델의 "비상업 OK" 조항 — 우리는 비상업.
- NIKKE 등 게임 추출 자산의 저작권 — 외부 배포는 안 하고 개인 실험에서만 다루면 자기 책임 영역.

→ 결론: **라이선스가 프로젝트를 차단하지 않는다.** 자산 출처를 메타로 기록하긴 하지만 LicenseGuard 모달 같은 강제 흐름은 만들지 않는다. 만약 미래에 공유 갤러리·상업화 등으로 스코프가 커지면 그때 다시 본다.

## Two Locked-in Philosophies

이 두 항목은 모든 후속 의사결정에 우선한다.

### P1 — Cubism과 Spine 모두 1차 시민

"Spine을 먼저 만들고 나중에 Live2D 추가" 같은 단계적 도입을 하지 않는다. **두 어댑터를 처음부터 같이 구현한다.** Phase 0 PoC 단계에서 양쪽 모두를 띄워보고, Phase 1 종료 시점에 두 포맷의 puppet이 같은 UI에서 동일하게 작동해야 한다.

**Why**: 인터넷에 풀려 있는 무료/유료 puppet은 두 포맷이 거의 반반이다. 한쪽만 지원하면 사용자(=우리)가 발견한 자산의 절반을 못 쓴다. 또 어댑터 인터페이스 모양은 두 포맷을 동시에 받아내야만 진짜로 검증된다 — 한 포맷만 보고 만든 추상화는 반드시 두 번째 포맷에서 깨진다.

### P2 — 인터넷에서 받은 파일을 바로 올려서 쓰는 것이 V1 핵심 흐름

사용자 자산 업로드가 Phase 1 day-1 기능이다. "내장 샘플로 먼저 만들고 업로드는 Phase 2"가 아니다. **드래그-드롭 → 포맷 자동 감지 → 즉시 미리보기**가 V1 시연의 1번 시나리오.

**Why**: 우리 도구의 가치는 "이미 가진 puppet에 새 텍스처를 입히는 것"이다. 자기 puppet을 못 올리면 도구의 핵심이 사라진다. 또 hobby 컨텍스트라 사용자 = 우리 자신 = 인터넷에서 puppet을 받아 노는 사람이라 업로드는 가장 자주 쓸 진입점.

**스코프**: Spine 3.8/4.0/4.1/4.2 + Cubism 2/3/4/5 모두 받는다. 패킹은 ZIP 또는 개별 파일 폴더 둘 다. 포맷이 깨졌거나 버전이 호환 안 되면 명확한 오류 메시지 + 어떻게 고치는지 안내.

## 디렉터리 구조

```
docs/
├─ README.md                      # 이 파일. 진입점.
├─ analysis/                      # 사실 수집. 의견·결정은 여기서 하지 않는다.
│  ├─ INDEX.md
│  ├─ 01_problem_statement.md
│  ├─ 02_format_landscape.md
│  ├─ 03_rendering_runtimes.md
│  ├─ 04_layer_skeleton_model.md
│  ├─ 05_texture_atlas_decomposition.md
│  ├─ 06_generative_ai_texture.md
│  ├─ 07_sample_sources.md
│  ├─ 08_competitive_reference.md
│  └─ 09_open_questions.md
├─ plan/                          # 설계와 결정. analysis를 근거로 한다.
│  ├─ INDEX.md
│  ├─ 01_north_star.md
│  ├─ 02_architecture.md
│  ├─ 03_tech_stack.md
│  ├─ 04_data_model.md
│  ├─ 05_ai_pipeline.md
│  ├─ 06_ui_ux.md
│  ├─ 07_phased_roadmap.md
│  └─ 08_risks_and_mitigations.md
└─ progress/                      # 시간순 작업 기록. 한 단위(스프린트/PR)당 1파일.
   ├─ INDEX.md
   └─ 2026-05-06_01_kickoff.md
```

## 읽는 순서

처음 들어왔다면:
1. [analysis/01_problem_statement](analysis/01_problem_statement.md) — 무엇을 풀려고 하는가
2. [plan/01_north_star](plan/01_north_star.md) — 무엇을 만들면 끝인가
3. [analysis/INDEX](analysis/INDEX.md) → 관심 주제로 점프
4. [plan/07_phased_roadmap](plan/07_phased_roadmap.md) — 어떻게 단계적으로 만들 것인가
5. [progress/INDEX](progress/INDEX.md) — 지금 어디까지 왔는가

## 컨벤션

- 사실(fact)과 의견(opinion)을 분리한다. analysis에는 출처 있는 사실만, plan에는 결정과 근거.
- 결정에는 **Why** 한 줄을 붙인다. 미래의 자기 자신이 읽을 때 추론을 따라갈 수 있도록.
- 불확실한 항목은 `[VERIFY]`, 미결 질문은 `[OPEN]` 마커를 붙이고 [analysis/09_open_questions](analysis/09_open_questions.md)에 모은다.
- 외부 라이브러리 / 라이선스 / 모델 출처는 항상 URL과 함께 기록한다. 1년 뒤에도 추적 가능해야 한다.
- 진행 기록(progress)은 사후가 아니라 작업 시작 시점에 만들고 PR 머지 시 마무리한다.

## 현재 상태 (2026-05-06)

- [x] 디렉터리 스캐폴드
- [x] 사전 조사 1차 라운드 (포맷, 런타임, 샘플, AI 파이프라인 표면)
- [x] 초기 plan 8문서
- [x] 운영 컨텍스트(solo hobby) 확정 → 라이선스 차단 없음
- [x] P1 Cubism+Spine 모두 1차 / P2 업로드 day-1 확정
- [ ] AI 백엔드 결정 (Replicate 시작 → 자체 ComfyUI 후행)
- [ ] Phase 0 — 두 런타임 PoC + 어댑터 인터페이스 lock
- [ ] Phase 1 — 양 런타임 + 업로드 + 레이어 토글 작동
