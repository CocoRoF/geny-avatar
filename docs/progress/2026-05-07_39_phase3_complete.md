# 2026-05-07 — Phase 3 완료: Replicate stub + atlas apply + IDB history

세 PR로 나눠 진행. Phase 3의 Replicate full implementation을 제외한 모든 마일스톤 종료. 다음은 사용자 검증 후 Phase 4 (Variant System & Export) 또는 잔여 polish.

## Sprint 3.2 — Replicate stub (모양만)

`lib/ai/providers/replicate.ts` — 클래스 + config + 모델 리스트 (SDXL 3종) 갖춰져 있고 generate()는 명시적인 "shape-only stub" 메시지 throw. 이유:

- Replicate는 prediction id 폴링이 필요 (SDXL 작업이 30초+)
- 같은 long-running-job 메커니즘은 향후 self-hosted ComfyUI에도 쓰임
- 사용자가 로컬 CV 모델은 어렵다고 명시 → 둘을 함께 미루는 게 합리적

키가 set 되면 picker에 노출, generate 시 명확한 메시지로 실패. `git revert <sha>`로 깔끔히 제거 가능.

## Sprint 3.3 — atlas apply (생성된 텍스처를 라이브 렌더에)

생성 PNG가 atlas page에 합성되어 한 프레임 안에 puppet에 반영. Sprint 2.4의 GPU swap 패턴 일반화.

### 변경 surface

- **store**: `layerTextureOverrides: Record<LayerId, Blob>` + `setLayerTextureOverride(id, blob | null)`. `setAvatar` 시 reset.
- **AvatarAdapter**: `setLayerMasks(masks)` → `setLayerOverrides({ masks, textures })`로 변경. 두 어댑터 모두 새 헬퍼 `applyLayerOverrides`(전 `applyMask.ts`) 호출.
- **applyOverrides 합성 순서**: 페이지마다 (1) pristine source부터 시작, (2) `textures` 항목들 `source-over` + 삼각형 clip (이웃 atlas 안 건드림), (3) `masks` 항목들 `destination-out`, (4) Pixi Texture에 swap.
- **LayersPanel**: 이펙트가 두 맵 모두 포함해서 호출. row에 `gen` 배지 추가 (mask 옆).
- **GeneratePanel**: "apply to atlas" 버튼 + `applying` phase. submit→succeeded→applying→close 흐름.

### Postprocess pipeline (`postprocessGeneratedBlob`)

`apply` 클릭 시 raw 결과 blob을 atlas-ready로 가공:
1. **OpenAI 1024² padding crop**: submit 시 저장된 offset으로 inner region만 잘라 layer rect 크기로
2. **alpha enforcement**: 결과 alpha를 source canvas의 alpha와 곱셈 — 결과는 layer footprint 안에서만 보이고 부드러운 edge가 보존됨

postprocess 후 store에 저장 → LayersPanel 이펙트가 `setLayerOverrides` 호출 → 어댑터가 atlas page rebuild + GPU 재업로드 → 다음 프레임 puppet에 반영.

## Sprint 3.4 — IDB cache + history + retry

성공한 모든 apply가 IDB에 영속됨. 동일 layer의 과거 시도들을 GeneratePanel 사이드바에서 클릭 한 번으로 다시 불러오기 가능.

### IDB 스키마 (v2)

```ts
type AIJobRow = {
  id: AIJobRowId;
  puppetKey: string;          // PuppetId 또는 "builtin:<key>"
  layerExternalId: string;    // Spine slot name / Cubism part id (안정 키)
  providerId: ProviderId;
  modelId?: string;
  prompt: string;
  negativePrompt?: string;
  seed?: number;
  resultBlob: Blob;            // postprocess된 블롭
  createdAt: number;
};
```

복합 인덱스 `[puppetKey+layerExternalId+createdAt]`로 panel의 "이 layer history" 쿼리 한 번에 처리. **`Layer.id`는 매 로드마다 재생성되므로 키로 못 씀** — externalId(런타임 native id)가 안정적이라 영속성이 페이지 새로고침은 물론 브라우저 재시작도 견딤.

### `puppetKey` 흐름

