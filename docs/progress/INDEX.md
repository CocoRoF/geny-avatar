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
| 2026-05-06 | [04 phase0_cubism_poc](2026-05-06_04_phase0_cubism_poc.md) | 0 | 완료 — engine 1.1.0 설치, Hiyori 마운트, Part 토글 + Motion |
| 2026-05-06 | [05 phase0_dual_mount](2026-05-06_05_phase0_dual_mount.md) | 0 | 완료 — T-rt1 정적 검증, 어댑터 인터페이스 1차안 확정 |
| 2026-05-06 | [06 poc_layout_fix](2026-05-06_06_poc_layout_fix.md) | 0 | 완료 — 사이드바 vh 고정 + 내부 스크롤, 검색·bulk |
| 2026-05-06 | [07 phase1_adapter_interface](2026-05-06_07_phase1_adapter_interface.md) | 1 | 완료 — 도메인 타입, 어댑터 인터페이스, Spine·Live2D 어댑터 클래스 |
| 2026-05-06 | [08 cubism_modern_subexport](2026-05-06_08_cubism_modern_subexport.md) | 1 | 완료 — engine /cubism sub-export로 전환 (Cubism 2 런타임 회피) |
| 2026-05-06 | [09 phase1_registry_and_poc_refactor](2026-05-06_09_phase1_registry_and_poc_refactor.md) | 1 | 완료 — Registry, usePuppet 훅, 세 PoC 페이지 어댑터 사용 리팩터 |
| 2026-05-06 | [10 cubism_id_handle_coerce](2026-05-06_10_cubism_id_handle_coerce.md) | 1 | 완료 — Cubism ID handle을 어댑터 경계에서 string 변환 |
| 2026-05-06 | [11 cubism_scale_and_override_loop](2026-05-06_11_cubism_scale_and_override_loop.md) | 1 | 완료 — fit-to-canvas + 모션 무력화 RAF override loop |
| 2026-05-06 | [12 cubism_drawable_opacity_override](2026-05-06_12_cubism_drawable_opacity_override.md) | 1 | 완료 — 진짜 hide-all 작동 (drawable opacity 직접 mutate) |
| 2026-05-06 | [13 cubism_native_handle_fallback](2026-05-06_13_cubism_native_handle_fallback.md) | 1 | 완료 — native Live2DCubismCore handle fallback + 진단 로그 |
| 2026-05-06 | [14 cubism_ticker_priority_and_dynamic_flags](2026-05-06_14_cubism_ticker_priority_and_dynamic_flags.md) | 1 | 완료 — Pixi ticker LOW priority + dynamicFlags IsVisible bit |
| 2026-05-06 | [15 cubism_beforeModelUpdate_hook](2026-05-06_15_cubism_beforeModelUpdate_hook.md) | 1 | 완료 — 엔진의 beforeModelUpdate 이벤트 직접 hook (정공법) |
| 2026-05-06 | [16 cubism_dual_channel_with_diagnostics](2026-05-06_16_cubism_dual_channel_with_diagnostics.md) | 1 | 완료 — setPartOpacity 부재 + drawable mutate 작동 확인 |
| 2026-05-06 | [17 cubism_internalModel_update_patch](2026-05-06_17_cubism_internalModel_update_patch.md) | 1 | 완료 — internalModel.update monkey-patch (after-update 윈도우, 시각 작동 확인) |
| 2026-05-06 | [18 phase1_3_kickoff](2026-05-06_18_phase1_3_kickoff.md) | 1.3 | 완료 — sub-sprint 1.3a/b/c/d 분할 |
| 2026-05-06 | [19 sprint_1_3a_parse_bundle](2026-05-06_19_sprint_1_3a_parse_bundle.md) | 1.3a | 완료 — fflate, parseBundle, /poc/upload-debug |
| 2026-05-06 | [20 sprint_1_3b_dropzone_load](2026-05-06_20_sprint_1_3b_dropzone_load.md) | 1.3b | 완료 — manifest/atlas blob rewrite + 드롭→로드→미리보기 |
| 2026-05-06 | [21 sprint_1_3c_persistence](2026-05-06_21_sprint_1_3c_persistence.md) | 1.3c | 완료 — Dexie + 자동 저장 + 자산 라이브러리 |

## 운영 규칙

- progress 파일은 **작업 시작 시점**에 만들고, **종료 시점**에 마무리한다 (사후 작성 금지 — 잊는다).
- 한 PR이 여러 토픽에 걸친다면 두 progress 파일에 모두 짧게 적되, 본문은 하나로 통합.
- 결정이 [plan/](../plan/INDEX.md)을 바꿀 정도면 plan 문서를 직접 갱신하고, 이 progress에는 "plan/03 갱신: Spine→Live2D" 한 줄만.
- 실패한 시도도 기록. "이 접근으로 X시간 썼고 안 됐다"가 미래의 자기 자신을 살린다.
