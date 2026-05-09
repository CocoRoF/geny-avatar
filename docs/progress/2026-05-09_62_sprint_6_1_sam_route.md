# 2026-05-09 — Sprint 6.1: SAM provider + Replicate route 백엔드

[`61 phase6_kickoff`](2026-05-09_61_phase6_kickoff.md)의 첫 atomic sprint. SAM 자동 마스크의 백엔드 라인을 끝까지 깐다 — 클라이언트가 image + clicks 를 multipart로 던지면 후보 N개의 mask blob을 받아오는 흐름. UI 통합은 6.2.

## 변경 surface

### `lib/ai/sam/types.ts` (신규)

도메인 타입을 image-edit `AIProvider` 와 분리. SAM은 입력/출력이 다르고(클릭 점 + 후보 마스크들), 같은 `REPLICATE_API_TOKEN` 하나만 공유.

- `SamPoint = { x, y, label: 0|1 }` — 1=foreground, 0=background, 좌표는 source-image px
- `SamCandidate = { maskBlob, score? }` — 흰색=255 inside, 검정=0 outside (`editorStore.layerMasks` 와 같은 컨벤션)
- `SamRequest`, `SamResponse`

### `app/api/ai/sam/route.ts` (신규)

Sync route — `Prefer: wait=60` 헤더로 polling 회피. cold start로 wait가 끝나도 `processing` 이면 `pollUntilTerminal` fallback.

- multipart 입력: `image`, `points` (JSON string), optional `modelId`
- foreground 점 1개 이상 강제 (없으면 400)
- image를 `data:` URL로 인라인 인코딩 → Replicate 모델 endpoint에 POST
- output URL 모양 다양함 (string / array / `{masks: [...]}` 등) — `collectOutputUrls` 가 sniff
- 마스크는 server-side에서 fetch → base64 data URL 로 응답 (CORS 회피)
- 응답: `{ candidates: [{ maskDataUrl, score? }], model, elapsedMs }`

env:
- `REPLICATE_API_TOKEN` 필수
- `REPLICATE_SAM_MODEL` 옵션 — default `meta/sam-2`. 다른 fork 쓰면 `buildInput`의 키 이름 조정 필요.

### `lib/ai/sam/client.ts` (신규)

브라우저 호출 헬퍼. `submitSam({ imageBlob, points, modelId? })` → `Promise<SamResponse>`. data URL → Blob 변환은 `fetch` 가 data: 스킴을 native 처리하니 그걸 활용.

### `/poc/sam-debug` (신규)

검증 harness — DecomposeStudio 통합 전에 route + client 동작 확인용:

- 좌측: source 이미지 + 클릭 캡처 canvas
  - 좌클릭 → foreground 점 (label=1, 초록 dot)
  - 우클릭 → background 점 (label=0, 빨강 dot)
  - reset points 버튼
- 우측: SAM 응답 후보 그리드 (썸네일)
  - hover → source 위에 mix-blend-screen 으로 overlay (매칭 검증)

## 의도적 한계

- **UI는 진단 페이지만**: DecomposeStudio segment mode는 6.2에서. 6.1은 wiring 검증만.
- **API 키는 server-side만**: Replicate 토큰은 route 안에서만 읽음. 클라이언트로 노출 X.
- **Polling fallback은 단순**: 0.5s → 1.5x backoff up to 3s, 60s deadline. 정교한 cancel/abort는 6.4 batch 때 다시.
- **input shape 불확실성**: Replicate SAM port 마다 `points`/`input_points` 등 키 이름이 다름. 일단 양쪽 다 보내고, 알 수 없는 키는 모델이 무시한다는 가정. 배포 시 응답 잘 안 오면 `buildInput` 조정 + log 확인.
- **multimask vs single**: `multimask_output: true` 항상 요청. SAM 1/2 모두 이 키가 동작. 결과가 1개만 와도 정상 처리.

## 검증

- typecheck 통과
- biome 통과
- `next build` 통과 — `/api/ai/sam` 과 `/poc/sam-debug` 라우트 등록 확인

## 시각 검증 가이드

```bash
# .env.local 에 둘 다 있어야 함
# REPLICATE_API_TOKEN=r8_...
# REPLICATE_SAM_MODEL=meta/sam-2  (또는 검증된 fork)

git pull && pnpm install && pnpm dev
# 1. http://localhost:3000/poc/sam-debug 진입
# 2. "pick image…" 로 PNG 선택 (캐릭터 region 같은 거)
# 3. 좌클릭으로 segmentation 원하는 객체 위에 점 1~3개
# 4. (옵션) 우클릭으로 빼고 싶은 영역 점 추가
# 5. "auto-mask" → 1~5초 대기
# 6. 우측에 mask 후보 그리드 표시
#    - hover → 좌측 source 위에 overlay
# 7. dev 콘솔에 [ai/sam] 로그로 latency / 후보 수 확인
```

응답이 비면 (`prediction returned no mask URLs`) Replicate 모델이 다른 output shape — 콘솔 로그의 elapsedMs는 정상이지만 collectOutputUrls 가 sniff 못한 것. 그 모델의 output 모양 확인 후 collectOutputUrls 에 키 추가.
