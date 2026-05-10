# Plan — Index

`plan/`에는 **결정과 그 근거**가 들어간다. analysis가 정리한 사실 위에 우리가 어떻게 만들 것인가를 적는다.

## 문서

| # | 파일 | 무엇을 결정 |
|---|------|-------------|
| 01 | [north_star](01_north_star.md) | 우리가 도달하면 끝인 그림 — V1 정의 |
| 02 | [architecture](02_architecture.md) | 시스템 구성 — 클라이언트 / 백엔드 / AI / 자산 저장 |
| 03 | [tech_stack](03_tech_stack.md) | 라이브러리·프레임워크 선택과 근거 |
| 04 | [data_model](04_data_model.md) | Avatar / Layer / Texture / Variant 등 우리 표현 |
| 05 | [ai_pipeline](05_ai_pipeline.md) | "텍스처 다시 그려줘"가 백엔드에서 어떻게 흘러가는가 |
| 06 | [ui_ux](06_ui_ux.md) | 화면 구성 / 상호작용 / 상태 흐름 |
| 07 | [phased_roadmap](07_phased_roadmap.md) | Phase 0 ~ V1까지의 단계별 계획 |
| 08 | [risks_and_mitigations](08_risks_and_mitigations.md) | 무엇이 실패할 수 있고 어떻게 막을 것인가 |
| 09 | [editor_animation_tab](09_editor_animation_tab.md) | Phase 8 — 에디터 애니메이션 탭 (motion/expression/emotion 매핑 + Geny export schema v2) |

## 작성 규칙

- 모든 결정에는 **Why** 한 문장. 이유 없는 결정은 다음 사람이 "왜 이렇게 했지" 하고 뒤집는다.
- 결정이 바뀌면 **추가하지 말고 수정**한다. 단, 옛 결정의 흔적이 학습할 가치가 있으면 같은 문서 끝에 "Past attempts" 섹션.
- analysis의 사실에 의존하는 결정은 그 analysis 문서를 직접 링크.
