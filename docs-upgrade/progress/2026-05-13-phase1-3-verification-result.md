# 2026-05-13 Phase 1 Criterion 3 검증 결과 — FLUX provider quality 평가

**Phase / 작업**: Phase 1 closure 검증 결과 정리
**상태**: done (criterion 3 결과 확정, 다음 path는 사용자 결정 대기)
**관련 계획**: [../plan/01-Phase1.md](../plan/01-Phase1.md) +
[2026-05-12-phase1-closure.md](2026-05-12-phase1-closure.md)

## 검증 흐름

사용자가 fal.ai FAL_KEY 세팅 후 같은 모델 / 같은 prompt (`white
hair`)로 4번 시도:

| 시도 | 결과 | 원인 | Fix |
|---|---|---|---|
| 1 | 403 잔액 부족 | 환경 / 결제 | 사용자 잔액 충전 |
| 2 | `status 405` | URL 자체 구성 오류 | [#9](https://github.com/CocoRoF/geny-avatar/pull/9) submit response의 URL 사용 |
| 3 | `/api/ai/status/{id}` 404 | jobs Map module 분리 | [#10](https://github.com/CocoRoF/geny-avatar/pull/10) globalThis singleton |
| 4 | character 전체 stamp | canonical-pose ref가 FLUX에 misread | [#11](https://github.com/CocoRoF/geny-avatar/pull/11) prompt scaffold + [#12](https://github.com/CocoRoF/geny-avatar/pull/12) canonical-pose 제외 |
| 5 | silhouette 안에 face hallucinate | source-only도 FLUX이 thumbnail로 인식 | [#13](https://github.com/CocoRoF/geny-avatar/pull/13) character feature 금지 강제 |
| 6 | **흰 머리 텍스처 정상 출력** | — | — |

## 최종 결과 (2026-05-13)

✓ **Criterion 3 기본 ship 통과**:
- FLUX.2 [edit] provider가 picker에 노출되고 키 가용성에 따라 선택
  가능.
- `white hair` prompt에 silhouette 안에 character 없이 깨끗한 흰
  머리 텍스처 출력.
- end-to-end 흐름 (submit → poll → result fetch → atlas composite)
  완주.

⚠️ **남은 quality 한계** (ship 차단 아님, known limitation):
1. **silhouette 외곽 1-2 px outline 갈색 잔존**. anime outline 보존
   경향. erode radius 약하게 적용된 결과로 일부 보임.
2. **silhouette tendril 끝부분 일부 손실**. FLUX이 좁고 모호한 alpha
   영역을 "주변" 또는 "background"로 분류. 사용자가 보여준 result에
   회색 빈 영역으로 시각화.
3. **외곽 quality는 OpenAI gpt-image-2에 비해 떨어짐**. atlas-crop
   use case에 FLUX-2 edit이 100% fit 안 됨.

## 사용자 피드백

> "사진과 같이 나왔어. 다만 뭔가 좀 아쉬운 느낌이 있어. 사진 2의
> 회색 부분은 원본 크기보다 작아진 빈 공간들이야. 또한 controlnet
> 같은 것도 제대로 좀 이용하든지 좀 제대로 업그레이드 해야만 할 듯
> 해."

핵심:
- 결과 수용 (character hallucination 해소).
- 외곽/tendril 손실은 받아들이지만 **ControlNet 같은 mask-aware 업
  그레이드** 의향 표현.

## 후속 작업 옵션

closure entry의 "Phase 1.x 추가 백로그" 섹션에 3개 옵션 정리:

### Option A — mask-aware FLUX 모델 도입 (사용자 명시 요청)

- `falai` provider에 모델 옵션 확장 (`flux-2-edit` + `flux-controlnet-inpainting`
  등 enum).
- mask blob 채널을 명시 활용 (현재 FLUX은 mask 무시).
- 후보 모델:
  - `fal-ai/flux-controlnet-inpainting` (있다면 — alimama-creative 기반).
  - 또는 fal.ai 카탈로그의 다른 mask-aware FLUX 변종.
- 작업량 추정: 새 모델 endpoint 조사 + provider 코드 분기 + UI에
  모델 선택지 추가. ~1-2 PR.

### Option B — source 전처리 강화

- `prepareOpenAISource`의 padded square (1024² + neutral BG) 를 FLUX
  path에도 적용.
- tendril 같은 좁은 영역을 padding으로 둘러싸 FLUX이 "frame 일부"로
  인지.
- 작업량 추정: GeneratePanel onSubmit 분기 통합 + postprocess 일관성
  확인. 1 PR.

### Option C — 책임 재배분 (가장 보수적)

- Phase 1.4의 ship 의미를 "FLUX provider 가용성"으로 한정.
- Phase 3 orchestrator의 cheap provider (bulk fan-out) 단계에서 FLUX
  quality 본격 검증. 단일 layer 편집에선 OpenAI 권장 안내.
- 코드 변경 0. plan 문서에 안내 + 진행 로그 한 줄.

## 다음 단계 (사용자 결정 필요)

1. **Phase 2 진입** — semantic group + tint fast-path. FLUX 한계는
   Phase 1.x 백로그로 둠.
2. **Option A (ControlNet) 먼저** — Phase 1.x 추가 PR로 mask-aware
   모델 도입.
3. **Option B (source padding) 먼저** — 더 작은 변경으로 quality
   향상 시도.

## 참조

- 손댄 파일: closure entry 갱신만.
- PR: 이 entry가 포함된 PR이 머지될 때 main에 들어감.
