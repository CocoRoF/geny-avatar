# 2026-05-09 — Sprint A.1: Connected component utility + per-component source prep

[`64 multi_component_kickoff`](2026-05-09_64_multi_component_kickoff.md) 의 첫 atomic sprint. layer가 disjoint silhouette을 여럿 가질 때 자동으로 island를 분리하는 라이브러리 한 단. UI / submit pipeline 변경 없음 — 단일 component 동작 그대로.

## 변경 surface

### `lib/avatar/connectedComponents.ts` (신규)

8-connected union-find 라벨링.

- `findAlphaComponents(canvas, opts) → ComponentInfo[]`
  - 2-pass union-find: pass 1 provisional + 동등 등록, pass 2 root collapse + bbox/area 누적
  - 각 component: `{ id, bbox, area, maskCanvas }`. `maskCanvas` 는 source-canvas-sized binary mask (255 inside / 0 outside)
  - opts: `alphaThreshold` (default 1), `minArea` (default 64 px), `connectivity` (default 8)
  - area 내림차순 정렬 → 가장 큰 island가 id 0
  - fully transparent canvas → `[]` 반환

- `isolateWithMask(source, maskCanvas) → HTMLCanvasElement`
  - `destination-in` GPU composite로 mask 영역만 살린 isolated canvas 생성
  - per-component source canvas를 이걸로 만듦

### `lib/ai/client.ts`

- 신규 `prepareOpenAISourcesPerComponent(source, opts) → Promise<PreparedComponent[]>`
  - `findAlphaComponents` 로 island 검출
  - 각 island마다: `isolateWithMask` → `prepareOpenAISource` 적용 → submit-ready package
  - 결과 `PreparedComponent` 한 entry: `{ componentId, sourceBBox, area, padded, paddingOffset, componentMaskCanvas, isolatedSource }`
  - single-component layer면 길이 1 배열 (functionally identical to `prepareOpenAISource`)
  - fully transparent fallback: 단일 component 만들어 legacy path 유지 → 파이프라인 dead-end 방지
  - dynamic import — `connectedComponents` 모듈은 multi-component path 사용 시에만 번들링

## 의도적 한계

- **8-connected 만**: 4-connected는 thin diagonal silhouette을 stack of one-pixel components로 쪼개므로 X. 사용자가 picky한 case에 opts.connectivity로 override 가능.
- **minArea = 64 default**: AA edge fragment / atlas gutter noise 필터. 매우 작은 의도된 component (1px thick lace) 은 못 잡을 수 있음 — 그땐 minArea 낮춰서 호출.
- **순수 라이브러리만**: A.2가 GeneratePanel에 통합. 이 sprint에선 호출하는 곳 없음.

## 검증

- typecheck 통과
- biome 통과
- `next build` 통과

## 시각 검증 가이드 — 이 sprint만 단독으론 시각 검증 X

이 sprint의 결과물은 라이브러리 API 만이라 단독 검증 코드 경로 없음. A.2 끝나야 사용자 layer에서 multi-component 자동 분리 + per-island gen 결과 확인 가능. 라이브러리 단위 검증이 필요하면 `/poc/sam-debug` 같은 진단 페이지를 별도 PR로 추가 가능 — 이 sprint 범위는 아님.

다음: Sprint A.2 — GeneratePanel에서 OpenAI 경로를 multi-component 호출 / 결과 composite로 전환.
