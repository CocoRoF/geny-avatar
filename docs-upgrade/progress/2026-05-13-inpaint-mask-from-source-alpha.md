# 2026-05-13 Phase 1.x — inpaint mask는 source alpha에서 자동 derive

**Phase / 작업**: Phase 1.x (PR #15 follow-up)
**상태**: done (auto-derive 흐름 적용, 사용자 재검증)
**관련 계획**: [../plan/01-Phase1.md](../plan/01-Phase1.md) +
[2026-05-13-falai-inpainting-model.md](2026-05-13-falai-inpainting-model.md)

## 사용자 지적

> "Edit에서 사용하는 MASK 기능 (특정 부분을 지워버리는 효과)이랑
> Gen에서 사용하는 Mask 기능 (특정 부분만 선택하여 편집 유도)이
> 완전히 다른건데 ... 그리고 기본적으로 이게 Texture의 특정 component
> 단위이다보니까 그냥 전체가 MASK된 것으로 판단하고 넣어도 될 것 같은데"

핵심 두 가지:

1. **두 mask 의미가 정반대**:
   - DecomposeStudio mask: `alpha=255` = "이 픽셀 **숨겨라**" (destination-out).
   - Inpaint mask: `alpha=255` (또는 RGB white) = "이 픽셀 **다시 그려라**".
   - PR #15가 DecomposeStudio mask를 그대로 inpaint에 forward → 의도와
     반대로 동작.

2. **기본은 "전체 컴포넌트 = edit zone"**:
   - Live2D 텍스처 레이어는 이미 하나의 component (atlas drawable).
   - 사용자가 GeneratePanel 열었다 = "이 레이어 편집하고 싶음".
   - 추가 mask 없이 source의 alpha 자체가 자연스러운 mask.

## 변경

### 신설 [lib/avatar/inpaintMask.ts](../../lib/avatar/inpaintMask.ts)

`buildInpaintMaskFromAlpha(sourceCanvas)` — source 알파를 binary
white-on-black PNG로 변환:
- alpha ≥ 1 → RGB white (255,255,255), alpha 255 (opaque).
- alpha < 1 → RGB black (0,0,0), alpha 255.
- 출력 alpha는 항상 255 — provider가 alpha vs RGB luma 어느 쪽을
  봐도 동일한 mask로 해석.

### 수정 [components/GeneratePanel.tsx](../../components/GeneratePanel.tsx)

`onSubmit`의 mask 결정 로직:

```ts
const isInpaintingModel = providerId === "falai" && modelId === "flux-inpainting";
if (!useMultiComponent) {
  geminiSourceBlob = await canvasToPngBlob(sourceCanvas);
  if (isInpaintingModel) {
    geminiMaskBlob = await buildInpaintMaskFromAlpha(sourceCanvas);
    console.info(`[generate] inpaint mask: derived from source alpha ...`);
  } else {
    geminiMaskBlob = existingMask ?? undefined;
  }
}
```

흐름:
- inpainting 모델 (현재 falai/flux-inpainting) → mask 자동 derive.
  DecomposeStudio mask **무시** (의미 충돌).
- 다른 provider/model → 기존 동작 그대로 (Gemini는 raw DecomposeStudio
  mask 사용).

### 수정 [lib/ai/providers/falai.ts](../../lib/ai/providers/falai.ts)

mask 미제출 에러 메시지를 "client가 normally derive함" 로 갱신. 사용자가
DecomposeStudio에서 mask 그릴 필요 없음.

## 검증

- `pnpm typecheck` ✓
- `pnpm exec biome check` ✓
- 실호출 검증: 사용자가 dev 재시작 후
  1. GeneratePanel → provider "fal.ai FLUX" → model "FLUX.1 inpainting".
  2. **DecomposeStudio mask 그릴 필요 없음**.
  3. prompt "white hair" → generate.
  4. 콘솔에 `[generate] inpaint mask: derived from source alpha (NNNB)` 로깅.
  5. 결과 quality — silhouette 안 머리만 white로, character feature
     hallucination 없이.

## 결정

1. **DecomposeStudio mask는 inpaint에 forward 안 함**. 의미가 반대.
   사용자가 hide 의도로 그린 mask가 edit zone으로 해석되는 surprise
   봉쇄.
2. **자동 derive가 default**. "Generate 누른 시점 = 이 컴포넌트 편집
   원함". 별 입력 없이 자연스럽게 동작.
3. **GeneratePanel 자체에 mask brush UI는 별도 PR**. 사용자가 컴포넌트
   "일부만" 편집하고 싶을 때 (예: 머리 앞부분만), GeneratePanel
   내부에 별도 mask brush surface 필요. 이번 PR 범위 외, 후속 PR.
4. **mask convention**: alpha=255 = edit (inpaint 표준). server-side
   변환 없이 client에서 production-ready binary mask 생성.
5. **provider/model 둘 다 매치 확인**. `providerId === "falai" &&
   modelId === "flux-inpainting"` 으로 정확히 좁힘. 향후 다른
   inpainting model이 추가되면 이 조건도 확장.

## 영향

- Inpainting 모델 사용 흐름이 self-contained — DecomposeStudio 사전
  작업 불요.
- DecomposeStudio mask는 Decompose 본연의 destination-out 용도로 그대로.
- flux-2/edit / OpenAI / Gemini 흐름 변화 없음.

## 다음 후속 (백로그)

- **GeneratePanel 내부 mask brush UI**. 컴포넌트 일부만 편집 원할 때.
  현재는 "전체 컴포넌트 = edit" 이지만, 머리 앞부분만 흰색 같은 케이스를
  위해 brush surface 추가 시 inpaint 정밀도 향상. Phase 3 orchestrator
  본격 작업 시 함께.
- **mask convention 검증**. fal-general/inpainting이 alpha vs RGB luma
  어느 쪽을 보는지 첫 호출 결과로 확인. RGB white 보는 게 표준이지만
  우리 mask는 alpha=255도 동시에 채워 양쪽 호환.

## 참조

- 손댄 파일 3개:
  - `lib/avatar/inpaintMask.ts` (신설)
  - `components/GeneratePanel.tsx` (import + onSubmit mask 분기)
  - `lib/ai/providers/falai.ts` (에러 메시지 갱신)
- PR: 이 entry가 포함된 PR이 머지될 때 main에 들어감.
