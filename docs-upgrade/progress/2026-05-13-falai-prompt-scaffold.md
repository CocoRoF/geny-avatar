# 2026-05-13 hotfix — FLUX provider prompt scaffold (외곽 잔존 해결 시도)

**Phase / 작업**: Phase 1 작업 4 follow-up
**상태**: done (fix 적용, 사용자 재검증 필요)
**관련 계획**: [../plan/01-Phase1.md](../plan/01-Phase1.md) 작업 4 + 6

## 문제

[PR #10](https://github.com/CocoRoF/geny-avatar/pull/10) 머지 후
사용자가 fal.ai FLUX.2로 머리 흰색 변경 시도. 호출은 정상 (10.9 s)
결과 image도 도착. 다만 **silhouette 외곽 1-3 px 띠가 원본 갈색 그대로
남음**. 안쪽은 정상적으로 흰색, 외곽선만 갈색 잔존 — anime hair의
outline 영역만 안 바뀐 형태.

## 원인 분석

기존 FLUX provider 코드:

```ts
const promptText = (input.refinedPrompt ?? input.prompt).trim();
```

raw user prompt (`"white hair"`)를 그대로 fal.ai에 보냄. flux-2/edit은
instruction-following 모델이라 짧은 prompt를 *aggressive* 하게 해석:

1. "white hair"를 "머리 내부를 흰색으로 칠해라"로 좁게 해석 → outline
   픽셀은 boundary 보존을 위해 그대로 유지.
2. `image_urls[1]` (Phase 1.2의 canonical-pose snapshot)을 style
   anchor로 인식하여 character의 다른 색을 일부 transfer.

OpenAI provider는 PR #4에서 composePrompt scaffold (slot map + edge
preservation + style negation) 적용했지만, FLUX provider엔 같은
scaffold 없었음.

## 변경

[lib/ai/providers/falai.ts](../../lib/ai/providers/falai.ts) —
`composePrompt(input)` 메서드 추가. 사용자 intent 외에 다음을 함께
보냄:

1. **Slot map** — `[image 1] is one drawable of a multi-part Live2D-
   style 2D rigged puppet`.
2. **Reference 역할 명시** — `Subsequent images are spatial context
   only ... DO NOT transfer their colours or style onto [image 1]`.
   character-ref가 color anchor로 오해되는 것 방지.
3. **Edge-to-edge 지시** — `Apply the edit edge to edge: replace the
   ENTIRE [image 1] silhouette including its outline pixels`.
   silhouette boundary 영역까지 새 색이 들어가게 함.
4. **Style negation** — `Style: anime / illustration ... NOT photoreal`.
   OpenAI prompt와 동일.

사용자 prompt는 마지막에 (모델이 buried instruction이 아니라 primary
intent로 받도록).

진단을 위해 콘솔 로그에 `composed prompt:` 항목 추가.

## 검증

- `pnpm typecheck` ✓
- `pnpm exec biome check lib/ai/providers/falai.ts` ✓
- 실호출 재검증: 사용자가 dev 재시작 후 같은 puppet에서 "white hair"
  prompt로 fal.ai FLUX.2 호출 → 결과 image의 외곽 갈색 띠 사라졌는지
  + 콘솔 `composed prompt: ...` 출력 확인.

## 결정

1. **scaffold가 instruction을 압도하지 않게 user intent를 끝에**.
   FLUX 류는 prompt의 마지막 부분을 더 강하게 인지 (반대로 OpenAI는
   첫 줄). 그래서 OpenAI prompt와 다른 순서.
2. **edge-to-edge 지시는 항상 적용**. 사용자 intent가 "조금만 바꿔
   라"인 케이스에서도 outline 영역까지 바꾸도록. 의도와 맞지 않으면
   사용자가 prompt에서 명시 (예: "preserve outline").
3. **enable_safety_checker는 false 유지**. anime edit이 가짜 NSFW로
   잡히지 않게.

## 영향

- FLUX 호출의 외곽 잔존 issue 완화 기대. 완전 해소 안 되면 erode
  강화 (현재 `shortSide / 100, clamp [2, 8]`) 추가 PR.
- OpenAI / Gemini 흐름은 변화 없음.
- composed prompt가 raw user prompt보다 ~5x 길어짐. FLUX 입력 token
  비용 미미한 증가.

## Phase 1 closure 영향

[2026-05-12-phase1-closure.md](2026-05-12-phase1-closure.md) Criterion
3의 사후 quality 평가 부분 갱신 — 이 hotfix 결과로 재측정.

## 다음 단계

사용자 재테스트 후:

- 외곽 잔존 해소 → Criterion 3 quality도 통과.
- 여전히 잔존 → erode radius 강화 (`min=4, divisor=60` 같은 보강) 또는
  source의 alpha 채널을 inward shift한 변종 source를 FLUX에 보냄.

## 참조

- 손댄 파일 1개: `lib/ai/providers/falai.ts`.
- PR: 이 entry가 포함된 PR이 머지될 때 main에 들어감.
