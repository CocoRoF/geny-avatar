# 2026-05-12 Phase 1.6 — OpenAI prompt에 Cubism 컨텍스트 + style negation

**Phase / 작업**: Phase 1 작업 6 (OpenAI prompt를 Cubism 어휘로 정비)
**상태**: done
**관련 계획**: [../plan/01-Phase1.md](../plan/01-Phase1.md) 작업 6

## 확인된 사실

기존 [openai.ts:207](../../lib/ai/providers/openai.ts) `composePrompt`
는 이미 "2D rigged-puppet atlas" 어휘를 일부 사용했지만, **참조
이미지가 있을 때만** slot map 섹션이 prompt에 들어감. 사용자 ref 0개
+ canonical pose 캡처 실패 케이스에선 모델이 [image 1]의 정체를 모름.

또 style negation (NOT photoreal / NOT 3D)이 없어 anime/illustration
puppet에서 photoreal drift 발생 가능 — [10-prompt-engineering.md](../10-prompt-engineering.md)
"Negative anchors"에서 명시.

## 변경

[lib/ai/providers/openai.ts](../../lib/ai/providers/openai.ts) — `composePrompt`
구조 정비:

1. **Slot map을 항상 prepend**. [image 1] = "multi-part Live2D-style
   2D rigged puppet의 한 drawable"이라는 한 문장을 ref 유무와 무관
   하게 첫 섹션으로 박음.
2. **Reference 섹션 분리**. ref가 있을 때만 별도 섹션으로 첨부.
   "마지막 reference는 full-character snapshot일 수 있다 — style
   anchor가 아니라 spatial context"라고 명시. canonical-pose ref
   (Phase 1.2) 정책을 prompt에 박은 셈.
3. **Preservation 섹션에 line weight / shading style 보존 한 줄
   추가**. [10-prompt-engineering.md](../10-prompt-engineering.md)
   "Constraints" 슬롯.
4. **Style negation 섹션 신설**. "Style: anime / illustration. NOT
   photoreal. NOT 3D. NOT live-action." — 항상 적용.
5. 기존 mask role / negative tail은 그대로, 섹션 번호만 밀림.

## 검증

- `pnpm typecheck` — 통과.
- `pnpm exec biome check lib/ai/providers/openai.ts` — 통과.
- 효과 측정: 동일 prompt + 동일 source로 old vs new prompt 결과 A/B
  는 사용자가 실제 puppet 편집 시. ship criteria의 "OpenAI prompt가
  v1 템플릿으로 통일됨"의 1단계.

## 결정

1. **프롬프트를 별도 .txt 템플릿으로 분리 안 함**. plan/01-Phase1.md
   작업 6에선 `lib/ai/prompts/edit_template.v1.txt` 신설 언급. 현재
   composePrompt가 ref 유무 / mask 유무 / negative 유무 등 6개
   조건 분기를 다루는데, 이걸 placeholder 템플릿으로 옮기면 분기
   처리가 복잡해짐. Phase 1 범위에선 in-place 수정으로 충분. Phase 3
   에서 intent 기반 prompt template + 외부 .txt 분리.
2. **prompt versioning 안 함**. 작업 6 plan에서 `edit_template.v1.txt`
   versioning 시작 언급. external file 안 만들었으므로 versioning도
   불필요. 다만 다음 prompt 대수술 시 (Phase 3) 명시적 v2로 ship.
3. **Cubism vs Live2D 표기**. 모델 어휘는 "Live2D"가 더 친숙
   ("Cubism"은 SDK 이름). prompt에는 "Live2D-style 2D rigged puppet"
   로. Spine puppet도 같은 prompt를 받는데 의미상 무리 없음 (둘 다
   "multi-part 2D rigged puppet").

## 영향

- 모든 OpenAI 호출 prompt가 ~+200자 늘어남. token cost 무시할 수준.
- ref 없을 때도 [image 1] context가 박혀 결과 안정성 개선 기대.
- canonical-pose ref가 attached일 때 "spatial context" 역할을 모델이
  명시적으로 인지 — Phase 1.2 작업과 시너지.
- Gemini / Replicate 등 다른 provider의 `composePrompt`는 변경 없음.
  필요 시 provider별 prompt 정비는 후속 작업.

## 다음 작업

[../plan/01-Phase1.md](../plan/01-Phase1.md) 작업 4 + 5 (FLUX.2
provider + router).

## 참조

- 손댄 파일 1개: `lib/ai/providers/openai.ts`.
- PR [#4](https://github.com/CocoRoF/geny-avatar/pull/4) (squash-merge
  `d18c04d`).
