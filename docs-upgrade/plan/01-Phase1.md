# 01 — Phase 1 실행 계획

**목표**: 데이터 모델 / UI 구조는 그대로 두고, 현재 per-layer 편집
파이프라인의 품질을 한 단계 끌어올린다. 그리고 FLUX.2를 escape
hatch로 붙여 bulk fan-out 비용 / 속도 문제의 우회로를 확보한다.

**예상 기간**: 2–3주 (취미 솔로 기준).

**선행 의존**: 없음. 지금 당장 시작 가능.

**분석 출처**:
- [docs-upgrade/05-ai-stack-survey.md](../05-ai-stack-survey.md)
- [docs-upgrade/09-phased-roadmap.md](../09-phased-roadmap.md) Phase 1

## 작업 1 — Mask erosion 적용

**왜**: gpt-image-2의 mask는 hard가 아니라 guidance. 몇 픽셀 새는 게
정상이고, 그게 atlas 내 인접 island로 새면 seam 오염이 발생한다.
4–8 px 침식하면 단순한 마진으로 거의 다 잡힌다.

**손볼 파일**:
- `lib/ai/client.ts` — `buildOpenAIMaskCanvas` 근처. 마스크 알파 반전
  처리 직후에 erosion 단계를 추가.

**구현 메모**:
- 침식은 작은 가우시안 + threshold로 충분. SAM 같은 무거운 거 불필요.
- 침식 폭은 default 6 px, atlas rect 크기에 따라 4–8 px 스케일.
  (atlas rect의 짧은 변 길이 / 100 정도로 적당히 비례.)
- worker로 빼지 않아도 됨. 한 번에 1024×1024 한 장 처리 = 비싸지 않음.

**검증**:
- Hiyori 머리에서 인접 머리 두 drawable을 각각 편집. 침식 전후의
  결과를 픽셀 단위로 diff. 침식 후엔 인접 atlas pixel의 변경이
  거의 0이어야 함.
- 20개 샘플 편집을 눈으로 보고 seam 오염 비율이 5% → <1%로
  떨어지는지 확인.

## 작업 2 — Canonical-pose render를 image[2]에 추가

**왜**: 현재 generate call은 atlas crop만 보낸다. 모델은 그 crop이
"무엇의 어디"인지 모른다. 캐릭터 전체 렌더를 image[2]로 같이
보내면 "이 머리가 어떤 얼굴을 감싸는지" 같은 공간 맥락이 들어간다.

**손볼 파일**:
- `lib/avatar/Live2DAdapter.ts` — `renderToCanvas({ width: 1024 })`
  같은 메서드가 이미 있는지 확인 ([VERIFY]). 없으면 추가. 썸네일
  파이프라인이 같은 기법을 쓰고 있을 거임.
- `lib/avatar/canonicalPose.ts` (신설) — 세션당 1회 렌더하고 Blob을
  메모리/IDB에 캐시. 무효화 룰은 layerOverrides 해시 기반.
- `components/GeneratePanel.tsx` (또는 그 generate 호출 지점) —
  `image[]` 배열 구성 시 `image[2]` 슬롯에 canonical pose 추가.
- `lib/ai/client.ts` — provider 어댑터들이 image[2]를 받아 넘기는지 확인.

**구현 메모**:
- 첫 generate 호출 직전에 lazy로 렌더. blob을 sessionCache에 저장.
- IDB `canonicalPoseRender` 스토어는 Phase 2와 같이 만들 거라서
  Phase 1에서는 메모리만으로도 OK. 다만 다음 세션에서도 재사용하고
  싶다면 가벼운 IDB 저장 추가해도 됨.
- `parametersHash` + `overridesHash`로 무효화. 둘 중 하나 바뀌면 regen.

**검증**:
- generate panel을 통해 만든 모든 호출에 image[2]가 실제로 들어가는지
  네트워크 탭에서 확인.
