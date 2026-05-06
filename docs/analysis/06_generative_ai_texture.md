# 06 — Generative AI Texture Pipeline

"텍스트로 텍스처를 만든다 / 바꾼다"가 작동하려면 어떤 모델·기법·인프라가 필요한가.

## 작업 카테고리

이 도구가 사용자에게 노출할 AI 작업은 **두 종류**로 압축된다:

1. **In-place re-texture** — 기존 슬롯의 외곽선·UV를 유지한 채 텍스처만 다시 그린다. ("이 옷을 가죽 자켓으로 바꿔줘")
2. **From-prompt new asset** — 빈 슬롯이나 "처음부터 새 모자" 같이 외곽선을 AI가 같이 만든다. ("베레모를 그려서 cap 슬롯에 넣어줘")

(2)는 (1)보다 어렵다 — 외곽선이 메시 UV와 맞아야 한다. **MVP는 (1)에 집중.** (2)는 슬롯이 mesh가 아니라 region일 때만 (단순한 사각 텍스처일 때만) 가능.

## 모델·기법 — 사실 정리

### Stable Diffusion XL (SDXL)

- 1024×1024 기본. ([SDXL 1.0 Inpainting](https://huggingface.co/diffusers/stable-diffusion-xl-1.0-inpainting-0.1))
- 베이스 + Refiner 두 단 구조. inpainting은 별도 fine-tune 모델이 따로 있다 (`stable-diffusion-xl-1.0-inpainting-0.1`).
- 캐릭터 아트 스타일은 base SDXL이 약하다 → **anime/illustration LoRA 또는 fine-tune 베이스(예: AnimagineXL, Pony)** 필요.

### ControlNet — 공간 조건 부여

[ControlNet for SDXL](https://huggingface.co/docs/diffusers/api/pipelines/controlnet_sdxl). 우리에게 의미 있는 변종:

- **canny / lineart**: 외곽선 강제. 우리의 1순위 — 메시 silhouette을 canny 입력으로 주면 외곽선이 어긋나지 않는다.
- **depth**: 입체감 가이드. 옷 주름·구조감 보존에 유용.
- **scribble / softedge**: 더 느슨한 외곽선 가이드.
- **segmentation**: 영역 지정. mesh의 part별 색을 다르게 강제할 때.

### Inpainting — 마스크 기반 영역 재생성

- 입력: 원 이미지 + 마스크 (white = 다시 그림, black = 보존) + 프롬프트
- 우리 use case: region을 그대로 두고 "옷 부분만" 다시 그릴 때. 마스크 = 옷의 알파.
- **ControlNet과 결합**: ControlNet-Inpaint 워크플로 ([SDXL ControlNet Inpaint Civitai](https://civitai.com/models/2374331/sdxl-10-inpaint-controlnet))가 외곽선 보존 + 영역 재생성을 동시에 한다. **우리 핵심 워크플로.**

### IP-Adapter — 이미지 프롬프트

- "이 캐릭터 톤·색감을 유지해서 새 옷을 그려줘" 할 때 캐릭터 얼굴/스타일 참조 이미지를 모델에 직접 넣는다.
- ([IP-Adapter docs](https://huggingface.co/docs/diffusers/en/using-diffusers/ip_adapter))
- 가중치 핵심: weight 0.65~0.75가 sweet spot, 0.9+는 결과를 망친다는 게 2026년 커뮤니티 consensus.

### LoRA — 캐릭터/스타일 일관성

- 작은 fine-tune. 한 캐릭터의 얼굴/머리/색을 적은 데이터(이미지 10~30장)로 학습.
- 사용자가 자기 캐릭터를 LoRA로 학습해 두면, 모든 텍스처 생성에 그 LoRA를 켜서 **캐릭터 정체성이 고정**된다.
- 권장 적층: **캐릭터 LoRA (0.7~0.9) + IP-Adapter (0.65) + ControlNet-Canny (1.0) + Inpaint mask**.

### 대안 — 닫힌 SaaS

- Replicate, fal.ai, Stable Diffusion API 같은 호스팅 서비스. ComfyUI를 직접 못 돌리는 환경에서.
- 빠른 부트스트랩에 유용하지만 우리의 핵심 차별점 (특정 캐릭터 LoRA + 고정 ControlNet 워크플로)을 만들기 어렵다 — SaaS API는 표준화된 입력만 받음.

## 우리 워크플로 — 표준 inpaint 파이프라인 (제안)

```
입력
  region_image: 1024×1024 (원본 region을 정사각형 캔버스에 패딩)
  region_mask:  같은 사이즈 (white = AI가 다시 그릴 영역)
  silhouette:   외곽선 (canny 입력)
  prompt:       "white tank top, side ties, soft anime shading"
  negative:     "ugly, noise, watermark"
  ref_image?:   캐릭터 참조 (IP-Adapter)

  loras: [character_lora @ 0.8, style_lora @ 0.5]
  controlnet: { canny: silhouette @ 1.0, inpaint: region_mask @ 1.0 }

처리
  base_model = "AnimagineXL" or "Pony" 등 anime fine-tune SDXL
  pipeline = StableDiffusionXLControlNetInpaintPipeline
  steps = 30, cfg = 7
  seed (사용자 변경 가능)

출력
  generated_1024.png
  → crop back to region rect 픽셀 사이즈
  → atlas page의 region rect에 in-place 덮어쓰기
  → 런타임에 텍스처 재로딩 신호
```

## 인프라 옵션

### A — 자체 ComfyUI 백엔드

- ComfyUI를 GPU 서버에 띄우고 우리 Next.js API route가 그 워크플로 JSON을 POST.
- 장점: 우리 워크플로를 자유롭게 정의 (LoRA·ControlNet·후처리 체인 조합 가능). 비용 통제.
- 단점: GPU 서버 운영 책임. ComfyUI 워크플로 디버깅 부담.

### B — Replicate / fal.ai

- 표준 워크플로(SDXL inpaint, ControlNet)는 Replicate에 모델로 등록되어 있다.
- 우리 커스텀 ComfyUI 워크플로를 Replicate에 배포할 수도 있다 (Cog).
- 장점: 인프라 책임 위임. 사용량 따라 과금.
- 단점: 라운드트립 지연(2~10초). LoRA/체크포인트 변경할 때 모델 재배포.

### C — 사용자 BYO (Bring Your Own)

- 사용자가 로컬 ComfyUI나 A1111을 띄워두고 우리는 그 endpoint URL만 받는다.
- 장점: 우리 인프라 비용 0. 고급 사용자 만족도 높음.
- 단점: 일반 사용자는 못 씀. 내부 모델 호환성 책임이 사용자에게.

### D — 클라이언트 사이드 (브라우저 GPU)

- WebGPU + ONNX Runtime Web으로 SDXL 추론. 2026 시점 quantized SDXL이 가능.
- 1024 inpaint 30 step → 데스크톱 RTX급 GPU에서 ~30초~1분, M-series Mac에서도 가능.
- 장점: 인프라 0, 프라이버시 완전 보장.
- 단점: 첫 로드 느림 (수 GB 모델), LoRA 합성 까다로움, 모바일 사실상 불가.

**1차 결정**: B (Replicate) → 사용량 검증 후 A (ComfyUI 자가호스팅)으로 이전이 자연스럽다. C/D는 옵션으로 남겨둔다.

## 후처리 — AI가 끝이 아니다

- **Color match**: 생성된 region이 기존 atlas의 톤과 어긋나면 어색하다. 인접 region의 평균 색을 샘플해서 LAB color transfer를 가볍게.
- **Edge feather**: alpha 경계가 너무 날카로우면 런타임에서 calipping이 보임. 1~2px feather.
- **Resolution snap**: SDXL는 1024를 좋아하지만 atlas region은 임의 사이즈. 항상 1024 정사각형 패딩 → 생성 → unpadding crop.
- **Format**: PNG (sRGB, 8bit). 알파 채널 보존.

## [VERIFY]

- ComfyUI 워크플로 JSON을 Next.js API에서 trigger하는 표준 라이브러리 (예: `comfyui-api-js` 같은 게 있는지)
- Replicate에 우리 ComfyUI 워크플로(여러 ControlNet + 여러 LoRA 적층)가 그대로 deploy되는지, 아니면 평탄화 필요한지
- 캐릭터 LoRA를 사용자가 우리 UI에서 학습할 수 있게 할지(별도 큰 작업) 아니면 외부에서 학습한 LoRA 파일만 받을지
