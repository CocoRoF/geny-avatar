# 2026-05-07 — Phase 4 Kickoff: Variant System & Export

Phase 3 (AI Texture MVP)와 [`40_phase3_hotfix_pass`](2026-05-07_40_phase3_hotfix_pass.md)로 "한 layer 단위로 mask 그리고 AI로 다시 칠하고 atlas에 적용 + history 영속" 흐름이 닫혔다. Phase 4는 그 다음 — **편집 결과를 의상 묶음(Variant)으로 저장하고, puppet 전체를 ZIP으로 export/import**.

## Phase 4 스코프 ([plan/07](../plan/07_phased_roadmap.md))

목표: 의상 변형 시스템 + Export/Import 라운드트립.

산출물:
- Variant 모델 + UI: "이 layer 변형을 새 Variant로 저장"
- Spine Skin → Variant import
- Live2D part group 가시성 → Variant import
- Export: `*.geny-avatar.zip` 생성 (메타 + textures + 변경된 atlas + LICENSE.md 자동 첨부)
- Import: 같은 ZIP을 받아 동일 상태 복원

완료 조건: V1 시나리오 C 시연 가능 + 사용자가 작업을 export 후 다시 import해서 동일 상태 재현.

## Sub-sprint 분할

각 sprint는 하나의 PR로 atomic하게 끝나야 한다. 사용자 검증 후 다음 sprint 진입.

### Sprint 4.1 — Variant 데이터 모델 + 캡처/적용 UI (이번)

이미 [`lib/avatar/types.ts`](../../lib/avatar/types.ts)에 `Variant` 타입은 정의돼 있고, `Avatar.variants: Variant[]` 슬롯도 비어있다. 빈 슬롯에 실제 동작을 채운다.

- store slice: `variants: Variant[]`, `activeVariantId: VariantId | null`
- 액션: `captureVariantFromCurrent(name)`, `applyVariant(id)`, `deleteVariant(id)`, `renameVariant(id, name)`
- "current" = 지금 적용된 visibility/color/opacity overrides + (optional) layerMasks/layerTextureOverrides 참조
- 적용은 store override map을 덮어쓰고 어댑터에 한 번 push (이미 있는 경로 재사용)
- Variants 사이드바 (LayersPanel 옆 또는 ToolsPanel 안): list + Apply/Rename/Delete
- IDB persist: 각 puppet의 variants를 `puppetKey`로 묶어 `variants` store에 저장

이 sprint는 **데이터 + 캡처 + 적용**까지만. import (Spine Skin / Live2D groups)는 4.2/4.3으로 분리 — 두 어댑터의 native variant 개념이 다 다르고, capture/apply 자체가 안정되기 전엔 import을 위한 데이터 흐름을 검증할 수 없다.

### Sprint 4.2 — Spine Skin → Variant import

Spine 모델의 각 Skin을 한 Variant로 import. Skin이 슬롯의 attachment를 바꾸므로 `overrides[layerId].attachmentName`을 채운다.

- `SpineAdapter.load()` 단계에서 모든 Skin 열거 + Variant 생성
- 적용 시 `skeleton.setSkinByName(...)` → spine 자체 path
- AvatarAdapter 인터페이스에 `applyVariant(variantId)` (또는 `applyAttachmentOverrides`) 추가
- Live2DAdapter는 이 sprint에서는 no-op (다음 sprint)

### Sprint 4.3 — Live2D part-group 가시성 → Variant import

Cubism은 native skin 개념이 없지만 cdi3.json `Groups`에 part 그룹 가시성 프리셋이 들어있는 puppet들이 있음 (의상별 group 토글). 그 정보를 Variant로 변환.

- cdi3.json `Groups` 파싱 + 각 group을 visibility-only Variant로
- Live2DAdapter: applyVariant 시 group의 part들에 `setLayerVisibility` 일괄 적용
- 이미 `partOpacityOverrides` 경로가 있으므로 추가 비용 적음

### Sprint 4.4 — Export `*.geny-avatar.zip`

```
my-avatar.geny-avatar.zip
├─ avatar.json         # Avatar 메타 (Variant 포함, texture refs는 path)
├─ textures/
│  ├─ original_<id>.png
│  ├─ override_<id>.png
│  └─ ...
├─ overrides/
│  ├─ masks/<layerExternalId>.png
│  └─ textures/<layerExternalId>.png   # AI-generated post-processed
├─ runtime/
│  └─ source/          # 원본 puppet 파일 (수정 안 함)
├─ LICENSE.md          # origin 노트 + GenerationRecord 부착
└─ README.md           # 자동 생성, 무엇이 변경됐는지
```

- fflate로 ZIP 빌드 (이미 upload 쪽에서 의존성 보유)
- `lib/export/buildBundle.ts` — Avatar + 모든 Blob을 받아 ZIP Blob 반환
- `app/edit/.../page.tsx`에 "Export" 버튼 + 다운로드 트리거

### Sprint 4.5 — Import `*.geny-avatar.zip` → 상태 복원

기존 upload dropzone에 geny-avatar zip 인식 추가. 일반 puppet bundle과 분기 — `avatar.json` 존재 시 우리 export 형식으로 처리.

- 검증: schemaVersion === 1, 모든 referenced texture/override 파일이 zip에 있는지
- 단계: source bundle 복원 → puppet 로드 → variants/overrides 다시 store에 주입 → activeVariantId 복원
- ZIP round-trip 테스트: export → 새 브라우저 세션 → import → 동일 시각 결과

## 영향 범위

**바뀌는 surface:**
- `lib/store/editor.ts` — variants slice (4.1)
- `lib/avatar/types.ts` — `Variant.overrides`에 `mask?: AssetRef`, `textureOverride?: AssetRef` 검토 (4.1 또는 4.4 진입 시)
- `lib/persistence/db.ts` — `variants` store (v3 마이그레이션, 4.1)
- `lib/adapters/AvatarAdapter.ts` — `applyVariant?` optional method (4.2)
- `lib/adapters/SpineAdapter.ts` — Skin 열거 (4.2)
- `lib/adapters/Live2DAdapter.ts` — cdi3 Groups 파싱 (4.3)
- `lib/export/`, `lib/import/` — 신규 (4.4/4.5)
- `components/VariantsPanel.tsx` — 신규 (4.1)
- `app/edit/[avatarId]/page.tsx`, `/edit/builtin/[key]/page.tsx`, `/poc/upload/page.tsx` — Variants 사이드바 노출 + Export 버튼 (4.1, 4.4)

**바뀌지 않는 surface:**
- AI 생성 경로 — 그대로
- DecomposeStudio — 그대로 (mask는 Variant에 참조로 끼어드는 정도)
- 어댑터 layer/texture 모델 — 그대로

## 다음

Sprint 4.1 진입. 데이터 모델 + store + 패널 UI + IDB persist를 한 PR에 묶어서 끝낸 뒤 사용자 검증.