페이지 → `<LayersPanel puppetKey>` → `<GeneratePanel puppetKey>`:
- `/edit/[avatarId]` → `puppetId` (IDB row)
- `/edit/builtin/[key]` → `"builtin:${key}"`
- `/poc/upload` → `savedId` (autoSave 후엔 PuppetId, 그 전엔 null)

`puppetKey === null`일 때만 history 비활성화 + panel에 "이 puppet이 라이브러리에 저장된 후 활성화됨" 안내.

### History UI

GeneratePanel 우측 사이드바에 `history · N` 섹션. 각 entry:
- 작은 썸네일 (resultBlob 기반 blob URL, row 컴포넌트가 lifecycle 관리)
- provider · model 짧은 표시
- prompt 한 줄
- 상대 시간 ("3m ago")

클릭 시 `onRevisit(row)` — 결과 미리보기에 그 항목을 다시 띄움. prompt/provider/modelId도 폼에 복원돼서 "약간 수정해서 다시 generate" 흐름 가능. 그 상태에서 `apply` 누르면 atlas에 다시 반영.

### Retry

failed 상태에 `retry` 버튼 추가. 같은 prompt + provider로 즉시 재실행 (`onSubmit` 재호출). 이전 폼이 유지되므로 dismiss → generate 두 클릭이 한 클릭으로 줄어듦.

## 통합 검증 가이드

```bash
# .env.local에 GEMINI_API_KEY 또는 OPENAI_API_KEY (또는 둘 다) 입력
git pull && pnpm install && pnpm dev

# 1) /edit/builtin/hiyori → layer hover → "gen"
# 2) provider 선택, prompt 입력, generate
# 3) succeeded → "apply to atlas" → puppet 캔버스에 즉시 반영
# 4) 같은 layer 다시 열기 → 우측 사이드바에 history 항목 보임
# 5) history 항목 클릭 → 그 결과로 미리보기 복원, prompt 폼도 복원
# 6) 약간 수정 → generate → 새 결과 → apply → puppet 갱신, history도 +1
# 7) 의도적으로 잘못된 prompt 등으로 fail 유도 → retry 버튼으로 즉시 재시도
# 8) Replicate 선택 → fail 메시지 ("shape-only stub") 보임 → 의도된 동작
# 9) 페이지 새로고침 → history 살아있음 (IDB 영속성 검증)
```

## Revert 경로

세 PR 각자 atomic. `git log --oneline | head -3`에서 SHA 확인 후 `git revert <sha>` 또는 `git revert <a>..<b>` (여러 PR 묶어서). Phase 2.6 시점으로 깔끔히 돌아감.

## 알려진 한계 (의도적)

- **Replicate full 구현 X** — Sprint 3.2 stub, ComfyUI와 함께 나중에
- **OpenAI 1024² padding** — non-square layer는 약간의 quality loss. aspect-aware padding은 후속 polish 후보
- **History 정리 UI X** — 오래된 항목 삭제 버튼은 panel에 없음 (`deleteAIJob`은 export됨, UI는 추후)
- **Cancel API X** — 진행중 generate를 서버 측에서 취소하는 경로 없음 (UI에서 Esc 무시 + 페이지 이탈로만 정리)

## Phase 3 종합

원래 plan 마일스톤 ([plan/07](../plan/07_phased_roadmap.md)):
- ✅ /api/ai/generate, /api/ai/status/:jobId 라우트 (+ /result, /providers)
- ✅ Replicate 통합 (옵션 1) — **shape only**, 사용자 결정
- ✅ GeneratePanel UI: 프롬프트 입력 → 진행 표시 → 결과 적용
- ⚠️ inpaint-controlnet-v1 워크플로 (SDXL inpaint + canny ControlNet) — Replicate 의존이라 deferred
- ✅ 결과 캐시 (IndexedDB)
- ✅ 에러 처리: retry, 후처리 alpha 강제 (timeout은 클라이언트 polling 120s)

Replicate / ControlNet을 제외한 모든 마일스톤 도달. V1 시나리오 A의 3~4단계 — "이 옷을 다른 옷으로 30초 안에 미리보기 갱신" — Gemini 또는 OpenAI 키만 있으면 시연 가능.

## 다음

- 사용자 검증 후 결정
- 후보: Phase 4 (Variant System & Export), 또는 phase 3 polish (cancel, OpenAI aspect-aware padding, history delete UI)
