# 2026-05-07 — Sprint 3.1: Gemini + OpenAI 통합 (실호출)

Phase 3.0의 UI 골격 위에 실제 두 provider를 완전 구현. 각각의 API 명세를 직접 fetch해 검증한 뒤 정확히 그 모양대로 호출.

## 통합 명세

### Google Gemini (Nano Banana)

ref: https://ai.google.dev/gemini-api/docs/image-generation

- `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
- `x-goog-api-key: $GEMINI_API_KEY` 헤더
- 모델 IDs: `gemini-2.5-flash-image` (Nano Banana, default), `gemini-3.1-flash-image-preview` (Nano Banana 2), `gemini-3-pro-image-preview` (Nano Banana Pro)
- Body: `{ contents: [{ parts: [<text>, <inline_data>...] }], generationConfig: { responseModalities: ["TEXT", "IMAGE"] } }`
- Response: `candidates[].content.parts[i].inline_data.{mime_type, data}` (snake_case 또는 camelCase 둘 다 수용)
- **Mask 처리**: binary mask 입력 X. Google 공식 문서의 "conversational mask" 패턴 — 두 번째 image part로 마스크를 보내고 prompt에서 명시. DecomposeStudio의 mask blob을 그대로 두 번째 image part로 첨부 + 프롬프트에 "두 번째 이미지의 opaque pixel(red painted)이 edit 영역" 안내.

### OpenAI gpt-image-2

ref: https://developers.openai.com/api/docs/guides/image-generation

- `POST https://api.openai.com/v1/images/edits`
- `Authorization: Bearer $OPENAI_API_KEY`
- `multipart/form-data`
- 모델 IDs: `gpt-image-2` (default), `gpt-image-1.5`, `gpt-image-1`, `dall-e-2`
- Form fields: `model`, `image` (PNG/JPEG/WebP), `mask` (PNG with alpha), `prompt`, `n`, `size`, `quality`, `response_format`
- Response: `data[].b64_json` 또는 `data[].url`
- **Mask 컨벤션**: alpha=0이 edit zone (transparent = 편집), alpha=255 = preserve. DecomposeStudio는 alpha=255 = "user marked" 컨벤션이라 **반전 필요** → 클라이언트가 `buildOpenAIMaskCanvas`에서 `alpha = 255 - alpha` 처리.
- **이미지 size 제약**: max edge ≤ 3840, 양변 16의 배수, aspect long:short ≤ 3:1, 총 픽셀 [655_360, 8_294_400]. 클라이언트가 1024×1024 center-pad로 정규화 (`padToOpenAISquare`). 마스크도 동일 사이즈로 패드.
- **Negative prompt 필드 X**: prompt에 "Avoid: ..." 으로 splice.

## 아키텍처

### 클라이언트 → 서버 → provider

```
GeneratePanel
  └─ submitGenerate(form)
      └─ POST /api/ai/generate (multipart)
          └─ getProvider(id) → AIProvider instance
              └─ provider.generate(input)
                  └─ fetch <provider API>
              └─ jobs.setResult(jobId, blob)
      ← { jobId }
  └─ poll GET /api/ai/status/:jobId
  ← AIJobStatus
  └─ GET /api/ai/result/:jobId
  ← Blob
```

### Provider 추상화

`lib/ai/providers/interface.ts` — `AIProvider` 인터페이스:
- `config: ProviderConfig` (id, displayName, capabilities)
- `generate(input): Promise<Blob>` — 동기적 모양 (long-running provider는 내부에서 polling 후 최종 blob 반환)

`lib/ai/providers/registry.ts` — env-based init:
- `GEMINI_API_KEY` → `GeminiProvider`
- `OPENAI_API_KEY` → `OpenAIProvider`
- `REPLICATE_API_TOKEN` → "Sprint 3.2에서 구현" 안내
- key 없으면 `getProvider(id)`가 `{ provider: null, reason }` 반환

### 서버 job tracking

