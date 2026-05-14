# 2026-05-13 hotfix — inpaint source를 oversized grey frame에 작은 patch로 배치

**Phase / 작업**: 사용자 보고 (FLUX.1 [pro] Fill도 character hallucination)
**상태**: done
**관련 계획**: [../plan/01-Phase1.md](../plan/01-Phase1.md)

## 사용자 보고

> "여전히 제대로 되지 않아. FLUX를 사용해도 제대로 안 되는데"

PR #27의 FLUX.1 [pro] Fill 결과에도 silhouette 안에 character (얼굴 /
입 / 어깨) 들어옴. PR #25의 `bakeTransparencyToNeutral` (neutral grey
BG) 도 효과 없음.

## 깊은 진단

기존 `bakeTransparencyToNeutral` 동작:
- source dim 유지 → silhouette이 frame 전체를 차지.
- 외부 transparent → neutral grey.

문제: silhouette이 frame edge-to-edge로 가득 차면 model은 여전히
"이 frame 자체가 character의 outline" 으로 학습한 prior가 강하게
작동. grey BG는 frame 안에 없어서 효과 없음.

해결 가설: **silhouette을 frame의 작은 patch**로 만들기. 3× source
dim 의 grey square에 silhouette을 center에 그대로 두면, model 입장
에서 "이건 큰 image의 작은 clipped texture region" 으로 reframe.
character outline prior 약해짐.

## 변경

### `lib/avatar/inpaintSourcePrep.ts`

`bakeTransparencyToNeutral` 시그너처 변경:

```ts
export async function bakeTransparencyToNeutral(
  sourceCanvas: HTMLCanvasElement,
  options: { scale?: number; minSize?: number } = {},
): Promise<{ blob: Blob; padding: OversizedFramePadding }>
```

- `scale=3` default — silhouette이 frame의 ~1/3 차지.
- `minSize=512` default — 최소 dim 보장 (작은 layer 보호).
- 반환 `padding` 으로 mask 정렬 + postprocess crop 정보 모두 전달.

신설 `padInpaintMaskToFrame(maskBlob, padding)` — mask blob을 같은
oversized frame에 `paddingOffset` 위치로 배치. 외부 영역 RGB black
(preserve) 으로 채움.

### `components/GeneratePanel.tsx` onSubmit (isInpaintingModel)

```ts
const baked = await bakeTransparencyToNeutral(sourceCanvas, { scale: 3 });
geminiSourceBlob = baked.blob;
openaiInpaintPadding = baked.padding;
// ... mask
geminiMaskBlob = await padInpaintMaskToFrame(rawMask, baked.padding);
```

`openaiInpaintPadding` 은 이미 postprocess에 전달되어 결과를 atlas
crop dim으로 복원. fal inpaint 흐름과 OpenAI 흐름이 같은 padding
metadata 공유.

## 검증

- `pnpm typecheck` ✓
- `pnpm exec biome check` ✓
- 실호출 검증:
  1. dev 재시작 → MASK 탭 paint → save → GEN.
  2. provider "fal.ai FLUX" + 모델 "FLUX.1 [pro] Fill".
  3. "blue ocean hair" → generate.
  4. 콘솔: `[generate] inpaint source: padded SxS into 3S x 3S grey
     frame (silhouette at offset=...). Forces the inpainter to read
     the silhouette as a patch, not a character outline.`
  5. 결과 평가 — silhouette 안에 character 들어왔는지.

## 결정

1. **scale=3**. 2는 silhouette이 frame 절반 이상 차지하여 효과 약함.
   4 이상은 너무 작은 silhouette 자체가 detail 손실. 3이 균형.
2. **minSize=512**. 작은 atlas layer (예: 100×100) 도 최소 512² 까지
   확장 — inpaint endpoint 들이 작은 dim에 reject 가능.
3. **fal-pro-fill + fal-dev-inpainting 둘 다 적용**. 두 모델 모두 같은
   FLUX architecture 기반이라 같은 character prior. 공통 fix.
4. **OpenAI inpaint path (PR #26)도 같은 patch 흐름**. 사용자가 OpenAI
   시도 시 동일 oversized frame 적용 (openaiInpaintPadding 공유).
   다만 OpenAI는 max 4096px / 16의 배수 제한이 있어 frame size cap
   필요할 수도 — 이번 PR에선 OpenAI path는 기존 `prepareOpenAISource`
   사용 그대로. 별도 PR로 통합 검토.

## 영향

- fal inpaint (pro / dev) 호출 시 character hallucination 차단 기대.
- Result는 oversized frame으로 받지만 postprocess에서 atlas crop dim
  으로 정확히 매핑 — 사용자 입장에선 변화 없음.
- 비용 약간 증가: source / mask 크기 9× (3×3). fal는 megapixel 기반
  과금이라 cost 증가 ~9×. 다만 character hallucination 막는 가치가
  더 큼.

## 후속 (잔존 시)

- scale 4 또는 5 시도.
- silhouette을 frame의 한쪽 모서리로 (center 대신) — model이 "image
  의 일부" 신호 더 강하게 받을 수도.
- SDXL ControlNet 또는 Fooocus inpaint 대안 시도.

## 참조

- 손댄 파일 2개:
  - `lib/avatar/inpaintSourcePrep.ts` — bakeTransparencyToNeutral
    시그너처 변경 + padInpaintMaskToFrame 신설 + OversizedFramePadding
    타입.
  - `components/GeneratePanel.tsx` — isInpaintingModel 분기 + import
    + openaiInpaintPadding 공유.
- PR: 이 entry가 포함된 PR이 머지될 때 main에 들어감.
