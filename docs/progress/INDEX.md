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
| 2026-05-06 | [22 sprint_1_3d_origin_close](2026-05-06_22_sprint_1_3d_origin_close.md) | 1.3d | 완료 — origin select, test assets 가이드, Phase 1.3 마무리 |
| 2026-05-06 | [23 zip_filename_mojibake](2026-05-06_23_zip_filename_mojibake.md) | 1.3 fix | 완료 — UTF-8/GBK/Shift_JIS/EUC-KR 자동 복원 |
| 2026-05-06 | [24 blob_mime_type](2026-05-06_24_blob_mime_type.md) | 1.3 fix | 완료 — Blob type 부여로 Pixi parser 인식 |
| 2026-05-06 | [25 blob_mime_force_and_diagnostic](2026-05-06_25_blob_mime_force_and_diagnostic.md) | 1.3 fix | 완료 — 옛 IndexedDB save 강제 normalize + 진단 로그 |
| 2026-05-06 | [26 pixi_assets_blob_url_detector](2026-05-06_26_pixi_assets_blob_url_detector.md) | 1.3 fix | 완료 — Live2DAdapter가 텍스처를 명시적 loadParser로 preload |
| 2026-05-06 | [27 phase1_4_kickoff](2026-05-06_27_phase1_4_kickoff.md) | 1.4 | 완료 — sub-sprint 분할 (1.4a/b) |
| 2026-05-06 | [28 sprint_1_4a_store_components_edit](2026-05-06_28_sprint_1_4a_store_components_edit.md) | 1.4a | 완료 — Zustand store, 본 컴포넌트, /edit/[id] 페이지 |
| 2026-05-06 | [29 sprint_1_4b_builtin_undo_shortcuts](2026-05-06_29_sprint_1_4b_builtin_undo_shortcuts.md) | 1.4b | 완료 — 내장 샘플 그리드, Undo/Redo, 키보드 단축키 |
| 2026-05-06 | [30 phase2_kickoff_thumbnails](2026-05-06_30_phase2_kickoff_thumbnails.md) | 2.0 | 완료 — Phase 2 sub-sprint 분할 + puppet 썸네일 (extract → webp → IDB) |
| 2026-05-06 | [31 sprint_2_1_spine_atlas_layer_thumbs](2026-05-06_31_sprint_2_1_spine_atlas_layer_thumbs.md) | 2.1 | 완료 — Spine atlas region → Layer.texture, LayersPanel 행 썸네일 (Cubism은 2.2) |
| 2026-05-06 | [32 sprint_2_2_cubism_uv_bbox_thumbs](2026-05-06_32_sprint_2_2_cubism_uv_bbox_thumbs.md) | 2.2 | 완료 — Cubism drawable UV bbox → Layer.texture, LayersPanel에 모든 puppet 썸네일 |
| 2026-05-06 | [33 sprint_2_3_decompose_studio_v1](2026-05-06_33_sprint_2_3_decompose_studio_v1.md) | 2.3 | 완료 — DecomposeStudio 모달 (alpha threshold + 브러시 paint/erase + save→PNG blob) |
| 2026-05-06 | [34 sprint_2_4_clipped_studio_live_masks](2026-05-06_34_sprint_2_4_clipped_studio_live_masks.md) | 2.4 | 완료 — 삼각형 clip으로 footprint만 표시 + 마스크 라이브 렌더 적용 (GPU 재업로드) |
| 2026-05-07 | [35 sprint_2_5_cubism_part_dedup](2026-05-07_35_sprint_2_5_cubism_part_dedup.md) | 2.5 | 완료 — Cubism part 중복 해소 (direct/descendant 분리 + container hide + cdi3 display names) |
| 2026-05-07 | [36 sprint_2_6_clip_mask_filter](2026-05-07_36_sprint_2_6_clip_mask_filter.md) | 2.6 | 완료 — pure-clip part 필터 (getDrawableMasks reverse lookup) + multi-page 진단 |
| 2026-05-07 | [37 phase3_kickoff](2026-05-07_37_phase3_kickoff.md) | 3.0 | 완료 — Phase 3 sub-sprint 분할 + GeneratePanel UI 골격 (백엔드 X) |
| 2026-05-07 | [38 sprint_3_1_gemini_openai](2026-05-07_38_sprint_3_1_gemini_openai.md) | 3.1 | 완료 — Gemini Nano Banana + OpenAI gpt-image-2 실호출 (provider 추상화 + API routes + 폴링) |
| 2026-05-07 | [39 phase3_complete](2026-05-07_39_phase3_complete.md) | 3.2/3.3/3.4 | 완료 — Replicate stub + atlas apply + IDB history + retry (Phase 3 종료) |
| 2026-05-07 | [40 phase3_hotfix_pass](2026-05-07_40_phase3_hotfix_pass.md) | 3 hotfix | 완료 — 9개 fix 묶음 (OpenAI 품질 + mask/gen 합성 + Cubism multi-page split) |
| 2026-05-07 | [41 phase4_kickoff](2026-05-07_41_phase4_kickoff.md) | 4.0 | 진행중 — Phase 4 sub-sprint 분할 (4.1 Variant 모델 / 4.2 Spine Skin import / 4.3 Live2D groups / 4.4 Export / 4.5 Import) |
| 2026-05-07 | [42 sprint_4_1_variant_visibility](2026-05-07_42_sprint_4_1_variant_visibility.md) | 4.1 | 완료 — IDB v3 variants store + useVariants 훅 + VariantsPanel + 3개 edit 페이지 와이어링 |
| 2026-05-07 | [43 sprint_4_2_spine_skin_import](2026-05-07_43_sprint_4_2_spine_skin_import.md) | 4.2 | 완료 — Spine Skin → Variant import (어댑터 인터페이스에 listNativeVariants/applyVariantData/getActiveVariantData, IDB v4, "from puppet" 드롭다운) |
| 2026-05-07 | [44 sprint_4_3_cubism_groups_import](2026-05-07_44_sprint_4_3_cubism_groups_import.md) | 4.3 | 완료 — cdi3 Part Groups → Variant import (NativeVariant.visibility 채널 + Live2DAdapter cdi3 Groups 파싱 + multi-page fan-out) |
| 2026-05-07 | [45 sprint_4_4_export_zip](2026-05-07_45_sprint_4_4_export_zip.md) | 4.4 | 완료 — `*.geny-avatar.zip` export (avatar.json + bundle/ + overrides/ + LICENSE.md, ExportButton, fflate zipSync) |
| 2026-05-07 | [46 sprint_4_5_import_zip](2026-05-07_46_sprint_4_5_import_zip.md) | 4.5 | 완료 — `*.geny-avatar.zip` import + IDB v6 (layerOverrides + puppetSessions) + useLayerOverridesPersistence (hydrate + write) → mask/AI texture/visibility 새로고침 survival |
| 2026-05-07 | [47 export_model_baked](2026-05-07_47_export_model_baked.md) | 4 polish | 완료 — "export model" 두 번째 모드 추가: edit이 atlas 픽셀에 베이크된 표준 puppet zip (visibility erase + mask + AI texture를 모든 atlas page에 한 번에 베이크) |
| 2026-05-07 | [48 unzip_double_decode_fix](2026-05-07_48_unzip_double_decode_fix.md) | 4 fix | 완료 — recodeZipName이 EFS-flagged zip(우리 export 포함)을 다시 디코드해 CJK 파일명을 망가뜨리던 버그 수정 |
| 2026-05-07 | [49 export_model_hide_cascade](2026-05-07_49_export_model_hide_cascade.md) | 4 fix | 완료 — Export Model의 visibility erase가 Cubism part hierarchy cascade를 따르지 않던 버그 수정 (어댑터에 listHiddenAtlasFootprints 추가, Live2D는 partToDescendantDrawables로 자식 drawables까지 expand) |
| 2026-05-07 | [50 export_model_hide_via_model_patch](2026-05-07_50_export_model_hide_via_model_patch.md) | 4 fix | 완료 — atlas erase 접근 폐기, hidden part는 모델 파일 패치로 처리 (Cubism: 모든 motion3.json에 PartOpacity=0 커브 주입, Spine JSON: slot.attachment="" 비우기). atlas는 mask + AI texture만 합성. |
| 2026-05-07 | [51 export_model_pose_hide](2026-05-07_51_export_model_pose_hide.md) | 4 fix | 완료 — motion 패치만으로는 motions 그룹이 ""인 puppet에서 안 됨 (Framework가 auto-play 안 함). pose3.json에 [anchor, hidden] 그룹 추가하는 게 진짜 정답 — 매 프레임 자동 적용 |
| 2026-05-07 | [52 cubism_id_csmstring_unwrap](2026-05-07_52_cubism_id_csmstring_unwrap.md) | 4 fix | 완료 — coerceCubismId가 csmString을 인식 못해 모든 layer.externalId가 fallback `part_<idx>`였던 결정적 버그 수정. 이게 47-51까지 export model이 모두 실패한 진짜 원인 (pose/motion id가 진짜 moc3 ID와 안 맞아 매칭 실패) |
| 2026-05-07 | [53 export_staged_chips](2026-05-07_53_export_staged_chips.md) | 4 polish | 완료 — LayerRow의 hide 배지 + name 취소선, LayersPanel 헤더의 hide count chip, ExportButton 옆 staged 요약 chip + tooltip. 사용자 토글이 export에 베이크된다는 신호를 한 눈에 보이게 |
| 2026-05-07 | [54 baked_hidden_indicator](2026-05-07_54_baked_hidden_indicator.md) | 4 polish | 완료 — Layer.bakedHidden 추가, Live2DAdapter가 pose3.json 파싱해 forced-hidden parts 식별, LayersPanel/ExportButton에 amber `baked` 표시. 이미 export-import 사이클을 거친 puppet에서 토글이 왜 효과 없는지 사용자에게 보여줌. resolveSiblingUrl도 blob URL 처리하도록 fix (cdi3 displayNames도 덜리 동작) |
| 2026-05-07 | [55 phase5_kickoff](2026-05-07_55_phase5_kickoff.md) | 5.0 | 진행중 — Phase 5 sub-sprint 분할 (gpt-image-2 단독 정공). 5.1 reference store / 5.2 multi-image input / 5.3 ref selection UX / 5.4 prompt templates / 5.5 comparison viewer. ComfyUI/LoRA는 별도 후속 phase로 deferred |
| 2026-05-07 | [56 sprint_5_1_reference_store](2026-05-07_56_sprint_5_1_reference_store.md) | 5.1 | 완료 — IDB v7 puppetReferences store + useReferences 훅 + ReferencesPanel + 3개 edit 페이지 와이어링. 인프라만 — 5.2가 OpenAI 호출에 흘려넣음 |
| 2026-05-07 | [57 sprint_5_2_multi_image_input](2026-05-07_57_sprint_5_2_multi_image_input.md) | 5.2 | 완료 — provider capability `supportsReferenceImages` + `referenceImages?: Blob[]` 입력. OpenAI는 `image[]` 다중 슬롯 + ref anchor 프롬프트 자동 prepend. Gemini/Replicate는 false (server route에서 drop). GeneratePanel이 useReferences 자동 포함 + UI hint |
| 2026-05-07 | [58 sprint_5_3_active_refs_iteration](2026-05-07_58_sprint_5_3_active_refs_iteration.md) | 5.3 | 완료 — Active references 박스 (puppet ref 체크박스 + last-result iterative anchor 토글). 직전 succeeded blob을 자동으로 image[]에 ride along — cloud-API 단독 previous_response_id 등가 |
| 2026-05-07 | [59 sprint_5_4_prompt_refinement](2026-05-07_59_sprint_5_4_prompt_refinement.md) | 5.4 | 완료 — gpt-image-2 docs 가이드 따라 composePrompt 재설계 ([image 1]/[image 2..N] slot map + role separation + preservation block). LLM refinement endpoint `/api/ai/refine-prompt` (gpt-4o-mini 기본) + 토글 + refined preview |
| 2026-05-07 | [60 sprint_5_5_comparison_viewer](2026-05-07_60_sprint_5_5_comparison_viewer.md) | 5.5 | 완료 — history 행 multi-select (max 2) + ComparisonModal full-screen overlay (slot A/B side-by-side + provider/model/prompt 메타). Phase 5 V1 마무리, 5.6 ComfyUI/IP-Adapter/LoRA는 deferred |

## 운영 규칙

- progress 파일은 **작업 시작 시점**에 만들고, **종료 시점**에 마무리한다 (사후 작성 금지 — 잊는다).
- 한 PR이 여러 토픽에 걸친다면 두 progress 파일에 모두 짧게 적되, 본문은 하나로 통합.
- 결정이 [plan/](../plan/INDEX.md)을 바꿀 정도면 plan 문서를 직접 갱신하고, 이 progress에는 "plan/03 갱신: Spine→Live2D" 한 줄만.
- 실패한 시도도 기록. "이 접근으로 X시간 썼고 안 됐다"가 미래의 자기 자신을 살린다.
