# 2026-05-13 — fal.ai FLUX.1 [pro] Fill 모델 추가 (사용자 자산 활용)

**Phase / 작업**: PR #25-26 follow-up (fact-find 기반 옵션 추가)
**상태**: done
**관련 계획**: [../plan/01-Phase1.md](../plan/01-Phase1.md)

## 사용자 입장

> "fal.ai 결제까지 했는데 무슨 소리니"
> "최고의 퀄리티가 목표인거야. 그런 것에 휘둘리지 말고 제대로 조사
> 해서 무엇이 더 좋은 방법인지 완벽하게 지원해야만 해."

비용은 sunk cost, quality 우선. 그러나 사용자 fal.ai 자산이 있고
fal.ai 안에 더 나은 모델이 있다면 그쪽이 ROI 좋음.

## Fact-find 결과

### OpenAI gpt-image-2 mask (PR #26 path)

- **Spec 지원** 확정: PNG with alpha channel, `alpha=0 = edit zone`.
  Web search 결과 [aimlapi docs](https://docs.aimlapi.com/api-references/image-models/openai/gpt-image-1)
  + [WaveSpeed guide](https://wavespeed.ai/blog/posts/gpt-image-2-api-guide/) 일치.
- **Caveat**: 모델이 mask를 "loose guidance"로 사용 — community 보고
  [thread](https://community.openai.com/t/image-editing-inpainting-with-a-mask-for-gpt-image-1-replaces-the-entire-image/1244275)
  에서 "mask 영역 외 전체 image 교체" 케이스. [vercel/ai issue #14360](https://github.com/vercel/ai/issues/14360)
  도 mask 무시 보고.
- 결론: spec 지원이지만 region-bounded edit 보장 못 함. 사용 가치
  검증 필요.

### fal.ai inpaint 카탈로그 조사

| 모델 | 평가 |
|---|---|
| **[fal-ai/flux-pro/v1/fill](https://fal.ai/models/fal-ai/flux-pro/v1/fill)** | FLUX 계열 **최상위** mask-aware inpaint. pro tier (dev base인 flux-general/inpainting보다 위). atlas crop quality 가능성 높음. |
| fal-ai/flux-general/inpainting (현재) | FLUX.1 [dev] base. atlas crop을 character thumbnail로 해석. quality 낮음. |
| fal-ai/sdxl-controlnet-union/inpainting | SDXL + ControlNet. anime LoRA 친화. character prior가 FLUX와 다를 수도. |
| fal-ai/fooocus/inpaint | anime 스타일 지원. mask + prompt. |

→ **FLUX.1 [pro] Fill이 첫 후보**. FLUX 최상위 + mask 명시 지원 + 사용자
자산. atlas crop quality는 검증 필요지만 [dev]보다 높을 가능성.

## 변경

[lib/ai/providers/falai.ts](../../lib/ai/providers/falai.ts):

### 새 모델 ID 등록

```ts
const FLUX_PRO_FILL_PATH = "fal-ai/flux-pro/v1/fill";
const FLUX_PRO_FILL_ID = "flux-pro-fill";

const MODELS = [
  {
    id: FLUX_PRO_FILL_ID,
    displayName: "FLUX.1 [pro] Fill (mask-aware, recommended)",
    description: "Top-tier mask-aware inpainting on FLUX.1 [pro]. ...",
  },
  { id: FLUX_INPAINTING_ID, displayName: "FLUX.1 [dev] inpainting (cheap fallback)", ... },
  { id: FLUX_2_EDIT_ID, displayName: "FLUX.2 [edit]", ... },
];
```

기존 두 모델 유지 + 새 [pro] Fill을 default + 첫 옵션. picker dropdown
에 자동 노출.

### `defaultModelId` 변경

```ts
defaultModelId: FLUX_PRO_FILL_ID,  // was: FLUX_2_EDIT_ID
```

provider 선택 시 자동으로 [pro] Fill로. 사용자가 quality 최우선이면
변경 없이 generate.

### `buildSubmitBody` 분기

```ts
if (modelId === FLUX_PRO_FILL_ID) {
  const body = {
    prompt: composedPrompt,
    image_url: dataUri,
    mask_url: maskDataUri,
    safety_tolerance: 5,  // anime texture 안전기준 완화
    output_format: "png",
  };
  return { modelPath: FLUX_PRO_FILL_PATH, body };
}
```

FLUX.1 [pro] Fill API spec:
- 입력: `image_url`, `mask_url`, `prompt`
- mask convention: 표준 diffusion (white = inpaint, black = preserve)
  → 우리 inpaint convention (RGB white = edit) 그대로 호환.
- optional: `safety_tolerance` (1-6, anime texture에 5 권장).

### `composeInpaintingPrompt` 공유

[dev] inpainting과 [pro] Fill이 같은 prompt scaffold 사용 — character
hallucination 차단 4-layer (PR #25).

### GeneratePanel onSubmit

```ts
const isInpaintingModel =
  providerId === "falai" &&
  (modelId === "flux-inpainting" || modelId === "flux-pro-fill");
```

두 inpaint 모델 모두 같은 source bake (transparent → neutral grey) +
mask 흐름.

## 검증

- `pnpm typecheck` ✓
- `pnpm exec biome check` ✓
- 실호출 검증: 사용자가 dev 재시작 후
  1. GeneratePanel → [MASK] 탭 → brush로 mask paint → save → GEN.
  2. **provider "fal.ai FLUX" + 모델 자동으로 "FLUX.1 [pro] Fill"** 선택됨 (default).
  3. "white hair" → generate.
  4. 콘솔 `[falai] POST .../fal-ai/flux-pro/v1/fill ...` + `[generate]
     inpaint mask: user-painted in MASK tab (...)`.
  5. 결과 quality 평가.

## 결정

1. **flux-pro-fill을 default로**. 사용자 quality 최우선 의지 반영.
2. **기존 모델 옵션 유지**: flux-inpainting (cheap fallback), flux-
   2-edit (instruction-only). 사용자가 비용/속도 우선 시 선택 가능.
3. **safety_tolerance 5**. anime texture가 photoreal-trained safety
   에 잘못 잡히지 않게 (2 = default 너무 엄격). 6은 모든 safety off
   라 5가 적정.
4. **OpenAI inpaint path (PR #26) 유지**. fal-pro-fill이 안 되면 OpenAI
   비교 가능.

## 영향

- inpaint quality 회복 기대 (검증 필요).
- 사용자 fal.ai 자산 활용 (OpenAI로 강제 이동 안 함).
- 기존 흐름 회귀 없음 (다른 모델 옵션 그대로).

## 후속 (백로그)

- flux-pro-fill 결과 quality 측정 후 default 확정.
- 만약 character hallucination 잔존:
  - source bake 강화 (1024² padding + 더 큰 frame).
  - SDXL ControlNet Union inpainting 추가 (alternative architecture).
  - OpenAI inpaint와 A/B.

## 참조

- 손댄 파일 2개:
  - `lib/ai/providers/falai.ts` — flux-pro-fill 모델 등록 + buildSubmitBody
    분기.
  - `components/GeneratePanel.tsx` — isInpaintingModel에 새 model id
    포함.
- PR: 이 entry가 포함된 PR이 머지될 때 main에 들어감.