- canonical render가 세션당 1회만 발생하는지 콘솔 로깅으로 검증.

## 작업 3 — Canny silhouette를 image[4]에 추가 (옵션)

**왜**: "outline 유지, 안쪽 redraw" 류 의도에서 silhouette 레퍼런스가
도움 됨. image budget이 4개라 항상 넣진 못하고, 의도가 명확할 때만
켠다.

**손볼 파일**:
- `lib/ai/canny.ts` (신설) — 작은 OpenCV.js 또는 직접 sobel + nms로
  구현. 의존 추가 없이 직접 구현이 가볍다.
- 호출 지점에서 토글 (현재는 GeneratePanel의 advanced 옵션).

**구현 메모**:
- 항상 켜진 상태로 두지 말 것. anchor 결과를 image[3]에 넣어야 하는
  Phase 3 흐름에선 슬롯 경합이 생긴다. user 옵션으로 빼두고 default
  off.

**검증**:
- silhouette on/off 비교 결과를 같은 prompt에서 30개 측정.
  outline 일치율이 켰을 때 더 높은지 확인. 아니면 의미 없음 → 제거.

## 작업 4 — FLUX.2 Edit provider 추가

**왜**: bulk fan-out / 저비용 escape hatch. 20-드로어블 머리 recolor를
gpt-image-2로 다 돌리면 ~$0.80, FLUX.2 Schnell이면 ~$0.06.

**손볼 파일**:
- `lib/ai/providers/falai.ts` (신설) — 기존 openai / gemini / replicate
  scaffold와 동일한 인터페이스 구현. fal-client SDK 사용.
- `lib/ai/providers/index.ts` — 새 provider 등록.
- `components/Settings/Providers.tsx` (기존 provider 설정 UI) —
  fal.ai 키 입력란 추가.
- `components/GeneratePanel.tsx` — provider 선택 드롭다운에 노출.

**구현 메모**:
- 의존: `pnpm add @fal-ai/client`. (정확한 패키지명은 작업 시점에
  fal 문서 확인.)
- API 키는 localStorage / IDB 안전 저장 패턴 기존거 그대로 사용.
- mask 컨벤션 일치하는지 검증 ([05](../05-ai-stack-survey.md)
  "Mask conventions" 참조).

**검증**:
- 같은 prompt + 같은 mask로 openai-gpt-image-2 와 fal-flux2 둘 다
  실행하고 결과 5개 비교. 품질 차이 메모.
- 비용 / 지연 차이 실측. 예상치 (gpt $0.04 / 15s vs flux $0.003 / 2s)
  과 일치하는지.

## 작업 5 — Provider routing 규칙

**왜**: 항상 OpenAI = 비싸고 느리다. 사용자가 매번 provider를
고르는 것도 피곤하다. 자동 라우팅 룰을 두면 사용자가 의식하지
않고도 좋은 default를 얻는다.

**손볼 파일**:
- `lib/ai/router.ts` (신설) — 단순 함수. 입력: `GenerateRequest`,
  출력: `ProviderId`.
- generate 진입점에서 호출.

**구현 메모**:
- v0 룰 (Phase 1 한정):
  - 단일 drawable 편집 = openai-gpt-image-2 (literal).
  - GeneratePanel "bulk" 모드 (다중 선택 후 일괄) = fal-flux2-schnell.
  - 기타 = default = openai-gpt-image-2.
- 사용자가 명시적으로 provider를 골랐으면 라우터 우회.

**검증**:
- 시나리오 5개에서 의도한 provider로 라우팅되는지 콘솔 로깅으로 확인.

## 작업 6 — OpenAI prompt에 Cubism 컨텍스트 추가

**왜**: 현재 prompt는 일반 이미지 편집 prompt다. "이건 layered
2D rigged puppet의 한 부분이다, silhouette 그대로 둬라"라는 한 줄을
넣어주는 것만으로 의도 보존이 눈에 띄게 좋아진다.

