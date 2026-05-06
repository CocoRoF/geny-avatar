# 05 — AI Pipeline

"이 레이어 텍스처를 다시 그려줘" 한 번이 클릭부터 미리보기 갱신까지 어떻게 흐르는가. 근거는 [analysis/06](../analysis/06_generative_ai_texture.md).

## 한 번의 생성 — 시퀀스

```
[User]                       [Client]                       [Server / AI Backend]
  │                             │                                   │
  │ 레이어 X 선택                │                                   │
  ├─────────────────────────────►                                   │
  │                             │ GeneratePanel 표시               │
  │                             │ (현재 region preview, 프롬프트 입력)│
  │ 프롬프트 + Generate         │                                   │
  ├─────────────────────────────►                                   │
  │                             │ 1. region 추출 → 1024 패딩         │
  │                             │ 2. silhouette → canny 입력         │
  │                             │ 3. mask 생성 (region alpha)        │
  │                             │ 4. payload 조립                    │
  │                             ├──────────────────────────────────►│
  │                             │   POST /api/ai/generate            │
  │                             │                                   │ Replicate(or ComfyUI) 호출
  │                             │◄──────────────────────────────────┤
  │                             │   { jobId, status: queued }        │
  │                             │                                   │
  │                             │ SSE/poll로 진행 추적              │
  │                             │◄──────────────────────────────────┤
  │                             │   { progress: 0.3, ... }           │
  │                             │◄──────────────────────────────────┤
  │                             │   { status: completed,             │
  │                             │     resultUrl: ... }                │
  │                             │ 5. PNG 다운로드 → unpadding crop   │
  │                             │ 6. IndexedDB에 textureId로 캐시    │
  │                             │ 7. store.setLayerTexture(X, id)    │
  │                             │ 8. SpineAdapter가 Pixi 텍스처 갱신│
  │ 미리보기 변경 확인           │                                   │
  │◄────────────────────────────┤                                   │
```

## 페이로드 — POST /api/ai/generate

```ts
type GenerateRequest = {
  layerId: string
  prompt: string
  negativePrompt?: string
  seed?: number               // 빈 값이면 서버가 랜덤
  refImages?: string[]        // base64 PNG 또는 URL
  loraOverrides?: { name: string, weight: number }[]
  // 입력
  region: {
    image: string             // base64 PNG (1024 정사각형 패딩됨)
    mask: string              // base64 PNG (white = 다시 그릴 영역)
    silhouette: string        // base64 PNG (canny 입력용 외곽선)
    originalSize: { w: number, h: number }  // 패딩 전 원본
  }
  // 워크플로 선택
  workflow: 'inpaint-controlnet-v1'   // 시작은 한 워크플로만
}
```

응답:
```ts
type GenerateResponse =
  | { status: 'queued', jobId: string }
  | { status: 'failed', error: string }
```

## 진행 추적 — GET /api/ai/status/:jobId

```ts
type StatusResponse = {
  jobId: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress?: number          // 0..1, 단계별 추정
  resultUrl?: string         // completed일 때 PNG URL
  error?: string
}
```

**구현**: V1에서는 client polling (1초 간격). SSE는 V2 이후 (인프라 비용).

## 표준 워크플로 — `inpaint-controlnet-v1`

베이스 모델: **AnimagineXL 4.0** (anime fine-tune SDXL).

ControlNet 적층:
- `controlnet-canny-sdxl-1.0` weight 1.0 — silhouette 입력
- `controlnet-inpaint-dreamer-sdxl` weight 1.0 — mask 입력

선택적:
- IP-Adapter — refImages 주어졌을 때 weight 0.7
- 사용자 LoRA — loraOverrides에서 받음, 기본 weight 0.8

생성 파라미터:
- steps: 30
- cfg: 7
- sampler: DPM++ 2M Karras
- size: 1024×1024

후처리 (서버 측):
- region 외부 알파 = 0 강제 (silhouette mask로)
- 1~2px alpha feather

## Replicate 통합 (V1)

