# 2026-05-09 — Sprint G.9: Per-region refinement (focus mode 에서 dead 였음)

## 사용자 보고

> "지금 이렇게 한 개씩 하게 변경되면서 Refine 프롬프트 기능이 제대로 동작하지 않는 것으로 보임"

focus mode (region 1개씩 처리) 로 바뀌면서 Refine 토글이 더 이상 효과 없어보임.

## 근본 원인

[`75 sprint_g_focus_mode_redesign`](2026-05-09_75_sprint_g_focus_mode_redesign.md) 에서 multi-region focus 의 generate 버튼이 `regenerateOneRegion` 으로 dispatch 되도록 바꿨는데 — `regenerateOneRegion` 은 cached refinement 만 재사용할 뿐 **`refinePrompt` 호출 자체를 안 함**.

```ts
// G.8 까지의 코드:
const refinedReady = refinement?.rawAtRefine === prompt ? refinement.refined : undefined;
const baseText = refinedReady ?? prompt;
```

이 cache 는 `onSubmit` (generate-all 경로) 가 채우는데, focus mode 에서는 `onSubmit` 안 거치니까 cache 가 비어있음 → cache miss → unrefined raw prompt 가 그대로 모델로. 사용자 입장: refine 토글 ON 인데 결과는 OFF 동작.

## 수정

### `components/GeneratePanel.tsx` — `regenerateOneRegion`

```ts
const userPromptForRefine = perRegionText.length > 0 ? perRegionText : baseTrimmed;
let refinedText: string | undefined;
if (usePromptRefine && userPromptForRefine.length > 0) {
  if (refinement?.rawAtRefine === userPromptForRefine) {
    refinedText = refinement.refined;
  } else {
    setRefining(true);
    try {
      const preparedComp = prepared[idx];
      const refineSourceBlob = await canvasToPngBlob(preparedComp.isolatedSource);
      const result = await refinePrompt({
        userPrompt: userPromptForRefine,
        layerName: layer.name,
        hasMask: false,
        negativePrompt: negativePrompt.trim() || undefined,
        sourceImage: refineSourceBlob,
        referenceImages: activeRefBlobs,
      });
      refinedText = result.refinedPrompt;
      setRefinement({ refined: ..., rawAtRefine: userPromptForRefine, model: ... });
    } catch (e) {
      setRefineError(...);
      // fall back to raw
    } finally {
      setRefining(false);
    }
  }
}
const baseText = refinedText ?? userPromptForRefine;
```

핵심:
- per-region prompt (또는 panel-level common 둘 중 있는 거) 를 refine 호출의 입력
- LLM 의 source image = `prepared[idx].isolatedSource` (그 region 만 보이는 isolated canvas) → LLM 의 vision 분석이 region scoped
- references 는 그대로 `activeRefBlobs` (panel level)
- cache key = `userPromptForRefine` 자체. region 간 prompt 가 다르면 cache miss → 새 chat call. 같은 region 재호출 + 같은 prompt 면 cache hit
- refine 실패하면 raw prompt fallback (refine 은 quality booster 역할이지 hard dependency 아님)
- `setRefining(true)` 가 panel UI 의 spinner / generate 버튼 disable 트리거

deps: `usePromptRefine`, `layer.name`, `negativePrompt` 추가

## 의도적 한계

- **cache 가 1개**: 마지막 refine 결과 1개만 panel state 에 저장. 다른 region 진입 시 cache miss → 새 chat call. region 별 cache 는 향후 polish (Map<rawPrompt, refined>).
- **prompt double-mention**: composedPrompt = `${refined}\n\nFor [image 1] (region descriptor): ${perRegion}` — refined 안에 design 설명 + perRegion 에 raw 사용자 텍스트. 모델 입장 redundancy 가 있지만 명확함은 유지.
- **runRegionGen 시그니처 그대로**: `baseText` 가 refined or raw — 기존 합성 로직 유지. 향후 cleaner refactor 가능 (caller 가 final composed text 직접 빌드).
- **panel-level common 우선순위**: per-region textarea 가 비고 panel common 만 있으면 common 을 refine 입력. 둘 다 있으면 per-region 우선 (focus mode 에선 보통 per-region).

## 검증

- typecheck 통과
- biome 통과
- `next build` 통과

## 시각 검증 가이드

```bash
git pull && pnpm install && pnpm dev

# 1. 6 region 胸 layer → region 1 focus
# 2. PROMPT 에 한국어 입력 (예: "레퍼런스와 비슷한 스타일로 변경")
# 3. "Refine prompt via chat model before submit" 체크 ON 확인
# 4. generate this region click
# 5. dev 콘솔 [refine-prompt] 로그 — POST /api/ai/refine-prompt 호출 확인
#    - userPromptLen=한국어 입력 길이
#    - refCount=ref 수
#    - response 200 in N ms
#    - refined="LLM 이 영어로 재작성한 design-specific 텍스트..."
# 6. 그 다음 [openai] 로그의 composed prompt 에 refined 텍스트가 포함됨
# 7. region 2 진입 → 다른 prompt 입력 → ↻
#    - 새 refine call 또 발생 (region 별 cache miss)
# 8. 같은 region 1 다시 진입 → 같은 prompt 그대로 → ↻
#    - refine call 안 발생 (cache hit), 즉시 generate
```

## 남은 follow-up

- region-keyed refinement cache (Map<bbox-sig, { rawAtRefine, refined }>)
- per-region "refined preview" UI block (현재는 cache 가 single 이라 마지막 region 의 refined 만 panel 에 표시됨)
- refine 호출 cancel (user 가 도중에 다른 region 으로 이동 시)