`lib/ai/server/jobs.ts` — module-scope `Map<jobId, ServerJob>`. TTL 1시간. Single-instance만 — 프로덕션에선 Redis 백업 필요하지만 hobby scale OK.

### API routes (4개)

- `POST /api/ai/generate` — multipart form, job id 즉시 반환, provider 호출은 background
- `GET /api/ai/status/[jobId]` — `AIJobStatus` JSON
- `GET /api/ai/result/[jobId]` — blob (succeeded일 때만, 409 otherwise)
- `GET /api/ai/providers` — 각 provider의 availability + capabilities

### 클라이언트 helper

`lib/ai/client.ts`:
- `fetchProviders()` — `/api/ai/providers` 호출
- `canvasToPngBlob(canvas)`
- `padToOpenAISquare(canvas)` — 1024 square center-pad
- `buildOpenAIMaskCanvas(blob, offset)` — alpha 반전 + dim 매칭
- `submitGenerate(input)` — 제출 + polling + result fetch, `Promise<Blob>` 리턴

이미지 변환을 client-side에서 처리하는 이유: server route를 thin proxy로 유지. Node에 `sharp`/`canvas` deps 추가 안 함. 브라우저 `canvas`로 충분.

## GeneratePanel 변경

- 3-column 레이아웃: source | result | controls (이전엔 2-column)
- `fetchProviders()` mount 시 호출, 첫 가용 provider 자동 선택
- provider/model picker, prompt + negative prompt 입력
- submit → submitting → running → succeeded/failed 상태 전환
- result preview에 blob URL <img> 렌더, succeeded 후 reset 버튼
- running 중엔 Esc 무시 (의도치 않은 dismiss 방지)
- mask 표시: provider가 binary mask 지원하면 "mask in use", 아니면 "mask as ref"

## 환경변수

`.env.example` 추가. `.env.local`로 복사 후 키 입력:

```
GEMINI_API_KEY=...
OPENAI_API_KEY=...
REPLICATE_API_TOKEN=...   (Sprint 3.2)
```

키 미설정 provider는 picker에서 disabled + reason 표시.

## 검증

- typecheck/lint/build 통과
- 4개 새 API route 빌드: `/api/ai/{generate,status/[jobId],result/[jobId],providers}`

## 시각 검증 가이드

```bash
# 1) .env.local 생성 + 키 입력 (둘 중 하나라도 OK)
cp .env.example .env.local
# 키 입력 후
git pull && pnpm install && pnpm dev

# 2) /edit/builtin/hiyori 진입 → LayersPanel에서 layer hover → "gen"
# 3) provider 선택 (key 없는 건 disabled), 프롬프트 입력
#    예: "vibrant red, glossy fabric, soft shadow"
# 4) "generate" 클릭 → submitting → running (Gemini ~5-15s, OpenAI ~10-30s)
# 5) 우측 result에 새 텍스처 미리보기
# 6) DecomposeStudio mask 저장된 layer라면 "mask in use" / "mask as ref" 배지
#    Gemini는 mask를 ref image로, OpenAI는 binary mask로 처리
# 7) reset → 다시 시도
# 8) Esc 닫기 (running 중엔 안 닫힘)
```

## 알려진 제약

- 결과는 미리보기만 — atlas 적용은 Sprint 3.3
- Replicate / SDXL+ControlNet 미구현 — Sprint 3.2
- 실패한 job 재시도 자동화 X — Sprint 3.4
- IDB 캐시 X — Sprint 3.4
- OpenAI 1024×1024 padding으로 인한 quality loss — non-square layer는 작게 보일 수 있음. 후속 sprint에서 aspect-aware padding 검토.

## 다음

- Sprint 3.2: Replicate provider + SDXL inpaint + ControlNet (silhouette → canny)
- Sprint 3.3: 결과를 atlas page에 합성 (Sprint 2.4 GPU swap 패턴)
- Sprint 3.4: IDB 캐시 + 재시도 + 히스토리
