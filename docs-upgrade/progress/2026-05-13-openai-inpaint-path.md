# 2026-05-13 hotfix — OpenAI gpt-image-2 inpaint path 신설

**Phase / 작업**: 사용자 보고 3번 (character hallucination) 진정한 해결
**상태**: done
**관련 계획**: [../plan/01-Phase1.md](../plan/01-Phase1.md)

## 진단

PR #25에서 source padding (neutral grey) + prompt scaffold 강화로
fal-general/inpainting을 시도했지만 여전히 character hallucination.

근본 결론: **fal-general/inpainting (FLUX.1 [dev] base) 자체가 atlas
crop use case에 부적합**. silhouette을 "character outline" 으로
해석하는 강한 prior가 prompt / source padding 으로도 막히지 않음.

진정한 답: **OpenAI gpt-image-2** 로 inpaint 전환. 이 모델은
Phase 1.1 ~ 1.4 검증에서 atlas crop을 정상 처리 — character 그리지
않고 영역 내용만 redraw. mask 채널만 동봉 (이미 OpenAI provider가
지원).

## 변경

### `lib/avatar/inpaintMask.ts` — 새 헬퍼

```ts
export async function convertInpaintMaskToOpenAIPadded(
  inpaintMaskBlob: Blob,
  paddingOffset: { x; y; w; h },
  canvasSize: number,
): Promise<Blob>
```

두 변환을 한 번에:
1. **Convention 반전**: 우리 inpaint mask (RGB white = edit) →
   gpt-image-2 (alpha=0 = edit, alpha=255 = preserve).
2. **Padded 정렬**: 1024² square 안에 silhouette 영역을 `paddingOffset`
   위치에 배치. silhouette 외부 (white border)는 alpha=255 (preserve)
   로 채워서 모델이 border를 안 건드림.

OpenAI는 image와 mask의 dim이 정확히 일치해야 함 — `prepareOpenAISource`
가 만드는 padded square와 같은 dim의 mask 필요.

### `components/GeneratePanel.tsx` onSubmit 분기

```ts
const isOpenAIInpaint = providerId === "openai" && !!inpaintMaskBlob;
const useMultiComponent = providerId === "openai" && !isOpenAIInpaint;
```

자동 분기:
- OpenAI 선택 + MASK 그렸음 → **OpenAI inpaint path** (single-source
  + mask).
- OpenAI 선택 + MASK 없음 → 기존 multi-component (atlas split per
  silhouette island).
- fal.ai + flux-inpainting → 기존 fal path (atlas-crop quality 낮지만
  cheap bulk 용).
- 기타 (Gemini 등) → 기존.

OpenAI inpaint 흐름:
```ts
const prep = prepareOpenAISource(sourceCanvas);
openaiInpaintPadding = { paddingOffset, sourceBBox, canvasSize };
geminiSourceBlob = await canvasToPngBlob(prep.padded);
geminiMaskBlob = await convertInpaintMaskToOpenAIPadded(
  inpaintMaskBlob,
  prep.paddingOffset,
  prep.padded.width,
);
```

submit + postprocess:
```ts
const rawResult = await submitGenerate({
  providerId,                       // "openai"
  sourceImage: geminiSourceBlob,    // padded
  maskImage: geminiMaskBlob,        // padded + alpha-inverted
  // ...
});
processed = await postprocessGeneratedBlob({
  blob: rawResult,
  sourceCanvas,
  openAIPadding: openaiInpaintPadding ?? undefined,  // crop back to atlas
});
```

postprocess는 `prepareOpenAISource`가 만든 `paddingOffset` / `sourceBBox`
를 사용해 결과를 원래 atlas crop dim으로 정확히 매핑 — multi-component
path와 같은 메커니즘 재사용.

## 검증

- `pnpm typecheck` ✓
- `pnpm exec biome check` ✓
- 실호출 검증: 사용자가 dev 재시작 후
  1. GeneratePanel → [MASK] 탭 → brush로 일부 paint → save → GEN.
  2. **provider "Google Gemini" 대신 "OpenAI gpt-image-2" 선택**.
  3. "white hair" 또는 "blue hair" → generate.
  4. 콘솔 `[generate] openai inpaint: padded source=1024x1024,
     mask aligned at offset=..., mask convention inverted to
     gpt-image-2 (alpha=0 = edit).`
  5. 결과: silhouette 안에 character 없이 **머리만 색 변경**.

## 결정

1. **OpenAI provider config 변경 없음**. OpenAI provider는 이미
   `maskImage`를 받음. GeneratePanel onSubmit이 mask를 보낼지 결정만
   분기.
2. **Model picker UI 변경 없음**. "OpenAI gpt-image-2" 그대로 사용.
   사용자가 MASK 탭에서 mask 그렸으면 자동 inpaint mode, 안 그렸으면
   기존 multi-component.
3. **fal flux-inpainting 유지**. quality 낮지만 cheap bulk fan-out
   용도 (Phase 3 orchestrator). 사용자가 명시 선택 시 사용 가능.
4. **multi-component path 회귀 없음**. OpenAI + mask 없음 흐름은
   기존 그대로.

## 영향

- inpaint use case에서 OpenAI 사용 시 character hallucination 해소.
- mask 그린 후 OpenAI 선택만 하면 동작 — UI 변경 0.
- fal-inpainting / multi-component / Gemini 흐름 회귀 없음.
- 비용: fal-inpainting ($0.075/MP) → OpenAI gpt-image-2 (~$0.04
  standard). 비슷한 수준.

## 후속 (백로그)

- **inpaint 흐름의 model picker default를 OpenAI로**. 사용자가 MASK
  탭에서 mask 그리면 자동으로 OpenAI 선택 안내 또는 강제.
- **fal-inpainting 한계 안내**: UI에 disclaimer.
- **mask 없이도 OpenAI single-source path 옵션**: 현재 OpenAI는 mask
  없으면 multi-component만. 단일 layer 편집을 OpenAI로 빠르게 하고
  싶을 때 옵션.

## 참조

- 손댄 파일 2개:
  - `lib/avatar/inpaintMask.ts` — `convertInpaintMaskToOpenAIPadded`
    헬퍼 신설.
  - `components/GeneratePanel.tsx` — `isOpenAIInpaint` 분기 + padded
    source / mask + postprocess openAIPadding 전달 + import.
- PR: 이 entry가 포함된 PR이 머지될 때 main에 들어감.
