# 2026-05-09 — Multi-component aware generation Kickoff

## 컨텍스트

[`63 openai_alignment_fix`](2026-05-09_63_openai_alignment_fix.md) 가 silhouette tight-crop + preview parity로 single-component layer의 위치/크기 mismatch 를 잡았지만, 사용자가 **disjoint silhouette 둘 이상**을 한 layer로 가진 케이스에서 새 문제 노출:

> "이 텍스처는 상반신 텍스처이고 프릴 같은 것들은 어깨 부분의 텍스처 검정색 (좌상단)은 상반신의 텍스처야."

이 layer의 source canvas:
- island A: 좌상단 큰 검정 torso
- island B: 우중앙 작은 흰 frill

`tightSilhouetteCrop` 이 두 island의 **union bbox** 를 계산 → 거의 캔버스 전체. 1024² pad 후 모델은 "거의 빈 캔버스 + 작은 점 둘"로 보고 한 개의 큰 subject (검정 비스티에)를 가운데에 그림. composite 시 union bbox 영역에 큰 결과를 paint → alpha-enforce가 island 두 개 silhouette만 살림 → island 모양으로 cookie cutter된 비스티에 조각만 남음.

**근본 원인**: 파이프라인이 layer를 "단일 시각 단위"로 가정. atlas에서 disjoint silhouette을 가진 layer엔 깨짐.

## 결정 (사용자 선택)

**A + B 정공**:
- A: connected component labeling으로 island 자동 분리 → per-island OpenAI 호출 → 각자 자기 bbox로 composite
- B: multi-component layer일 때만 region-aware UI (component별 sub-prompt 입력)

C (composite-grid 단일 호출) / D (시각 hint hack) 기각. E (사용자 split 도구) 는 장기 Phase 6/7로.

## Sub-sprint 분할

각 sprint atomic PR. validate 후 진입.

### Sprint A.1 — Connected component utility + per-component prep

기반 라이브러리.

- `lib/avatar/connectedComponents.ts` (신규)
  - `findAlphaComponents(canvas, opts) → ComponentInfo[]`
  - 8-connected flood fill on `alpha >= alphaThreshold`
  - 각 component: `{ id, bbox: {x,y,w,h}, area: number, maskCanvas: HTMLCanvasElement }`
  - `maskCanvas`: 그 component만 alpha 살린 source canvas-sized binary mask (다른 component 제거된 isolated source 만들 때 multiply)
  - opts: `minArea` (default 64 px), `alphaThreshold` (default 1)
- `lib/ai/client.ts` 에 `prepareOpenAISourcesPerComponent(sourceCanvas) → ComponentSource[]`
  - 각 component:
    - `componentSource = sourceCanvas` × `component.maskCanvas` (alpha multiply) → 그 component만 살린 isolated canvas
    - `prepareOpenAISource(componentSource)` 적용
    - 결과: `{ component, padded, paddingOffset, sourceBBox }`
  - 단일 component면 길이 1 배열 (기존 `prepareOpenAISource` 와 등가)
  - `prepareOpenAISource` 자체는 그대로 유지

이 sprint는 라이브러리만. UI 변경 없음. 단일 component layer 동작 그대로.

### Sprint A.2 — Parallel multi-submit + composite

GeneratePanel의 generation pipeline 수정.

- OpenAI 경로에서:
  1. `prepareOpenAISourcesPerComponent` 호출 → N개 component source
  2. 각 component마다 `submitGenerate` 병렬 (Promise.all)
  3. 결과 N blob → 각각 `postprocessGeneratedBlob` 으로 component의 sourceBBox 위치에 paint
  4. 모든 결과를 source-canvas-dim target에 union composite
  5. final alpha-enforce against full source canvas
- N=1 케이스는 기존 single-flow와 결과 동일 (regression 방지)
- 진단 로그: component 개수, 각각의 bbox/size
- API cost: 호출 N배 → UI에 "N regions detected — N OpenAI calls" 표시
- `phase` 상태 확장: `running` 시 "running 1/3..." 같은 progress 표시 가능 (시간 허락하면)

이 sprint 후엔 multi-component layer가 자동 동작 — 사용자 prompt는 그대로 N개 호출에 동일 분배. 다음 sprint가 component별 prompt 분리.

### Sprint A.3 — Region-aware UI

multi-component layer일 때 GeneratePanel UI 변경.

- `components.length > 1` 감지 시:
  - PROMPT 영역 → "common context" + 각 component별 sub-prompt textarea
  - 각 sub-prompt 옆에 component thumbnail (tight crop)
  - submit 시 component의 prompt = `${commonContext}\n\nThis region: ${componentPrompt}` 형태로 결합
- refinement (있으면) 도 component별로 — 각 component context (thumbnail + per-prompt + refs) 를 chat에 보내 component별 refined prompt 받음
- single component layer는 UI 그대로 (기존 단일 textarea)

이 sprint 후엔 사용자가 "torso는 X처럼, frill은 Y처럼" 명시적으로 분리 표현 가능.

### Sprint A.4 (선택, 별도) — Region-aware refinement

A.3까지 마치고 사용자 검증 후 결정. refinement endpoint를 multi-region 버전으로 확장. component마다 별도 chat 호출 또는 단일 호출에서 structured JSON 응답 (`{ regionA: refined, regionB: refined, ... }`).

## 의도적 한계

- **Component 정의 = alpha 8-connected**: 의미적으로 분리되어야 할 region이 alpha로 연결되어 있으면 하나로 잡힘 (예: torso와 frill이 lace 한 줄로 연결된 atlas). 사용자가 직접 split하는 도구 (Phase 6/7 E) 는 이 케이스 위해 필요.
- **API cost N배**: component 5개면 5번 호출. 사용자에게 명시 — 동의 시 진행. 큰 layer엔 "split into single layer first" 권장.
- **N component 크기 차이 큼**: torso는 큰데 frill은 작음. 큰 component는 1024²에서 dense, 작은 component는 1024²에 작은 점 + 큰 padding (frill이 작으면). 작은 component도 1024²의 frame을 채우게 padding ratio 조정 검토 필요. 일단 기본 `prepareOpenAISource` 사용.
- **Composite order**: union composite는 disjoint이라 순서 무관. 만약 future에 overlapping 처리 필요해지면 별도.
- **History**: per-component result도 IDB에 저장? 일단 final composite만 저장 — component별 분리 history는 over-engineering.

## 예상 산출물

A.1~A.3 끝나면:
- 다중 island layer가 자동 분리되어 각 island마다 1024² 의 full attention 받음 — 위치/크기 정렬 정확
- 사용자가 component별 prompt 분리 가능 — "torso는 ..., frill은 ..." 일관성 있게 분배
- single-component layer는 그대로 (regression 없음)

## 다음 단계

Sprint A.1 — connected component utility + source prep 부터. UI 변경 없는 무난한 라이브러리 sprint.

## 진행 추적

| Sprint | 주요 작업 | 상태 |
|---|---|---|
| A.1 | Connected component util + per-component source prep | 대기 |
| A.2 | Parallel multi-submit + composite | 대기 |
| A.3 | Region-aware UI | 대기 |
| A.4 (선택) | Region-aware refinement | 미정 |
