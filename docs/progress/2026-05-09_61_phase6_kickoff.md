# 2026-05-09 — Phase 6 Kickoff: Decompose Studio Pro (SAM auto-mask)

## 컨텍스트

Phase 5 (gpt-image-2 단독 정공) 종료. V1 시나리오 A·B·C 시연 가능 + ref-anchored 캐릭터 일관성 + side-by-side 비교까지 갖춤. 다음 정공은 [`07 phased_roadmap`](../plan/07_phased_roadmap.md)의 **Phase 6 — Decompose Studio Pro**: 알파 임계 + 브러시만 있던 v1을 SAM 자동 마스크로 보강.

지금까지의 mask 흐름:
- LayerRow → DecomposeStudio 모달
- alpha threshold + paint/erase 브러시
- "save" → `editorStore.layerMasks[layer.id]`에 PNG blob

이게 V1 워크플로의 병목 — 사용자가 layer마다 직접 마스크를 그려야 함. SAM이 들어오면 한 클릭으로 후보 N개 → 선택 → 다듬기.

## SAM hosting 결정

세 옵션 비교:

| 옵션 | 비용 | latency | 설치 부담 | 품질 |
|---|---|---|---|---|
| **Replicate SAM** | ~$0.001/call (pay-per-call) | 2~5s cold start | 0 (stub 이미 있음) | ViT-H, 최고 |
| Fal.ai SAM | ~$0.0008/call | <1s warm | 신규 SDK | ViT-H, 최고 |
| 브라우저 ONNX | 0 (사용자 GPU/CPU) | 1~3s/click | encoder ~100MB 다운로드 | ViT-B, 약간 낮음 |

**결정: Replicate**. 이유:
- 이미 [`lib/ai/providers/replicate.ts`](../../lib/ai/providers/replicate.ts) stub 있음 — 폴링 메커니즘 재사용
- hobby 비용 (마스크 1번당 ~₩1.4) 무시 가능
- 100MB+ encoder 강제 다운로드 회피 — 첫 사용 UX 우선
- 자가호스팅 / Fal로 전환은 provider abstraction이라 나중에 한 PR로 가능

env: `REPLICATE_API_TOKEN`. Provider id: `replicate-sam` (생성 provider와 분리).

## Phase 6 sub-sprint 분할

각 sprint은 atomic PR — 사용자 검증 후 다음 진입.

### Sprint 6.1 — SAM provider + click-to-mask 백엔드

기반 인프라.

- 새 provider type: `sam` (기존 `image-edit` provider와 별개 채널)
- `lib/ai/sam/client.ts` — 브라우저 측 호출 헬퍼
- `app/api/ai/sam/route.ts` — Replicate SAM 모델 호출 + 폴링
- 입력: layer source PNG + click points `[{x, y, label: 1|0}]` (1=foreground / 0=background)
- 출력: top-3 mask PNG (각각 confidence 점수 포함)
- 진단 로그: 점 개수, 응답 latency, 결과 byte size

이 sprint 자체로는 UI 없음. `/poc/sam-debug` 같은 진단 페이지로 검증.

### Sprint 6.2 — DecomposeStudio click-to-segment

DecomposeStudio 모달에 SAM mode 추가.

- 새 mode 토글: `paint` | `erase` | **`segment`** (SAM)
- segment mode 시 source canvas 클릭 → 클릭 점 누적 (좌클릭 fg, 우클릭 bg)
- "auto-mask" 버튼 → SAM 호출 → 후보 3개 썸네일 노출
- 후보 선택 시 mask canvas에 적용
- paint/erase로 추가 다듬기 가능
- 점 reset 버튼

### Sprint 6.3 — Multi-mask composition

Mask boolean 합성 UX.

- 한 번 SAM 호출 → 후보 3개. 한 후보 선택 후 다른 영역 또 SAM → 새 후보 3개.
- 두 마스크를 합치는 boolean 옵션: **union** / intersection / **subtract**
- "추가 (∪)" / "교집합 (∩)" / "빼기 (−)" 버튼
- 결과 preview 즉시 갱신
- 점 누적이 점점 깊어질 때 reset 명확히

### Sprint 6.4 — Auto-decompose all layers

배치 처리.

- LayersPanel 헤더에 "auto-decompose all" 액션
- 모든 layer에 대해 SAM 자동 호출 — 입력 클릭은 layer 중심점 (또는 alpha-weighted centroid)
- 진행 표시 progress bar (N/M layers)
- 결과는 layerMasks에 일괄 적용 — 사용자는 결과 보고 layer별 fine-tune
- 실패한 layer는 표시 (alpha threshold fallback)

### Sprint 6.5 — DecomposeStudio fullscreen mode

모달 폼 → 풀스크린 라우트.

- `/edit/[id]/decompose/[layerId]` 라우트 (또는 모달의 "expand" 버튼)
- 양 옆 패널 X, 작업 영역 최대화
- 사이드바: 마스크 후보, 도구, layer 정보
- esc로 일반 모달로 복귀
- 큰 atlas (4K+) layer에서 brush precision 향상

## 예상 산출물

6.1~6.5 끝나면:
- 클릭 한 번으로 layer 마스크 생성 — alpha threshold/브러시 grind 없이
- 복잡한 마스크는 multi-click + boolean 합성으로 정밀 제작
- 모든 layer를 한 번에 자동 분해 → 수동 다듬기는 필요한 곳만
- 풀스크린 작업 환경

V1 demo flow의 시간 단축이 가장 큰 가치 — "이 의상의 shoes layer를 따로 generate" 같은 작업이 5분 → 30초.

## 의도적 한계

- **Replicate 비용**: 사용자가 SAM 호출 횟수 인지하도록 UI에 "auto-mask 호출 N회" 같은 카운터 (없으면 무절제 호출 위험). 호출별 cost 표시는 Phase 7.
- **GPU SAM 자가호스팅**: 진입 X. Replicate cold start (2~5s) 견디면 충분.
- **video segmentation**: SAM2 video는 Phase 6 out of scope. Image SAM만.
- **edge refinement (matting)**: SAM mask edge가 거친 경우 alpha matting (BackgroundMatting v2 등) 후처리는 별도 sprint. 일단 SAM raw mask + 사용자 paint/erase로 충분.

## 다음 단계

Sprint 6.1 — SAM provider + Replicate route 부터. UI는 진단 페이지로 검증한 뒤 6.2에서 DecomposeStudio 통합.

## 진행 추적

| Sprint | 주요 작업 | 상태 |
|---|---|---|
| 6.1 | SAM provider + Replicate route + click-to-mask 백엔드 | 대기 |
| 6.2 | DecomposeStudio segment mode (click → 후보 3) | 대기 |
| 6.3 | Multi-mask boolean composition | 대기 |
| 6.4 | Auto-decompose all layers (batch) | 대기 |
| 6.5 | DecomposeStudio fullscreen mode | 대기 |
