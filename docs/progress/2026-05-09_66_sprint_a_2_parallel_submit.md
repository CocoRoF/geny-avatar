# 2026-05-09 — Sprint A.2: Parallel multi-component submit + composite

[`64 multi_component_kickoff`](2026-05-09_64_multi_component_kickoff.md) 의 두 번째 atomic sprint. A.1 의 라이브러리(`prepareOpenAISourcesPerComponent` / `compositeProcessedComponents`) 를 GeneratePanel 의 OpenAI 경로에 통합. UI는 그대로, 자동 분리 + N 병렬 호출 + composite 가 처음 동작.

## 변경 surface

### `lib/ai/client.ts`

- 신규 `compositeProcessedComponents({ componentBlobs, sourceCanvas }) → Promise<Blob>`
  - per-component postprocess 결과 N개를 source-canvas-sized 단일 canvas로 source-over composite
  - final alpha-enforce against full source canvas — binary mask가 잃은 AA edge를 원본 alpha로 복원
  - 단일 component면 length-1 배열 그대로 통과 → output 동일

### `components/GeneratePanel.tsx`

- import: `padToOpenAISquare` / `prepareOpenAISource` 제거 → `prepareOpenAISourcesPerComponent` + `compositeProcessedComponents`
- `openAIPaddingRef` (단일 padding/bbox 보관) 제거 → `lastComponentCountRef` (진단용 카운터)
- `onSubmit`:
  - OpenAI: `prepareOpenAISourcesPerComponent` 호출 → N개 component
  - 각 component마다 `submitGenerate` 병렬 (Promise.all) — 같은 prompt / 같은 refs / 같은 refined prompt 가 모든 호출에 분배
  - 각 결과는 `postprocessGeneratedBlob` 으로 자기 component의 sourceBBox 위치에 paint, alpha-enforce는 component 의 binary mask 기준
  - 마지막에 `compositeProcessedComponents` 로 N blob → 단일 source-canvas-sized blob
  - phase succeeded 에 그 composite blob 들어감
- `onApply`: 변경 X — 이미 합성된 `phase.blob` 그대로 store에 set
- `onRevisit`: `lastComponentCountRef.current = 0` 으로 reset (saved blob은 단일 처리됨)

### Gemini 경로

변경 없음. single source + raw mask 그대로. `geminiSourceBlob` / `geminiMaskBlob` 변수만 명명 정리.

### 진단 로그

- `console.groupCollapsed` 헤더에 `components=N` 표시
- multi-component case: 각 component의 `sourceBBox / paddingOffset / area / paddedDim / isolatedPreview` 출력. `isolatedPreview` 는 `toDataURL` 로 즉시 보여주는 data URL — DevTools preview에서 직접 thumb 확인 가능
- single Gemini case: 기존 `image[0]` info 유지

## 의도적 한계

- **N개 호출 = N배 cost**: 사용자에게 명시적 알림 X (A.3에서 region UI와 함께 추가). 일단 콘솔 로그로 확인 가능.
- **Same prompt for all components**: 사용자가 프롬프트에 region 별 구분 (e.g. "torso는 X, frill은 Y") 써도 모든 component가 그 전체를 받음 → 모델이 자기 region 에 해당하는 부분만 적용해야 함. A.3 에서 region-aware UI 가 이 분배를 명시화.
- **Same refined prompt**: refinement는 full source 한 번만 수행 → 모든 component 호출에 같은 refined 텍스트. A.4 territory.
- **History blob = 합성된 final**: per-component 별도 저장 X. revisit 시 단일 blob 만 복원.
- **Progress 표시**: phase 그대로 `running` — 1/N, 2/N 같은 progress bar 없음. 작은 quality of life 개선 후속.

## 검증

- typecheck 통과
- biome 통과
- `next build` 통과

## 시각 검증 가이드 — 이 sprint의 핵심

```bash
git pull && pnpm install && pnpm dev

# 1. 사용자가 봤던 multi-island layer 로 다시 시도
#    (상체 torso + 어깨 frill 같이 들어있는 atlas slot)
# 2. references 첨부, prompt 입력, generate
# 3. dev 콘솔 [ai/submit] 그룹 expand:
#    - "source split into 2 component(s)" 같은 로그
#    - 각 component의 sourceBBox / paddingOffset / isolatedPreview 확인
#    - isolatedPreview 의 data URL을 클릭해서 → 실제로 한 island만 살린 thumb 가 보이는지 검증
# 4. RESULT 미리보기:
#    - 이전엔 큰 비스티에가 source canvas 전체에 페인트되고 island 형태로 cookie cutter 됨
#    - 이제는 각 island가 자기 frame을 꽉 채워 받아 → torso와 frill 이 각자 적절히 그려진 결과
# 5. apply → atlas 에도 같은 결과
```

만약 component 가 너무 잘게 쪼개지면 (예: AA edge 노이즈로 1px 단편들이 component 가 됨) `findAlphaComponents` opts.minArea 를 더 높게 호출하도록 조정 필요. 현재 default 64 px.

다음: A.3 — multi-component layer 일 때 GeneratePanel UI 가 component 별 sub-prompt 입력칸을 띄움.
