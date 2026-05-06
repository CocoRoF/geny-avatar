# Analysis — Index

`analysis/`에는 **결정 이전의 사실**만 들어간다. "이 라이브러리가 존재한다", "이 포맷의 구조는 이렇다", "이 라이선스는 이렇다" 같은 검증 가능한 정보. 의견과 선택은 [plan/](../plan/INDEX.md)으로 간다.

## 문서

| # | 파일 | 무엇을 정리하나 |
|---|------|-----------------|
| 01 | [problem_statement](01_problem_statement.md) | 우리가 풀려는 문제와 성공 기준 |
| 02 | [format_landscape](02_format_landscape.md) | Live2D / Spine / Inochi2D / PSD 기반 — 각각의 정체와 용도 |
| 03 | [rendering_runtimes](03_rendering_runtimes.md) | 웹에서 위 포맷들을 그리는 런타임들 (pixi-spine-v8, pixi-live2d-display, …) |
| 04 | [layer_skeleton_model](04_layer_skeleton_model.md) | 각 포맷의 "레이어"와 "뼈대" 추상화 비교 — 우리 데이터 모델의 출발점 |
| 05 | [texture_atlas_decomposition](05_texture_atlas_decomposition.md) | 통짜 atlas를 레이어 단위로 분해하는 문제와 가능한 접근 |
| 06 | [generative_ai_texture](06_generative_ai_texture.md) | SDXL · ControlNet · IP-Adapter · LoRA — 텍스처 생성에 필요한 도구들 |
| 07 | [sample_sources](07_sample_sources.md) | 무료 뼈대를 어디서 받는가, 라이선스 제약은 무엇인가 |
| 08 | [competitive_reference](08_competitive_reference.md) | NIKKE visualiser 분해 — 무엇을 빌려오고 무엇을 안 빌려오는가 |
| 09 | [open_questions](09_open_questions.md) | 검증 안 끝난 질문 모음 (`[VERIFY]`, `[OPEN]`) |
| 10 | [test_assets](10_test_assets.md) | V1 자산 다양성 회귀 — 5종 80% 검증용 시드 가이드 |

## 작성 규칙

- 출처는 인라인으로 URL을 박는다. 분리된 reference 섹션을 만들지 않는다 — 컨텍스트에서 멀어지면 안 읽는다.
- 사실이 변하면 문서를 갱신하지 추가하지 않는다. 한 주제는 한 곳에서만 정답을 갖는다.
- 직접 검증 못 한 항목은 `[VERIFY]` 마커. 검증 끝나면 마커를 지우고 갱신.
