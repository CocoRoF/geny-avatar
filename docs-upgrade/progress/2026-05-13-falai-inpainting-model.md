# 2026-05-13 Phase 1.x — fal.ai 에 mask-aware FLUX inpainting 모델 추가

**Phase / 작업**: Phase 1.x (closure 백로그 Option A)
**상태**: done (provider 분기 적용, 사용자 mask 그린 후 시험 가능)
**관련 계획**: [../plan/01-Phase1.md](../plan/01-Phase1.md) +
[2026-05-12-phase1-closure.md](2026-05-12-phase1-closure.md) 백로그
Option A

## 배경

[2026-05-13-phase1-3-verification-result.md](2026-05-13-phase1-3-verification-result.md)
에서 사용자가 ControlNet-style mask-aware 모델 업그레이드 권장. 이번
PR로 fal.ai의 mask-aware FLUX 모델을 provider에 등록.

## 조사 — 후보 모델

WebFetch로 fal.ai 카탈로그 검색:

- **`fal-ai/flux-general/inpainting`** — FLUX.1 [dev] base, 명시적
  mask channel (`mask_url`) 지원. controlnets / ip_adapters / loras
  옵션. 가격: $0.075/MP. **채택**.
- `fal-ai/flux-pro/kontext` / `fal-ai/flux-kontext-lora` — region-aware
  edit이지만 별도 mask channel 없음. local edit은 text instruction
  중심. mask 컨트롤이 필요한 우리 use case와 fit 약함.
- `fal-ai/flux-controlnet-inpainting` — 검색 시 404. 존재 안 함.
  alimama-creative 모델은 fal.ai에 hosted되지 않은 듯.
- `bria/fibo-edit/edit` — JSON + Mask + Image 조합. 비 FLUX. 후순위.

## 변경

[lib/ai/providers/falai.ts](../../lib/ai/providers/falai.ts) 대규모
정비:

1. **`MODELS` 배열 확장** — `flux-2-edit` (기존) + `flux-inpainting`
   (신규). description에 atlas-crop fit 한계와 mask 요구 명시.
2. **provider config** — `displayName` "fal.ai FLUX" 로 (FLUX.1 + FLUX.2
   모두 포함하므로 ".2" 떼어냄), `supportsBinaryMask: true` (model
   분기 안에서 활용).
3. **`generate()` 재구성** — `buildSubmitBody(modelId, input)` 헬퍼로
   엔드포인트 / body 분기:
   - `flux-2-edit` → 기존 `image_urls[]` body, prompt scaffold 그대로.
   - `flux-inpainting` → `image_url`, `mask_url`, `strength: 1.0`,
     `num_inference_steps: 28`, `guidance_scale: 3.5`. prompt는
     별도 scaffold (`composeInpaintingPrompt`).
4. **`composeInpaintingPrompt`** — inpainting 흐름은 mask가 region을
   강제하므로 "DO NOT add face/character" 같은 atlas-crop 가드레일
   불필요. style negation (anime / no photoreal) 만 유지.
5. **`maskBlobToBinaryDataUri`** — 일단 raw mask blob을 그대로 data URI로.
   DecomposeStudio mask는 `alpha=255` 영역이 "edit me"인 PNG. fal.ai
   inpainter가 alpha를 honour하는지 RGB luma만 보는지 확인 후 필요
   시 client-side에서 white-on-black 변환 추가.
6. **`maskImage` 없을 때 명확한 에러** — `flux-inpainting` 선택 + mask
   미제출이면 "draw a mask in DecomposeStudio first" 메시지로 throw.
7. **콘솔 로그 갱신** — model id + mask 첨부 여부 추가.

## 검증

- `pnpm typecheck` ✓
- `pnpm exec biome check lib/ai/providers/falai.ts` ✓
- 실호출 검증: 사용자가 dev 재시작 후
  1. GeneratePanel에서 provider = "fal.ai FLUX" 선택.
  2. Model picker에서 `FLUX.1 inpainting (mask-aware)` 선택.
  3. DecomposeStudio에서 mask 한 번 그림 → save.
  4. GeneratePanel로 돌아와 "white hair" generate.
  5. 결과 quality 평가 (외곽 잔존 / tendril 손실 해소 여부).

mask 없이 inpainting model 선택 시 콘솔에 에러 메시지로 안내 →
드러나는 흐름.

## 결정

1. **`flux-2-edit`은 유지**. atlas-crop fit 약하지만 mask-less 빠른
   bulk fan-out에선 유효 (Phase 3 orchestrator 용도). 두 모델 동시
   제공하고 사용자 / orchestrator가 선택.
2. **mask 자동 derive는 다음 PR**. 이번 PR은 provider 분기와 호출 흐름
   확립. mask 안 그려도 동작하게 하려면 source의 alpha 채널을 mask로
   변환해야 — client-side helper 신설 작업이 별도 분량. 후속.
3. **mask 변환 (alpha→RGB) 보류**. fal.ai inpainter가 alpha를 honour
   는지 모름. 첫 호출 결과로 확인 후 필요시 client-side 변환 추가.
4. **`strength: 1.0` 고정**. 우리는 안쪽을 통째로 redraw하는 게 의도.
   소스 컬러 bleed는 우리가 풀려는 문제이지 유지하려는 속성이 아님.
5. **`enable_safety_checker` 옵션 inpainting에 안 넣음**. flux-general/
   inpainting endpoint에서 이 옵션이 받혀지는지 확인 필요. 기본 동작
   에 맡김 (필요시 후속 PR).

## 영향

- GeneratePanel의 model dropdown에 새 항목 "FLUX.1 inpainting (mask-
  aware)" 노출. capabilities.models 배열 기반이라 UI 코드 변경 0.
- 기존 flux-2-edit 흐름은 변경 없음. 사용자 mask는 그대로 무시.
- inpainting 흐름은 mask 필수. DecomposeStudio 흐름과 자연 연결.
- 다른 provider (OpenAI / Gemini) 영향 없음.

## Phase 1 closure 영향

closure entry의 백로그 "Option A — mask-aware FLUX 모델 도입"이
이 PR로 충족. 사용자 검증 후 quality 측정 결과를 closure에 append.

## 다음 단계 (사용자 결정)

검증 후 결과에 따라:

- inpainting 결과 quality 우수 → Phase 1.x closure 종결 + Phase 2 진입.
- mask 자동 derive (source alpha → mask) 필요 인지 → 후속 PR 진행
  후 Phase 2.
- mask 변환 (alpha→RGB) 필요 인지 → 후속 PR 진행.
- 또는 즉시 Phase 2로 진입하고 inpainting fine-tuning은 후순위.

## 참조

- 손댄 파일 1개: `lib/ai/providers/falai.ts`.
- PR: 이 entry가 포함된 PR이 머지될 때 main에 들어감.
