# 2026-05-07 — Phase 3 Kickoff: AI Texture Generation

Phase 2 종료. Sprint 2.0~2.6으로 atlas region 추출, DecomposeStudio (clip + mask 라이브 적용), Cubism dedup까지 완료. 다음은 [plan/07](../plan/07_phased_roadmap.md)의 **Phase 3 — AI Texture Generation (MVP)**.

목표: "이 옷을 다른 옷으로" 30초 안에 puppet에 반영되는 워크플로 구현.

## 상위 스코프

- Replicate (또는 호환 provider) 통합
- `/api/ai/generate`, `/api/ai/status/:jobId` 라우트
- `GeneratePanel` UI: 프롬프트 → 진행 → 결과 적용
- 표준 워크플로 `inpaint-controlnet-v1`: SDXL inpaint + canny ControlNet
- 결과 캐시 (IndexedDB)
- 에러 처리: 타임아웃, 재시도, 후처리 alpha 강제

V1 시나리오 A의 3~4단계 ("이 옷 → 다른 옷") 시연 가능 상태가 완료 조건.

## Sub-sprint 분할

### Sprint 3.0 (이번) — UI 골격 + 도메인 타입 (백엔드 X)

- `lib/ai/types.ts` — `AIJob`, `AIJobStatus`, `GenerateRequest`, `AIProvider` interface
- `lib/store/editor.ts` — `generateLayerId` state (DecomposeStudio의 `studioLayerId`와 같은 패턴)
- `components/GeneratePanel.tsx` — 모달 shell. layer region 미리보기 + 프롬프트 입력 + submit 버튼 + 결과 영역. submit 시 "Sprint 3.1에서 backend 연결" 안내만. 실제 호출 X.
- `components/LayersPanel.tsx` — row마다 `gen` 버튼 (edit과 같은 hover 노출 패턴, Layer.texture 있을 때만)

이번 sprint는 UI 형상을 먼저 보고 검증. 백엔드는 다음 sprint.

### Sprint 3.1 — Replicate 통합 + 기본 SDXL inpaint

- `app/api/ai/generate/route.ts` (POST) + `app/api/ai/status/[jobId]/route.ts` (GET)
- `lib/ai/providers/replicate.ts` — Replicate 클라이언트 (env: `REPLICATE_API_TOKEN`)
- `AIProvider` interface로 future swap (HuggingFace, 자체 ComfyUI 등) 가능하게
- 워크플로: 사용자 프롬프트 + 현재 layer region (PNG) → SDXL inpaint → 결과 PNG URL
- ControlNet 아직 X. 단순 inpaint만.
- env var 없을 때 명시적 에러로 graceful degradation
- 결과는 `GeneratePanel` 미리보기에만 — atlas 적용은 다음 sprint

### Sprint 3.2 — silhouette canny ControlNet + DecomposeStudio mask 연계

- DecomposeStudio가 만든 mask blob을 inpaint mask로 사용 (없으면 layer footprint 자체)
- mesh silhouette → canny edge map → ControlNet 입력
- Replicate 워크플로 업그레이드: SDXL inpaint + canny ControlNet
- 결과 품질 향상, 캐릭터 일관성 보존

### Sprint 3.3 — 결과 atlas 적용

- 생성된 PNG를 layer region에 맞춰 atlas page에 합성
- 어댑터의 `setLayerMasks` 패턴 재사용/일반화 — `setLayerOverrides({ textureOverrides })`
- GPU 텍스처 swap → 즉시 라이브 렌더 갱신
- "이 옷을 다른 옷으로" 효과 시연 가능

### Sprint 3.4 — IDB 캐시 + 히스토리 + 에러 처리

- `aiJobs` IDB store: jobId, layerId, prompt, status, resultBlob, createdAt
- GeneratePanel에 히스토리 — 같은 layer의 이전 생성물 reload
- 타임아웃 (60s default), 재시도 (3x exponential backoff), 후처리 alpha 강제
- DecomposeStudio mask가 같이 변할 때 IDB 영속성도 함께 (선택)

## 디자인 결정

### Provider 추상화

`AIProvider` interface로 `generate(req): Promise<JobHandle>` + `status(jobId): Promise<JobStatus>` 노출. Replicate 외 다른 backend 추가 시 한 파일만 추가하면 됨. Phase 5 (자체 ComfyUI) 진입 시 같은 interface 재사용.

### 백엔드 / 키 노출

Replicate API 키는 절대 클라이언트 번들에 포함 X. Next.js API 라우트 (server-side) 에서만 `process.env.REPLICATE_API_TOKEN` 접근. 클라이언트는 `/api/ai/*` 만 호출.

### 키 부재 시 동작

`REPLICATE_API_TOKEN` 환경변수 없으면 `/api/ai/generate`는 503으로 명시적 안내 메시지 반환. UI는 "API 키가 설정되지 않음. .env.local에 추가하세요" 노출. 솔로 hobbyist가 키 없이도 빌드/실행 가능 — 키 있을 때만 실제 호출.

### 결과 적용 — atlas 패턴 재사용

Sprint 2.4의 `applyLayerMasks`는 mask blob → atlas page → GPU 패턴. AI 결과도 비슷한 모양 — 단지 `destination-out` 대신 `source-over` 합성. 어댑터에 `setLayerOverrides` 또는 `setLayerTextures` 추가해 일반화. 같은 GPU swap 메커니즘.

### 마스크 ↔ AI 결합

DecomposeStudio에서 mask 다듬은 후 GeneratePanel 진입 시 mask가 inpaint mask로 자동 전달. 사용자는 (1) DecomposeStudio에서 영역 다듬고 (2) GeneratePanel에서 새 텍스처 받음. 두 도구가 한 흐름으로 결합.

## 이번 변경 — Sprint 3.0

UI 골격만. 검증 후 3.1로 backend 연결.

`lib/ai/types.ts`, `lib/store/editor.ts`(generateLayerId), `components/GeneratePanel.tsx`, `components/LayersPanel.tsx`(gen 버튼). 약 4개 파일 변경.

## 시각 검증 가이드

```bash
git pull && pnpm install && pnpm dev
# /edit/builtin/hiyori
# - LayersPanel 행 hover → "edit" 옆에 "gen" 버튼
# - 클릭 → GeneratePanel 모달: layer region 미리보기 + 프롬프트 입력
# - 프롬프트 입력 후 "generate" 클릭 → "Sprint 3.1에서 backend 연결" 안내
# - Esc 닫기
```

## 다음

검증 OK면 Sprint 3.1 — Replicate provider + API 라우트.
