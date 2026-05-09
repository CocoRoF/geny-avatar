# 2026-05-07 — Sprint 5.4: Prompt 구조 강화 + LLM refinement

## 사용자 보고

5.3 완료 후 사용자가 ref + source 둘 다 image[]에 정확히 들어가는 걸 확인. 그러나 prompt 처리에 문제 발견:

> 잠깐 지금 프롬프트로 레퍼런스처럼 변경하자고 하면
> 1. 소스이미지 (기본 텍스처)
> 2. 레퍼런스 이미지(사용자가 추가로 스타일 설명을 위해 제공하는 이미지)
> 이 두 가지를 제대로 해석하지 못하는 것 같아.
> 소스이미지를 레페런스처럼 생각해서인지 제대로 처리되지 않아.

즉 model이 image[0] (소스) vs image[1...] (ref) 의 역할 구분을 못함. 사용자가 "레퍼런스처럼 변경"이라고 하면 ref의 내용 (얼굴, 액세서리 등) 을 결과에 paste해버림.

사용자 지시:
- gpt-image-2.art docs (https://gpt-image-2.art/docs/prompting, /use-cases) 가이드 따라 개선
- 필요하면 GPT-5.x 같은 chat model로 prompt를 refine해도 됨

## docs 핵심 가이드 (확인됨)

1. **명시적 slot 라벨링** — 다중 이미지일 때 `[image 1]`, `[image 2]` 식으로 각 이미지 역할 명시
2. **명시적 보존 지시** — silhouette / geometry / composition 유지하라고 spelled out
3. **single change at a time** — 하나의 변경에 집중
4. **preservation phrasing 없으면 모델이 전체를 reinterpret 함** — 이게 우리 케이스의 정확한 실패 패턴
5. **System prompt 권장 X** — image edit endpoint는 single prompt만

## 변경 surface — A단계: 구조적 prompt 개선

### `OpenAIProvider.composePrompt` 재설계 (`lib/ai/providers/openai.ts`)

이전 (5.2): 사용자 prompt 먼저 + ref 1줄 hint

이후 (5.4):

```
Inputs: [image 1] is the texture canvas to edit. [image 2] is a style and character reference — extract palette, lighting, line quality, material rendering, and identity cues, but do NOT copy any objects, characters, faces, accessories, or scene content from it into the result. The reference content must not appear inside [image 1]'s output.

Edit [image 1]: <user prompt or refined prompt>

Preserve exactly: the silhouette and outline of [image 1]; the geometry, pose, and proportions; the composition and crop framing; (and pixels not affected by edit if no mask).

The mask channel marks the editable region of [image 1]. Pixels outside the mask must come through unchanged.   ← only when mask present

Avoid: <negative prompt>   ← only when set
```

5개 섹션 — slot map / edit verb / preservation / mask role / negative — 각각 docs 가이드와 일대일 매핑.

`refinedPrompt` 필드가 있으면 user prompt 자리에 그것이 들어감. 나머지 scaffolding은 그대로 — refined든 raw든 똑같은 preservation/role-separation 보호 받음.

### `ProviderGenerateInput.refinedPrompt?: string` 추가 (`lib/ai/providers/interface.ts`)

provider가 raw vs refined를 구분해서 사용 가능. 다른 provider들 (gemini, replicate)은 refinedPrompt 무시 — 단일 prompt 모델이라 raw만 봄.

## 변경 surface — B단계: LLM refinement 파이프라인

### 신규 — `POST /api/ai/refine-prompt` (`app/api/ai/refine-prompt/route.ts`)

OpenAI Chat Completions를 호출해 사용자 prompt를 정밀한 gpt-image-2 edit instruction으로 재작성.

- 모델: `OPENAI_PROMPT_REFINER_MODEL` env (default `gpt-4o-mini`) — fast / cheap / 명확
- system prompt: 7개 hard rule (slot convention / 사용자 의도 우선 / 보존 / single paragraph 등) + common failure patterns
- user message: layer 이름, ref 개수, mask 유무, negative hints, 사용자 raw prompt 모두 context로 제공
- temperature 0.3 — 너무 낮으면 phrasing 정리 못함, 너무 높으면 의도 비뚤어짐
- response: `{ refinedPrompt, model }`
- `OPENAI_API_KEY` 없으면 503 → 클라이언트가 raw prompt로 fallback

### `submitGenerate` 확장 (`lib/ai/client.ts`)

- 신규 `refinePrompt(input)` helper — `/api/ai/refine-prompt` 래퍼
- `SubmitGenerateInput.refinedPrompt?: string` 추가 → form 에 포함 → server route 가 provider 입력으로 forward

### `GeneratePanel` 와이어링 (`components/GeneratePanel.tsx`)

- 신규 state: `usePromptRefine` (default true), `refinement`, `refining`, `refineError`
- onSubmit 시 OpenAI provider + refine 토글 ON이면 자동 `refinePrompt` 호출 → 결과를 submitGenerate의 `refinedPrompt`로 전달
- 실패 시 raw prompt로 fallback + warning 로그
- UI: prompt 영역 아래 "Refine prompt via chat model before submit" 체크박스 + 마지막 refined 결과 details (model 이름 + refined 본문 텍스트)
- Diagnostic log에 raw vs refined 구분 추가
- generate 버튼: "refining prompt…" → "submitting…" → "generating…" → "apply" 단계 명시

### Refine 토글 visibility

OpenAI 선택 시에만 노출. Gemini / Replicate에는 안 보임 — chat refinement는 OpenAI multi-image flow에 특화된 기법.

## 의도적 한계

- **refine은 OpenAI 한정**: Gemini의 prompt convention은 다름. 별도 refinement system prompt 필요. 미래 확장.
- **refine 결과 직접 편집 X**: 사용자가 refined를 바로 수정하지 못함. details 영역에서 보고만 가능. 필요시 raw prompt 직접 편집 → 재 refine. 향후 inline edit 도입 가능.
- **caching X**: 같은 raw prompt 두 번 refine해도 두 번 호출. 사용자가 prompt 안 바꾸고 generate를 다시 누르면 재호출 — 비용 / latency 약간 추가. cache 도입 검토 가능.
- **system prompt 변경 시 사용자에게 노출 X**: REFINER_MODEL과 SYSTEM_PROMPT 모두 server-side 상수. 사용자 정의 system prompt는 별도 sprint.

## 검증

- typecheck 통과
- biome 통과
- `next build` 통과

## 시각 검증 가이드

```bash
git pull && pnpm install && pnpm dev
# OPENAI_API_KEY 확인 (refine + image edit 양쪽 다 사용)

# A. 구조적 prompt 개선만 (refine OFF) 검증
# 1. References 1장 업로드한 puppet, 임의 layer에 gen
# 2. "Refine prompt via chat model" 체크박스 OFF
# 3. prompt: "make it red"
# 4. generate
# 5. server console [openai] 로그에 composed prompt 보면:
#    Inputs: [image 1] is the texture canvas to edit. [image 2] is a style and character reference — extract palette, lighting, ... do NOT copy ...
#    Edit [image 1]: make it red
#    Preserve exactly: the silhouette ...
#    (mask present일 때) The mask channel marks ...
# 6. 모델이 ref의 content를 paste하지 않는지 결과 확인

# B. LLM refinement 검증
# 1. 같은 setup, 체크박스 ON
# 2. prompt: "make it look like the reference"  (vague)
# 3. generate 클릭 → "refining prompt…" → "submitting…" → ...
# 4. 패널에 details 영역 등장: "refined prompt ready · model=gpt-4o-mini"
#    → 펼치면 refined text — 슬롯 라벨 / 보존 지시 등 포함된 정밀화된 버전
# 5. server console [refine-prompt] 로그 확인:
#    raw="make it look like the reference…" refined="..."
# 6. server console [openai] 의 composed prompt 가 refined 기반으로 빌드된 거 확인
# 7. 결과가 (a)에 비해 ref content paste 줄어들고 (b) source의 silhouette 유지

# C. Fallback 검증
# 1. OPENAI_API_KEY 일시적으로 빼거나 잘못된 키로 설정
# 2. refine ON 상태에서 generate
# 3. 패널에 빨간 텍스트 "refine failed — falling back to raw prompt: ..."
# 4. raw prompt 그대로 image edit 호출 (지금처럼 503 가 아니라 image edit은 정상)
```

## Phase 5 진행 상태

- ✅ 5.1 Per-puppet reference image store
- ✅ 5.2 OpenAI multi-image input (`image[]`)
- ✅ 5.3 Active references + iterative anchor
- ✅ **5.4 Structured prompt + LLM refinement**
- ⏳ 5.5 Generation comparison viewer
- ⏳ 5.6 (deferred) ComfyUI / LoRA / IP-Adapter

5.4까지 끝나면 단일 puppet에서 ref 1~3장 업로드 → vague prompt 입력 → gpt-image-2가 정확히 "source 캔버스에 사용자 의도 적용 + ref의 style만 반영" 흐름 동작.
