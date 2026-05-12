# 2026-05-13 hotfix — FLUX prompt에서 character feature 출현 차단

**Phase / 작업**: Phase 1 작업 4 follow-up (3rd FLUX iteration)
**상태**: done (fix 적용, 사용자 재검증 필요)
**관련 계획**: [../plan/01-Phase1.md](../plan/01-Phase1.md) 작업 4

## 문제

[PR #12](https://github.com/CocoRoF/geny-avatar/pull/12)로 canonical-pose
ref를 FLUX 호출에서 제외했지만, `image_urls`에 source 한 장만 보내도
**FLUX이 silhouette 안쪽에 character 얼굴(눈/코/입)을 그려넣는다**.
머리 atlas crop을 character thumbnail로 오해해서 silhouette 안에
character feature를 hallucinate함.

## 원인

flux-2/edit은 isolated atlas crop을 받았을 때 "이 부분만 편집"이
아니라 "이걸 character thumbnail로 완성" 으로 해석하는 강한 prior가
있다. 단일 image, transparent background, 작은 silhouette을 보면
"이 silhouette 안에 character를 그려라" 로 동작.

prompt에 명시한 "isolated drawable" "spatial context only" 등도 약함.
가장 직접적인 instruction이 필요.

## 변경

[lib/ai/providers/falai.ts](../../lib/ai/providers/falai.ts) composePrompt
강화:

1. **Input naming 변경**: "[image 1] is an ISOLATED ATLAS TEXTURE REGION
   (e.g. hair only, jacket only) ... It is NOT a portrait or character
   thumbnail."
2. **Character feature 금지 명시**: "DO NOT add face, eyes, mouth, body,
   hands, accessories, or any character feature that is not already
   present in [image 1]." — 가장 강력한 negative.
3. **Reference role**: hasRefs 케이스에서 "DO NOT transfer their
   composition or non-target regions" 로 문구 강화.
4. **Style negation 강화**: "Output stays an isolated texture region
   with transparent background — no scene, no character body filled
   in."

3가지 layer의 negative ("not portrait", "no character features", "no
scene") 가 동시에 적용. FLUX이 한두 개 무시해도 다른 게 잡기를
기대.

## 검증

- `pnpm typecheck` ✓
- `pnpm exec biome check lib/ai/providers/falai.ts` ✓
- 실호출 재검증: 사용자가 dev 재시작 후 fal.ai FLUX.2 "white hair" →
  silhouette 안에 face 없이 깨끗한 머리 텍스처만 출력되는지.

## 결정

1. **prompt 강화만으로 시도**. 다른 길:
   - source의 transparent 영역을 회색/검정으로 padding → FLUX이 "이 부분은 안 바뀐다"고 인지.
   - prepareOpenAISource로 1024² padded square 만들어 FLUX에 보냄.
   - fal.ai의 다른 모델 (FLUX-ControlNet-Inpainting 같은 mask-aware)로 교체.

   prompt 강화가 가장 단순. 효과 없으면 source padding 후속 PR.
2. **3-layer negative** ("not thumbnail" + "no features" + "no scene").
   FLUX이 negative instruction을 강하게 따르는 경향. 셋 다 명시하면
   확률 높음.
3. **사용자 intent 유지**. user prompt가 "white hair" 같이 짧아도
   character 그리지 말고 hair pixel만 modify하도록 priority 명확.

## 영향

- 모든 FLUX 호출의 prompt 길이 +~500자. token cost 미미.
- 다른 provider (OpenAI / Gemini) 영향 없음.

## Phase 1 closure 영향

이 fix가 통과하면 Criterion 3 quality도 통과. 그 다음 외곽 잔존
세부 quality는 별도 fine-tune.

여전히 실패하면 FLUX-2 edit이 atlas crop use case에 fit이 안 좋다는
결론을 받아들이고:
- Phase 1.4의 가치를 "FLUX provider 등록 + Phase 3 orchestrator의
  bulk fan-out 시 활용"으로 한정.
- 단일 layer 편집에선 OpenAI 권장으로 안내.
- 또는 fal.ai의 다른 모델 (FLUX-ControlNet-Inpainting 등) 검토.

## 참조

- 손댄 파일 1개: `lib/ai/providers/falai.ts`.
- PR: 이 entry가 포함된 PR이 머지될 때 main에 들어감.