**손볼 파일**:
- `lib/ai/prompts/edit_template.txt` (신설; 기존 prompt 파일이 어디
  있는지 먼저 확인).
- 현재 prompt 구성 코드 (`lib/ai/client.ts` 혹은 GeneratePanel 내부).

**구현 메모**:
- 템플릿 슬롯 구조는 [10](../10-prompt-engineering.md)의
  "Image-edit prompt — template" 그대로. Phase 1에선 sequential refs /
  palette 슬롯은 비워둠.
- prompt versioning 시작 — `edit_template.v1.txt`.

**검증**:
- 동일 입력에서 old prompt vs new prompt 결과 비교. outline 보존도
  / 색 충실도 / 스타일 일치도를 5명 reviewer로 A/B (5명 못 모으면
  나 혼자라도).

## 작업 7 — 진행 UI 개선

**왜**: 3개 이상 호출이 sequential하게 도는 흐름이 Phase 3에 들어오기
전에 미리 progress 표시 컴포넌트를 정비해두면 Phase 3에서 그대로
재사용 가능.

**손볼 파일**:
- `components/GeneratePanel.tsx` — 다중 selection 일괄 편집할 때 보일
  per-call progress bar 추가.
- 새 컴포넌트 `components/ProgressStack.tsx` (신설).

**구현 메모**:
- 각 호출의 상태: queued | running | done | failed.
- per-call 시간 측정 / 출력.
- 실패 시 retry 버튼.

**검증**:
- 5장 일괄 편집 시나리오에서 UI가 끊기지 않고 부드럽게 갱신되는지.

## Ship criteria — Phase 1 종료 조건

다음이 다 만족돼야 Phase 2 착수.

- [ ] Atlas 인접 seam 오염 비율 <1% (20개 샘플 시각 검사).
- [ ] 모든 OpenAI generate call에 canonical-pose render가
      image[2]로 첨부됨.
- [ ] FLUX.2 Edit provider가 동작하고 setting에서 키 입력 가능.
- [ ] 기존 5개 빌트인 샘플 + 본인 보유 모델 3개로 smoke test
      통과 (기존 워크플로 깨지지 않음).
- [ ] OpenAI prompt가 v1 템플릿으로 통일됨.

## 위험 / 차단 요소

| 위험 | 대응 |
|---|---|
| pixi-live2d-display의 renderToCanvas가 없거나 깨짐 | 썸네일 코드 베이스 확인. 안 되면 hidden Pixi app 만들어서 직접 렌더 |
| fal-client SDK가 mask convention이 다름 | provider 어댑터에서 변환. mask 알파 반전 / 8-bit 변환 추가 |
| 침식이 너무 강해서 작은 drawable이 다 깎임 | 침식 폭을 rect 짧은 변 / 100으로 비례. 최소 2 px / 최대 8 px clip |
| OpenAI prompt 변경이 기존 결과 품질 떨어뜨림 | A/B로 검증 후 머지. 떨어지면 롤백 |

## 작업 순서 권장

1. 작업 1 (mask erosion) — 가장 작고 risk 낮음. 워밍업.
2. 작업 4 + 5 (FLUX.2 provider + router) — 다음 작업 의존성 적음.
3. 작업 2 (canonical pose) — 약간 까다로움. 작업 6과 같이 묶어서 PR.
4. 작업 6 (prompt 정비).
5. 작업 7 (progress UI) — Phase 3 준비.
6. 작업 3 (canny) — 시간 남으면.

## 다음 단계로 가기 전 점검

Phase 1 종료 시 진행기록 ([06-진행기록.md](06-진행기록.md))에
다음을 채워둘 것:

- 침식 적용 전/후 seam 비율 측정값.
- canonical pose가 결과 품질에 끼치는 인상 (정량 어려우면 정성).
- FLUX.2 vs gpt-image-2 비용 / 지연 / 품질 실측.
- 다음 Phase 설계에 영향 주는 점 (있으면).
