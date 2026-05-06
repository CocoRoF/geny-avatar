# Progress — Index

`progress/`에는 **시간순 작업 기록**이 들어간다. Phase 시작·종료 시점, PR 머지 후 한 줄 요약, 의사결정 변경 — 미래의 자기 자신이 "그때 왜 이렇게 됐지?"를 추적할 수 있도록.

## 파일 명명

- 형식: `YYYY-MM-DD_NN_<topic>.md`
  - `NN` 은 같은 날짜 내 순번. 첫 항목은 `01`.
  - `<topic>` 은 짧은 영문 슬러그 (`kickoff`, `phase0_license_audit`, `phase1_spine_render`, ...).
- Phase 경계는 별도 항목으로 — `2026-MM-DD_NN_phase1_start.md` / `_phase1_done.md`.
- PR 단위 기록은 `..._<topic>.md`로 — 토픽 안에 PR 번호와 요약.

## 트래킹 표

| 날짜 | 항목 | Phase | 상태 |
|---|---|---|---|
| 2026-05-06 | [01 kickoff](2026-05-06_01_kickoff.md) | 0 | 완료 (docs 1차) |
| 2026-05-06 | [02 phase0_bootstrap](2026-05-06_02_phase0_bootstrap.md) | 0 | 완료 — Next.js 부트, 두 private 레포 생성, vendor submodule |
| 2026-05-06 | [03 phase0_spine_poc](2026-05-06_03_phase0_spine_poc.md) | 0 | 완료 — pixi+spine 설치, spineboy 마운트, 슬롯 토글 검증 |

## 운영 규칙

- progress 파일은 **작업 시작 시점**에 만들고, **종료 시점**에 마무리한다 (사후 작성 금지 — 잊는다).
- 한 PR이 여러 토픽에 걸친다면 두 progress 파일에 모두 짧게 적되, 본문은 하나로 통합.
- 결정이 [plan/](../plan/INDEX.md)을 바꿀 정도면 plan 문서를 직접 갱신하고, 이 progress에는 "plan/03 갱신: Spine→Live2D" 한 줄만.
- 실패한 시도도 기록. "이 접근으로 X시간 썼고 안 됐다"가 미래의 자기 자신을 살린다.
