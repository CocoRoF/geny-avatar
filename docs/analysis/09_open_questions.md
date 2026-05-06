# 09 — Open Questions

해소되지 않은 질문 모음. analysis/plan 문서 곳곳의 `[VERIFY]` / `[OPEN]` 마커가 여기로 모인다. 해결되면 원 문서를 갱신하고 여기서 제거.

## 라이선스 — hobby 단계에서는 차단 요인 아님

**우리는 1인 hobby 개발자라 Live2D 샘플 EULA의 General User, Spine 런타임의 evaluation 범주에 자연 통과한다.** 아래 항목들은 미래에 스코프가 커질 때 (공유 갤러리, 결제, 상업 배포) 다시 봐야 할 보존용 메모.

| ID | 질문 | 미래 트리거 |
|---|---|---|
| L1 | Spine 런타임 평가 라이선스가 우리 결과물 배포 시점에도 적용되는가 | 공개 데모/배포 시점 |
| L2 | Live2D Sample EULA의 small-scale enterprise 정의 | 사업자 등록·매출 발생 시점 |
| L3 | Live2D 샘플 모델의 modification·export 조항 | 사용자에게 우리가 만든 변형을 배포 시점 |
| L4 | Cubism Core JS+wasm을 정적 호스팅하는 distribution 조항 | 공개 사이트 배포 시점 |

지금은 코드 진행에 영향을 주지 않는다.

## 기술 — 구현 전 검증 필요

| ID | 질문 | 영향 |
|---|---|---|
| T1 | Live2D Drawable의 textureIndex를 런타임에서 다른 PNG로 핫스왑할 수 있는가 | 안 되면 atlas 통째 교체로 우회 — UX 거칠어짐 |
| T2 | Spine MeshAttachment의 UV가 region rect 밖으로 회전 패킹 시 어떻게 좌표변환되는가 | atlas 재패킹 알고리즘 정확도 |
| T3 | Live2D Drawable UV가 사각형인지 임의 다각형인지 | "rect 덮어쓰기" 옵션 1이 통하는지의 전제조건 |
| T4 | Spine MeshAttachment를 런타임에서 새 attachment로 교체할 때 본 가중치 자동 매핑 여부 | "이 슬롯에 새로 그린 메시" 기능 가능 여부 |
| T5 | SAM의 web inference 비용 — WebGPU 클라이언트 vs 서버 | 분해 워크플로의 응답성 |
| T6 | ComfyUI 워크플로 JSON을 Next.js API에서 trigger하는 표준 라이브러리 | AI 백엔드 통합 작업량 |
| T7 | Replicate에 다중 ControlNet + 다중 LoRA 워크플로가 그대로 deploy되나 | SaaS 옵션 가능성 |
| T8 | NIKKE visualiser의 "Fix broken animation" 버튼이 정확히 무엇을 하는지 | Spine 버전 호환성에서 우리도 같은 이슈를 만날지 |
| T9 | Cubism Web SDK 5와 `untitled-pixi-live2d-engine` / `pixi-live2d-display` 호환성 매트릭스 (모델 버전 vs 런타임 버전) | Cubism 어댑터 구현·Cubism 2/3 best-effort 범위 |
| T-rt1 | Spine + Live2D 런타임이 같은 Pixi Application stage에 동시 마운트 가능한가 (GL state 충돌) | Phase 0 PoC에서 검증 |
| T-rt2 | Spine 3.8 모델을 spine-pixi-v8(4.x)이 silent break 없이 받는가 | 업로드 day-1 자산 호환 범위 |

## 스코프 — 명시적 결정 필요

| ID | 질문 |
|---|---|
| ~~S1~~ | ~~Spine vs Live2D 1차 선택~~ — **확정**: P1로 둘 다 1차 ([README](../README.md)) |
| S2 | AI 백엔드: 자체 ComfyUI / Replicate / BYO / 클라이언트 사이드 — 어느 것부터? |
| S3 | 사용자가 자기 LoRA를 학습하는 기능을 우리가 제공할지, 아니면 외부 학습된 LoRA만 받을지 |
| S4 | "공유 갤러리"를 만들지 (만들면 라이선스 정책이 훨씬 복잡) |
| S5 | 모바일 지원 범위 — 데스크톱 first vs 반응형 |
| S6 | 인증/계정 시스템 필요한지 (사용자 자산을 서버에 저장할 것인지에 따라) |

S1·S2는 [plan/03_tech_stack](../plan/03_tech_stack.md)에서 결정 시도.

## UX — 추후 사용자 검증 필요

| ID | 질문 |
|---|---|
| U1 | "Atlas 분해" 워크플로를 일반 사용자가 견디는가 — 마스킹 UI를 얼마나 단순화해야 하나 |
| U2 | AI 텍스처 결과를 매번 보고 사용자가 "다시 만들기"를 몇 번이나 반복하는 게 UX적으로 받아들여지나 (1번? 5번? 20번?) |
| U3 | export 결과물을 다시 Cubism Editor / Spine Editor에서 열 수 있어야 하나 (round-trip 호환), 아니면 런타임 컨섬프션 전용으로 충분한가 |

## 메타 — 프로젝트 운영

| ID | 질문 |
|---|---|
| M1 | geny-executor / Geny와 어떤 관계? 별개 프로젝트인가, 아니면 어느 시점에 공통 인프라(예: AI 백엔드)를 공유? |
| M2 | 팀 사이즈는 1인 (현재) — 단계별 PR 사이즈를 어떻게 잡을 것인가 |

## 해소 우선순위

**Phase 0 종료 전에 해소해야 하는 것**: T-rt1 (동시 마운트), T-rt2 (Spine 3.8 호환), T1·T3·T9 (런타임 검증), S2 (AI 백엔드).
S1은 P1으로 무효화. 라이선스 L1~L4는 hobby 단계에서 차단 요인 아님.

**Phase 1 진입 전에 해소해야 하는 것**: 위와 동일. Phase 0 PoC가 이걸 다 본다.

**그 외**: 진행하면서 자연스럽게 해소.
