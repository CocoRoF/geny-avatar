# 2026-05-13 hotfix — postprocess hard mask blend (model 무시 시 마지막 안전망)

**Phase / 작업**: PR #30 follow-up (사용자 분노 + mask 강제)
**상태**: done
**관련 계획**: [../plan/01-Phase1.md](../plan/01-Phase1.md)

## 사용자 보고

> "마스크를 분명 절반 영역만 줬고 masked area만 수정하라고 했는데
> 전체가 다 바뀌어버리는 심각한 문제가 있어."

PR #30의 OpenAI + mask reference (image[]) + 강한 prompt scaffold에도
gpt-image-2가 전체 silhouette redraw. [community 보고](https://community.openai.com/t/image-editing-inpainting-with-a-mask-for-gpt-image-1-replaces-the-entire-image/1244275)
의 "mask 무시" 케이스와 일치.

## 결론

**model side mask 인식은 100% 신뢰 못 함**. fal inpaint는 hard mask
를 character outline으로 잘못 해석 (PR #15-28), OpenAI는 soft hint를
무시. architecture로는 사용자 의도 강제 불가능.

→ **client-side hard mask 강제**. AI 결과를 받은 후 mask 영역만
적용. 모델 동작 무관하게 사용자 의도 보장.

## 변경

### `lib/ai/client.ts` `postprocessGeneratedBlob` 새 인자

```ts
export async function postprocessGeneratedBlob(opts: {
  blob: Blob;
  sourceCanvas: HTMLCanvasElement;
  openAIPadding?: {...};
  /** NEW: hard mask blend after alpha enforcement. */
  inpaintMaskBlob?: Blob;
}): Promise<Blob>
```

새 Step 3 (alpha enforce 다음):

```ts
if (opts.inpaintMaskBlob) {
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = targetW; maskCanvas.height = targetH;
  const maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true });
  // Resample mask to source dims, then iterate per-pixel:
  // - mask luma >= 128 (white) → keep AI result
  // - mask luma < 128 (black)  → revert to source pixel
}
```

mask convention: RGB white = edit, RGB black = preserve. 우리가
이미 inpaint convention으로 출력 중. resampling으로 source dim에
align.

### `components/GeneratePanel.tsx`

OpenAI mask path의 postprocess 호출에 `inpaintMaskBlob` 전달:

```ts
processed = await postprocessGeneratedBlob({
  blob: rawResult,
  sourceCanvas,
  openAIPadding: openaiInpaintPadding ?? undefined,
  // Hard mask enforcement after the AI run
  inpaintMaskBlob: isOpenAIMaskRef ? inpaintMaskBlob ?? undefined : undefined,
});
```

multi-component path 호출 (runRegionGen) 은 mask 없는 흐름이라 영향
없음.

## 검증

- `pnpm typecheck` ✓
- `pnpm exec biome check` ✓
- 실호출 검증:
  1. dev 재시작 → MASK 탭 머리 절반만 paint → save → GEN.
  2. OpenAI → "change masked area to blue ocean color" → generate.
  3. 콘솔:
     ```
     [postprocess] mask blend: N/M px = AI result, K/M px = preserved source.
     ```
  4. 결과: **mask 그린 절반만 파랑**, 나머지 절반은 원본 갈색 그대로.

## 결정

1. **Client-side hard blend**. model side mask는 신뢰 안 함. user
   intent 100% 보장.
2. **mask는 source dim에 resample**. mask가 padded dim이든 atlas
   dim이든 drawImage 자동 scale.
3. **luma 기반 (RGB 평균)**. RGB white-on-black + alpha 255 convention
   이라 alpha 안 봐도 OK.
4. **threshold 128 (binary)**. soft blend (alpha-weighted) 도 가능
   하지만 mask 경계의 anti-alias를 살리고 싶으면 후속 PR에서 옵션
   추가. 현재는 hard binary가 사용자 의도와 일치.

## 영향

- OpenAI + mask 흐름에서 mask 영역만 변경, 나머지 보존.
- multi-component path / fal / Gemini 흐름 회귀 없음 (inpaintMaskBlob
  안 보냄).
- 만약 사용자 mask가 silhouette 외부에도 있어도 source alpha clip
  (Step 2)이 먼저 처리. mask blend는 silhouette 안의 region만 의미.

## 후속

- soft blend 옵션 (mask 경계 anti-alias 살림).
- multi-component path도 mask 동봉 가능하게 (사용자가 영역 제한 +
  multi-component 둘 다 원할 때).

## 참조

- 손댄 파일 2개:
  - `lib/ai/client.ts` — postprocessGeneratedBlob 인자 + Step 3 추가.
  - `components/GeneratePanel.tsx` — postprocess 호출에 mask 전달.
- PR: 이 entry가 포함된 PR이 머지될 때 main에 들어감.
