# 2026-05-07 — Sprint 4.5: Import `*.geny-avatar.zip` + 편집 영속화

[`41 phase4_kickoff`](2026-05-07_41_phase4_kickoff.md)의 마지막 sub-sprint. 4.4 export의 짝. 사용자가 export한 ZIP을 드롭하면 새 puppet으로 등록되고 모든 variants/masks/AI textures/visibility가 복원된다. 보너스로 mask/AI texture/visibility의 IDB 영속화도 같이 들어가서 페이지 새로고침을 견디게 된다.

## 변경 surface

### IDB v5 — `layerOverrides` store

```ts
type LayerOverrideRow = {
  id: LayerOverrideRowId;
  puppetKey: string;           // PuppetId 또는 "builtin:<key>"
  layerExternalId: string;     // runtime-stable
  kind: "mask" | "texture";
  blob: Blob;
  updatedAt: number;
};
```

복합 인덱스 `[puppetKey+layerExternalId+kind]`로 upsert (한 layer의 mask 교체)와 `[puppetKey+kind]`로 hydrate ("이 puppet의 모든 mask 가져와")가 둘 다 single-query.

### IDB v6 — `puppetSessions` store

Visibility는 layer 단위가 아니라 puppet 단위 한 row로 묶음 (작고 자주 변경되므로 단일 upsert가 효율적).

```ts
type PuppetSessionRow = {
  puppetKey: string;          // primary key
  visibility: Record<string, boolean>;   // externalId → visible
  updatedAt: number;
};
```

### 신규 — `lib/avatar/useLayerOverridesPersistence.ts`

3개 채널을 묶어 처리하는 단일 훅:

1. **Hydrate on mount** — `puppetKey + layers` 준비되면 `listLayerOverridesForPuppet` (mask, texture) + `getPuppetSession` (visibility) 동시 fetch. externalId → Layer.id 변환 후 store에 inject.
2. **Persist on change** — `useEditorStore.subscribe`로 `layerMasks` / `layerTextureOverrides` / `visibilityOverrides`의 diff를 감지해 IDB 저장. Hydrate 직후 첫 tick은 self-write 방지를 위해 skip (ref 비교).
3. **Cleanup on unmount / key change** — ref 리셋 (다음 puppet의 hydrate가 이전 ref와 diff되지 않도록).

Mask/texture는 per-layer 추가/교체/삭제 행 단위 IDB 호출. Visibility는 변경 시 한 row 통째 upsert (debounce 없음 — 메모리/IDB 비용 무시 가능).

3개 edit 페이지 모두 `useLayerOverridesPersistence(puppetKey, layers)` 한 줄 추가. 부수 효과: **DecomposeStudio mask + AI 적용 texture가 페이지 새로고침을 견디고**, **visibility 변경도 새로고침을 견딘다**. 이전엔 모두 in-memory였다.

### 신규 — `lib/import/restoreBundle.ts`

`tryRestoreGenyAvatarZip(file)`:

1. ZIP unzipSync → `avatar.json` 마커 확인. 없으면 `null` 반환 (caller가 일반 parseBundle로 fallback)
2. schemaVersion 검사
3. `bundle/*` → BundleEntry[] → `savePuppet()` (새 PuppetId)
4. `manifest.variants` → `saveVariant(puppetKey=newId, source, sourceExternalId, ...)` 각각
5. `manifest.session.masks` / `.textures` → `saveLayerOverride(...)` 각각
6. `manifest.session.visibility` → `savePuppetSession(...)`

부분 실패는 `warnings`로 모음 (puppet 자체는 살리고 일부 row만 fail해도 사용자가 결과를 볼 수 있게). bundle 파싱이 빈 zip이면 throw.

### Upload 페이지 import 라우팅

`app/poc/upload/page.tsx`의 `handleFiles`가 ZIP일 때 먼저 `tryRestoreGenyAvatarZip`을 시도. 결과가 non-null이면:
- IDB 쓰기 끝난 puppetId로 `window.location.href = /edit/<puppetId>` 강제 네비게이션
- non-null이면 일반 parseBundle 경로 안 탐
- null이면 (avatar.json 없음 = 일반 puppet bundle) 기존 경로 그대로

Hard navigate를 쓴 건 새 editor 페이지가 fresh state로 시작하면서 `useLayerOverridesPersistence` hydrate가 한 번에 깔끔히 도는 게 유리해서. SPA navigation도 동작은 하지만 라이프사이클 충돌 가능성을 회피.

UploadDropzone 힌트도 갱신: "Or a previously-exported \*.geny-avatar.zip — it'll be restored with variants and overrides intact."

## 의도적 한계

- **활성 variant 복원 X**: export에 활성 variant id를 안 담음 (4.1에서 의도적으로 active 추적 안 함). 복원 후 사용자가 원하는 variant를 다시 클릭하면 됨.
- **AI history 복원 X**: `aiJobs` 테이블은 export에 안 담음 (LICENSE.md 텍스트로만 보존). import 시 AI history 사이드바는 빈 상태로 시작. 결과 텍스처는 layerOverrides에 살아있어 atlas에 적용된 상태는 복원됨.
- **builtin → export → import 후 puppet은 user-uploaded로 분류**: builtin sample을 사용자가 업로드한 후 export → import하면 새 PuppetId가 생성되고 라이브러리에 user upload로 보임. 그게 유일한 일관된 흐름.
- **Schema 마이그레이션 미구현**: 현재 v1만 받음. 향후 schema bump 시 마이그레이션 함수를 `restoreBundle`에 추가할 위치 확보됨.
- **Crash 안전성 X**: import 도중 브라우저가 죽으면 puppet은 IDB에 부분 저장. listPuppets에는 보이지만 일부 변형/오버라이드 누락 가능. 명시적인 transaction wrapping은 향후 polish.

## 검증

- typecheck 통과
- biome 통과
- `next build` 통과

## Phase 4 종료

| Sprint | 주요 작업 | 상태 |
|---|---|---|
| 4.1 | Variant 데이터 모델 + 캡처/적용 (visibility-only) | ✅ |
| 4.2 | Spine Skin → Variant import | ✅ |
| 4.3 | Live2D cdi3 Groups → Variant import | ✅ |
| 4.4 | Export `*.geny-avatar.zip` | ✅ |
| 4.5 | Import `*.geny-avatar.zip` + 편집 IDB 영속화 | ✅ |

V1 시나리오 C ("작업 export 후 다시 import해서 동일 상태 재현") 시연 가능. 추가로 mask + AI texture + visibility의 page-reload survival이 hidden bonus로 들어왔다 — Phase 3.4의 "AI history만 영속" 한계가 여기서 자연스럽게 해소.

## 다음 후보 (사용자 결정)

[plan/07](../plan/07_phased_roadmap.md)의 다음 phase는 5 (AI Quality Push: IP-Adapter, LoRA, ComfyUI 자체 호스팅) 또는 6 (Decompose Studio Pro: SAM 자동 마스크). 사용자 검증 후 다음 phase 선택.
