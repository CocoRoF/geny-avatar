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
| 2026-05-09 | [61 phase6_kickoff](2026-05-09_61_phase6_kickoff.md) | 6.0 | 진행중 — Phase 6 sub-sprint 분할 + SAM hosting 결정 (Replicate). 6.1 provider/route → 6.2 DecomposeStudio segment mode → 6.3 boolean compose → 6.4 batch auto-decompose → 6.5 fullscreen mode |
| 2026-05-09 | [62 sprint_6_1_sam_route](2026-05-09_62_sprint_6_1_sam_route.md) | 6.1 | 완료 — SAM 도메인 타입(`lib/ai/sam/`) + `/api/ai/sam` Replicate route (Prefer: wait + poll fallback) + `/poc/sam-debug` 진단 페이지. UI 통합은 6.2 |
| 2026-05-09 | [63 openai_alignment_fix](2026-05-09_63_openai_alignment_fix.md) | 5 fix | 완료 — gpt-image-2 결과 위치/크기 mismatch 해소. (1) `prepareOpenAISource` 가 silhouette tight-crop 후 1024²에 pad → 모델 frame이 subject로 꽉 참 → 페인트 위치 정확. (2) submit 직후 `postprocessGeneratedBlob` 즉시 실행 → preview/apply/history 가 같은 후처리 blob 공유. `openAIPadding`에 `sourceBBox` 추가, `postprocess`가 source canvas의 정확한 위치로 re-composite |
| 2026-05-09 | [64 multi_component_kickoff](2026-05-09_64_multi_component_kickoff.md) | 5 polish | 진행중 — disjoint silhouette을 여럿 가진 layer (예: torso + shoulder frill) 의 generation 깨짐 해소 정공. A+B 결정 (auto component split + region-aware UI). sub-sprint A.1~A.3 분할 |
| 2026-05-09 | [65 sprint_a_1_connected_components](2026-05-09_65_sprint_a_1_connected_components.md) | A.1 | 완료 — `findAlphaComponents` 8-connected 라벨링 + `isolateWithMask` GPU composite + `prepareOpenAISourcesPerComponent` per-island submit-ready package. 라이브러리만, UI 변경 없음 |
| 2026-05-09 | [66 sprint_a_2_parallel_submit](2026-05-09_66_sprint_a_2_parallel_submit.md) | A.2 | 완료 — GeneratePanel OpenAI 경로 multi-component 전환. N개 island 자동 분리 → 병렬 N submit → per-component postprocess (sourceBBox + binary mask alpha-enforce) → `compositeProcessedComponents` 로 합성. 단일 component layer 동일 동작. UI 변경 없음 (A.3에서 region-aware UI) |
| 2026-05-09 | [67 sprint_a_3_region_aware_ui](2026-05-09_67_sprint_a_3_region_aware_ui.md) | A.3 | 완료 — multi-component layer일 때 SOURCE 위 SVG overlay (색별 outline + 번호) + aside REGIONS 섹션 (썸네일 + per-region textarea) + COMMON CONTEXT 라벨 전환. submit 시 region별 prompt 조합 (`<base>\n\nFor [image 1] (region N of M, WxH px): <perRegion>`) → `refinedPrompt` 로 전달. 단일 component layer 기존 UI 유지 |
| 2026-05-09 | [68 e_kickoff](2026-05-09_68_e_kickoff.md) | E.0 | 진행중 — 사용자 자율 region 정의. E.1 명명+영구저장 / E.2 DecomposeStudio split mode (SAM+brush) / E.3 GeneratePanel manual region 우선 사용. A+B+E 합쳐서 multi-region generation 정밀도 끝까지 |
| 2026-05-09 | [69 sprint_e_1_component_labels](2026-05-09_69_sprint_e_1_component_labels.md) | E.1 | 완료 — IDB v8 `componentLabels` store + `useComponentLabels` hook + region tile inline name input. 사용자가 region 1/2/3 → "torso", "shoulder frill" 등 명명. 400ms debounced IDB save, bbox signature 키. submit prompt에 "region 'torso' (...)" 형식으로 모델 전달 |
| 2026-05-09 | [70 sprint_e_2_decompose_split_mode](2026-05-09_70_sprint_e_2_decompose_split_mode.md) | E.2 | 완료 — IDB v9 `regionMasks` store + `useRegionMasks` hook + DecomposeStudio top mode toggle [trim \| split]. split mode에서 사용자가 N개 named region 직접 brush로 정의, region별 binary mask + name + color → IDB 영구 저장. SAM 통합은 follow-up |
| 2026-05-09 | [71 sprint_e_3_manual_regions_in_panel](2026-05-09_71_sprint_e_3_manual_regions_in_panel.md) | E.3 | 완료 — GeneratePanel이 manual regions 우선 사용. `prepareOpenAISourcesFromMasks` (manual variant) + `bboxFromMask` + `ComponentInfo` extended with optional name/color. mount 시 manual 있으면 그대로 hydrate, 아니면 auto-detect. UI에 [manual]/[auto] chip + 색깔 매치. A+B+E 정공 정밀도 마무리 |
| 2026-05-09 | [72 f_kickoff](2026-05-09_72_f_kickoff.md) | F.0 | 진행중 — Phase 6 진입 전 GeneratePanel 4가지 nopen-blocker. F.1 sticky actions footer / F.2 per-region 선택 재생성 / F.3 applied texture revert |
| 2026-05-09 | [73 sprint_f_pre_phase6_polish](2026-05-09_73_sprint_f_pre_phase6_polish.md) | F.1+F.2+F.3 | 완료 — aside 를 scrollable content + sticky actions footer 로 분리 (긴 region list 도 generate/apply 항상 visible, history 자동 가시화). `regionStates` per-region 상태 + `runRegionGen` helper + `regenerateOneRegion` ↻ 버튼 (단일 region 재호출, cached refinement). `onRevertTexture` 빨간 actions 버튼 (confirm + IDB row 삭제 + atlas 원본 복귀) |
| 2026-05-09 | [74 sprint_f_4_per_region_regen_fix](2026-05-09_74_sprint_f_4_per_region_regen_fix.md) | F.4 | 완료 — F.2 의 ↻ button 이 prompt 가드 빠진 채로 enabled → API 400 → silent failure 버그 수정. `regenDisabled` 에 prompt 체크 추가, `runRegionGen` 이 panel prompt 비면 per-region 을 raw prompt 로 fallback, fail-fast guard, tile 에 inline failure reason + per-region ✕ clear 버튼 |
| 2026-05-09 | [75 sprint_g_focus_mode_redesign](2026-05-09_75_sprint_g_focus_mode_redesign.md) | G | 완료 — multi-region UX 정공 재설계. modal이 picker view → focus mode 흐름. PICKER: 큰 카드 그리드, click 하면 그 region focus 진입. FOCUS: SOURCE 에 isolated region tight crop, 단일 prompt textarea (region 별 보존), generate 버튼은 그 region 한 개만 호출. "generate all" 제거. single-component layer 는 자동 focus 0 으로 기존 UX 유지 |
| 2026-05-09 | [76 sprint_g_7_focus_result_preview](2026-05-09_76_sprint_g_7_focus_result_preview.md) | G.7 | 완료 — focus mode RESULT 가 region tight-crop canvas 로 paint. SOURCE 와 같은 bbox dim/framing 으로 1:1 비교 가능. composite blob (3863×3381 등) 을 RESULT 에 그대로 보여주던 silent UX 실패 (region 1 의 1016×639 영역이 panel 에서 거의 안 보임) 해소 |
| 2026-05-09 | [77 sprint_g_8_apply_race_fix](2026-05-09_77_sprint_g_8_apply_race_fix.md) | G.8 | 완료 — apply-to-atlas 가 빈 텍스처로 덮어쓰던 React race 수정. `setRegionStates(updater)` 안에서 캡처하던 `updatedBlobs` 가 비동기 updater 때문에 `await recompositeResult(...)` 시점에 빈 `[]` → composite 빈 PNG → alpha=0 source-over 가 no-op → 사용자가 "변화 없음" 본 정확한 증상. `regionStatesRef` 도입해 동기로 read |
| 2026-05-09 | [78 sprint_g_9_per_region_refine](2026-05-09_78_sprint_g_9_per_region_refine.md) | G.9 | 완료 — focus mode에서 Refine prompt 토글이 dead 였던 버그 수정. `regenerateOneRegion`이 cached refinement 만 재사용하고 `refinePrompt` 호출 자체를 안 하던 문제. per-region prompt + isolated region source 로 refine 호출 추가, cache hit 시 재사용, 실패 시 raw fallback |
| 2026-05-09 | [79 sprint_6_2_sam_in_decompose](2026-05-09_79_sprint_6_2_sam_in_decompose.md) | 6.2 | 완료 — DecomposeStudio split mode에 SAM auto 서브모드 추가. brush 도구가 paint/erase/auto 3-way. auto 모드: 좌클릭 fg / 우클릭 bg 점 누적 → "compute mask" → /api/ai/sam 호출 → candidate thumbnails → 클릭하면 선택된 region에 union 적용. SVG overlay로 점 시각화, error inline, sub-mode 전환 시 자동 cleanup |
| 2026-05-09 | [80 phase6_complete](2026-05-09_80_phase6_complete.md) | 6.3+6.4+6.5 | 완료 — Phase 6 마지막 세 sprint 묶음. **6.3** SAM apply에 union/intersect/subtract boolean op (`samComposeOp` state + 3-way grid toggle). **6.4** "auto-detect" 버튼이 `findAlphaComponents` 로 region을 component별로 시드 (replace/append confirm). **6.5** fullscreen 토글 (헤더 버튼) — modal이 h-screen w-screen 으로 전환. Phase 6 (DecomposeStudio Pro) 완료 |
| 2026-05-09 | [81 decompose_polish_after_phase6](2026-05-09_81_decompose_polish_after_phase6.md) | 6 fix | 완료 — DecomposeStudio polish 4종. (1) region tile의 nested `<button>` 해결로 hydration error 제거 (outer를 div로, child들 sibling). (2) 처음 split 진입 시 `autoDetectRegions({silent})` 자동 시드 (한 번만, mount-scoped ref). (3) delete confirm + "clear all" 버튼 + ✕ hover red. (4) fullscreen 시 preview canvas backing을 `source × max(2,dpr)` 로 bump + `imageSmoothingQuality=high` → texture sharp. brush/SAM 좌표는 source pixel 공간으로 통일 |
| 2026-05-09 | [82 decompose_modal_size_and_close_guard](2026-05-09_82_decompose_modal_size_and_close_guard.md) | 6 fix | 완료 — DecomposeStudio 모달 사용감 개선. 디폴트 사이즈 `h-[90vh] w-[min(90vw,1100px)]` → `h-[95vh] w-[min(96vw,1800px)]` 로 확대. `requestClose` guard 추가: header close / overlay click / esc 세 path 모두 dirty 일 때 confirm dialog ("OK to discard, Cancel to keep editing"). save & close 는 wrap 안 함 |
| 2026-05-10 | [83 decompose_aspect_ratio_fix](2026-05-10_83_decompose_aspect_ratio_fix.md) | 6 fix | 완료 — fullscreen / 와이드 모달에서 texture 좌우 stretch 버그 수정. `max-w-full` + `max-h-full` 양축 동시 활성화 시 브라우저가 W/H 독립 cap → aspect 깨짐. wrapper 에 source dim 기반 explicit `aspect-ratio` CSS + `height:100% width:auto` 적용으로 강제 보존. `sourceAspect` state 가 modal ready 시 캡처 |
| 2026-05-10 | [84 generate_panel_parity_upgrades](2026-05-10_84_generate_panel_parity_upgrades.md) | gen polish | 완료 — GeneratePanel 4가지 동시 업그레이드. (1) 모달 `h-[90vh] w-[min(92vw,1200px)]` → `h-[95vh] w-[min(96vw,1800px)]` + sidebar 320→480px. (2) `requestClose` guard: in-flight 면 alert reject, unapplied result 면 confirm. 3 path 모두. (3) `originalSourceCanvasRef` (no-texture extraction) + `onRevertFocusedRegion` 으로 특정 region 만 pristine 복귀, atlas 즉시 갱신. (4) `AIJobRow.regionSignature?` 추가, apply 시 focused region sig 기록, `visibleHistory` 가 focus mode 면 그 region 만 필터 |
| 2026-05-10 | [85 phase7_kickoff](2026-05-10_85_phase7_kickoff.md) | 7.0 | 진행중 — Phase 7 (Polish & V1 Release) sub-sprint 분할. 7.1 Help modal / 7.2 Onboarding hint / 7.3 에러 한국어화 / 7.4 라이선스 attribution / 7.5 README + landing / 7.6 성능 최적화 |
| 2026-05-10 | [86 sprint_7_1_help_modal](2026-05-10_86_sprint_7_1_help_modal.md) | 7.1 | 완료 — discoverability 1차 진입점. 신규 `HelpModal` 컴포넌트 (workflow / shortcuts / panels / modals / tips 5 section). editor 두 page (`/edit/[id]` + `/edit/builtin/[key]`) 헤더에 `?` 버튼 + `?` 키 토글 wiring |
| 2026-05-10 | [87 sprint_7_2_onboarding](2026-05-10_87_sprint_7_2_onboarding.md) | 7.2 | 완료 — 첫 editor 진입 시 캔버스 위 onboarding 배너 (3 step 한 줄 안내 + "전체 안내 (?)" + "got it"). localStorage versioned key 로 영구 dismiss. HelpModal 에 "show onboarding again" 버튼으로 reset 가능 |
| 2026-05-10 | [88 sprint_7_3_korean_messages](2026-05-10_88_sprint_7_3_korean_messages.md) | 7.3 | 완료 — user-facing alert / confirm / status / placeholder 한국어화. GeneratePanel · DecomposeStudio · ReferencesPanel. 버튼 라벨 + dev 로그는 영어 유지. i18n framework 안 깔음 (인라인 번역) |
| 2026-05-10 | [89 sprint_7_4_attribution](2026-05-10_89_sprint_7_4_attribution.md) | 7.4 | 완료 — 외부 SDK / 모델 라이선스 surface. 신규 `AttributionFooter` (Spine / Cubism / Pixi.js / OpenAI 4행) → landing + library 하단. `/poc/library` 카드 origin select 옆 `<details>` "i" → 6 source 별 한국어 라이선스 안내. README "## 라이선스" 섹션 표 4행으로 확장 |

## 운영 규칙

- progress 파일은 **작업 시작 시점**에 만들고, **종료 시점**에 마무리한다 (사후 작성 금지 — 잊는다).
- 한 PR이 여러 토픽에 걸친다면 두 progress 파일에 모두 짧게 적되, 본문은 하나로 통합.
- 결정이 [plan/](../plan/INDEX.md)을 바꿀 정도면 plan 문서를 직접 갱신하고, 이 progress에는 "plan/03 갱신: Spine→Live2D" 한 줄만.
- 실패한 시도도 기록. "이 접근으로 X시간 썼고 안 됐다"가 미래의 자기 자신을 살린다.