**옵션 1 — 기존 모델 endpoint 사용**:
- `lucataco/sdxl-controlnet-inpaint` 같은 공개 모델을 콜.
- 단점: 우리가 원하는 정확한 워크플로 (다중 ControlNet + 다중 LoRA 적층)가 한 endpoint에 다 안 들어감.

**옵션 2 — 자체 Cog 이미지 빌드 후 deploy**:
- ComfyUI 워크플로를 Cog 이미지로 패키징, Replicate에 push.
- 우리가 원하는 정확한 적층을 그대로 쓸 수 있음.
- 빌드·테스트 부담 ↑.

**Phase 1 결정**: 옵션 1로 시작 (간단한 워크플로). 결과 품질이 명백히 부족하면 옵션 2로 이전.

## 자체 ComfyUI (V2+)

- 인프라: RunPod 서버리스 GPU 또는 Lambda Labs A100 인스턴스.
- API: ComfyUI의 `/prompt` endpoint를 직접 호출. 워크플로 JSON을 클라이언트에서 (또는 서버에서 합성해서) 전달.
- 큐/잡 관리: ComfyUI 자체 큐 + 우리 jobId mapping.
- 비용 통제: idle shutdown, 분당 인스턴스 부팅으로 cold start 트레이드오프.

## 비용 / 응답 시간 가이드

|  | Replicate (V1) | 자체 ComfyUI (V2) |
|---|---|---|
| 단일 inpaint (30 step, 1024) | $0.02~0.05 | 분당 GPU 비용 amortize |
| 응답 시간 | 8~30s | 5~15s (warm) / 30~60s (cold) |
| 큐 동시성 | Replicate plan 한도 | 우리 큐 깊이 |
| 워크플로 자유도 | 제한적 | 완전 |

## 캐시 정책

- 같은 (layerId, prompt, seed, refImages, loras) 조합 → 결과 PNG를 IndexedDB에 캐시. 사용자가 같은 입력으로 다시 누르면 즉시 hit.
- 서버 측 캐시: V1은 Replicate가 같은 입력에 같은 결과를 보장하지 않으므로 미사용. V2 ComfyUI에서는 deterministic seed → 캐시 가능.

## 안전 / 콘텐츠 필터

- **NSFW/위험 프롬프트 필터**: SaaS endpoint는 자체 필터를 가짐. 자체 ComfyUI면 우리 layer를 추가 (간단한 단어 차단 → V2 이후 제대로).
- **사용자 식별 가능 콘텐츠 (얼굴 reference)**: 사용자가 본인이 아닌 사람의 사진을 ref로 올리는 것을 정책상 금지. 모달로 동의 받음.
- **저작권**: 게임 캐릭터의 이름·스타일을 프롬프트에 강제 차단? 너무 광범위. 명시적 안내문 + 사용자 책임으로 처리.

## 실패 모드 처리

| 실패 모드 | 처리 |
|---|---|
| 네트워크 타임아웃 | 60s 후 자동 cancel → "다시 시도" 버튼 |
| Replicate 5xx | 3회 backoff retry |
| AI가 외곽선을 침범한 결과 | 자동 후처리: silhouette mask로 alpha 강제 0 |
| 결과 색감이 캐릭터와 어긋남 | 사용자가 "다시 (다른 seed로)" 버튼 — 비용 추가 |
| 사용자가 도중에 다른 layer 선택 | 진행 중 job은 백그라운드 유지, UI는 새 layer로 |
| 연속 같은 layer 재생성 | 직전 job cancel + 새 job 시작 |

## 미정 / [VERIFY]

- 워크플로를 단일이 아니라 **카테고리별로** 다양화할 가치가 있는가 (의상/머리카락/액세서리 별도 워크플로). MVP는 단일.
- 사용자 LoRA 업로드를 V1에 포함할지. 포함 안 하면 캐릭터 일관성이 약해진다. 포함하면 LoRA 검증·저장이 필요.
- V1에서 multi-frame 일관성(같은 캐릭터로 여러 layer를 일관되게)은 어떻게 강제하는가 — IP-Adapter cross-layer ref가 한 가지 답.
- 비용 임계 도달 시(예: 한 사용자가 100회 생성) UX 처리 — V1은 사용자 노티만, 결제는 V2 이후.
