# 2026-05-13 — Option X: MASK를 reference image hint로 + multi-component path 복귀

**Phase / 작업**: 사용자 통찰 + Option X 진행
**상태**: done
**관련 계획**: [../plan/01-Phase1.md](../plan/01-Phase1.md)

## 사용자 통찰

> "MASK로 REGION을 완전 통제한다는 느낌이 아니라 그냥 추가적인 정보를
> 주는 것에 가깝다고 접근해야만 해. ... 마스크를 통해서 머리의 절반만
> 색 변경 이런 것도 정확하게 gpt-image2에게 정확하게 정보를 전달할
> 수 있어야 한다는 것이라고."

핵심 패러다임 시프트:
- **MASK ≠ hard inpaint boundary**. FLUX 인페인트 architecture가 그렇게
  해석해서 character 그려넣음.
- **MASK = soft information**: "이 부분을 편집해줘, 저 부분은 hint로
  보존" 의 추가 정보. 강제 region 아님.
- gpt-image-2의 multi-image edit pipeline + prompt 자연어로 mask 의도
  전달.

## 시도한 fal inpaint 모두 architecture 자체 한계로 실패

- PR #6, #11-13: flux-2/edit (no mask) — character hallucination.
- PR #15-16: flux-general/inpainting (FLUX.1 dev, mask) — character hallucination.
- PR #25: + neutral grey BG (dim 유지) — 효과 없음.
- PR #27: flux-pro/v1/fill (FLUX.1 pro) — character hallucination.
- PR #28: + 3× oversized frame — 여전히 character hallucination.

→ FLUX 계열 inpaint architecture가 hair/head silhouette에 character
drawing prior 강함. dim / padding / prompt scaffold로 막을 수 없음.

## Option X 진행

### 변경 — OpenAI provider가 mask reference image 동봉

`lib/ai/providers/interface.ts`:
```ts
export type ProviderGenerateInput = {
  // ...
  /** Optional binary mask the user painted in MASK tab — RGB white =
   *  "focus the edit here", RGB black = "leave this alone (hint)".
   *  NOT a hard inpaint mask — routed as image[] reference. */
  maskReferenceImage?: Blob;
};
```

`lib/ai/providers/openai.ts` generate() — `image[]` 순서 재정의:
```
[0] source (편집 대상; 기존 mask 파라미터 적용)
[1] mask reference (있을 때) — soft region hint
[2..] caller-supplied refs (style anchor, char snapshot 등)
```

composePrompt 새 섹션 (`hasMaskRef`일 때):
> "[image 2] is a binary edit-region HINT painted by the user — WHITE
> regions mark where the edit should land, BLACK regions are the user's
> hint to leave the original content alone. Treat this as soft
> guidance, not a strict boundary: keep [image 1]'s overall composition
> consistent, but bias the change toward the white pixels. The HINT
> exists at the same dimensions and alignment as [image 1]."

또 mask reference 존재 시 다른 ref들의 slot index를 [image 3+] 로
shift. 모든 reference label이 prompt에서 정확.

### server route 통과

`lib/ai/client.ts`:
- `SubmitGenerateInput.maskReferenceImage?: Blob` 추가.
- form data에 `"maskReferenceImage"` key로 추가.

`app/api/ai/generate/route.ts`:
- `form.get("maskReferenceImage")` 읽어서 provider input에 forward.

### GeneratePanel onSubmit 단순화

PR #26의 `isOpenAIInpaint` 분기 제거. OpenAI는 항상 multi-component
path. mask 있으면 `maskReferenceImage`로 동봉 (강제 region 아님).

```ts
// PR #26 이전 흐름으로 복귀
const useMultiComponent = providerId === "openai";

// runRegionGen에서 매 region 호출에 mask reference 동봉
await submitGenerate({
  // ...
  sourceImage: compSourceBlob,
  maskReferenceImage: inpaintMaskBlob ?? undefined,  // ← 신규
  referenceImages: refsBlobs.length > 0 ? refsBlobs : undefined,
});
```

`runRegionGen` deps에 `inpaintMaskBlob` 추가.

### fal inpaint 흐름 유지 (옵션으로)

`isInpaintingModel` 분기 그대로 — fal-pro-fill / flux-inpainting / flux-2-edit
선택 시 기존 (효과 없는) inpaint 흐름. 사용자가 명시 선택 시만.
default는 fal-pro-fill로 두지만 quality 낮음 — provider 선택을 OpenAI
로 바꾸기 권장.

### 미사용 코드 import 정리

`prepareOpenAISource`, `convertInpaintMaskToOpenAIPadded` import 제거
(PR #26 분기 폐기로 미사용).

## 검증

- `pnpm typecheck` ✓
- `pnpm exec biome check` ✓
- 실호출 검증: 사용자가 dev 재시작 후
  1. MASK 탭 → brush로 머리 일부 paint (예: 절반) → save → GEN.
  2. **provider "OpenAI gpt-image-2" 선택**.
  3. "change hair color to blue ocean style on the painted area" → generate.
  4. 콘솔 `[openai] POST .../v1/images/edits  image[]: 3 entries
     [0] source ... [1] mask-reference ... soft edit-region hint
     [2] reference ... ride-along anchor`.
  5. composed prompt에 "[image 2] is a binary edit-region HINT ..."
     포함.
  6. 결과: white painted 영역만 색 변경, black 영역은 원본.

## 결정

1. **fal-inpaint 옵션 유지 + disclaimer**. 사용자가 결제 자산 활용
   시도 가능. quality는 낮음 (description에 명시).
2. **multi-component path 그대로**. atlas crop 처리는 OpenAI multi-
   image edit pipeline이 이미 정상. 새 path 안 만듦.
3. **mask = soft hint** 정책 명시. 사용자 시각 + prompt 양쪽으로 전달.
4. **single-source path에는 maskReferenceImage 안 추가**. Gemini /
   fal inpaint는 자기 mask channel을 별도로 사용. multi-image hint는
   OpenAI 전용.

## 영향

- OpenAI 흐름: mask 있으면 image[]에 reference로 동봉 + prompt에서
  명시. quality는 multi-component path 자체의 검증된 quality 유지.
- 다른 provider 흐름: 변화 없음.
- 사용자 mental model: MASK 탭 = "AI에 추가 정보 전달", 강제 region X.

## 참조

- 손댄 파일 5개:
  - `lib/ai/providers/interface.ts` — `maskReferenceImage` field 추가.
  - `lib/ai/providers/openai.ts` — image[] 순서 + composePrompt mask
    hint 섹션 + 로그.
  - `lib/ai/client.ts` — SubmitGenerateInput에 field 추가 + form 통과.
  - `app/api/ai/generate/route.ts` — form 읽고 provider input에 forward.
  - `components/GeneratePanel.tsx` — isOpenAIInpaint 분기 제거,
    submitGenerate에 maskReferenceImage 전달, useCallback deps,
    unused import 정리.
- PR: 이 entry가 포함된 PR이 머지될 때 main에 들어감.
