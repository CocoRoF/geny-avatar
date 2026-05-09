# 2026-05-09 — Sprint A.3: Region-aware UI in GeneratePanel

[`64 multi_component_kickoff`](2026-05-09_64_multi_component_kickoff.md) 의 마지막 핵심 atomic sprint. A.2 까지는 multi-component 자동 분리 + 병렬 호출 + composite 가 동작했지만 사용자가 "어디가 어디인지 panel UI에서 안 보임" 이슈 보고. 이 sprint가 정확히 그 문제 해결.

사용자 보고 요지:
> "잘 된 지 모르겠음. 그리고 브라우저 dev에서 무엇을 볼 수 있는거지? 정확하게 영역을 지정해주고 싶은데..."

dev 콘솔 데이터를 사용자가 캐는 건 받아들일 수 없음. component 정보가 panel UI 안에서 직접 보여야 함.

## 변경 surface

### `lib/avatar/connectedComponents.ts`

신규 `componentThumbnail(source, component, targetMax=96) → HTMLCanvasElement`
- component bbox로 crop → max edge `targetMax`로 scale
- destination-in으로 component mask 적용 → 다른 island 흔적 제거
- panel UI의 region tile 썸네일에 사용

### `components/GeneratePanel.tsx`

**state 추가**:
- `components: ComponentInfo[]` — mount 시 `findAlphaComponents(aiSourceCanvas)` 결과
- `componentThumbs: HTMLCanvasElement[]` — 각 component별 96px 썸네일
- `componentPrompts: string[]` — region별 sub-prompt
- `COMPONENT_COLORS` 상수: 6색 팔레트 (`#22c55e`, `#f97316`, `#ec4899`, `#3b82f6`, `#eab308`, `#a855f7`)

**Mount effect** — AI source 추출 직후 `findAlphaComponents` + 썸네일 빌드 + per-region prompt 초기화 (모두 빈 문자열).

**SOURCE canvas overlay** — `components.length > 1` 시 `<canvas>` 위에 절대 위치 SVG:
- viewBox = canvas dims (좌표가 source 픽셀 공간 그대로)
- 각 component마다:
  - 점선 사각형 outline (component 색)
  - 좌상단에 컴퍼넌트 색 채워진 원 + 검정 번호 텍스트
- preserveAspectRatio="none" 으로 canvas의 CSS resize와 정확히 일치

**Components 섹션** (aside, prompt 위) — `components.length > 1` 시만:
- 각 region tile: 64×64 썸네일 (좌상단 색 배지 + 번호) + bbox dim/area + per-region textarea
- tile border = component 색 (SOURCE outline과 시각적 일치)
- textarea placeholder: "region N — what should fill this island?"

**Common prompt 섹션 라벨**:
- 단일 component: "PROMPT" (변경 없음)
- multi-component: "COMMON CONTEXT · sent to every region" + placeholder도 "shared context — style, palette, character identity"

**onSubmit 변경** — multi-component 호출에서 prompt 조합:
- `baseText = refinedPromptForSubmit ?? prompt`
- per-region 비어있지 않으면: `${baseText}\n\nFor [image 1] (region ${idx+1} of ${N}, ${w}×${h} px): ${perRegion}`
- 조합된 텍스트를 `submitGenerate` 의 `refinedPrompt` 필드로 전달 → 프로바이더 composePrompt가 이걸 우선 사용
- raw `prompt` 필드는 사용자 입력 그대로 유지 → IDB history / 진단 로그 정확성

**진단 로그** — multi-component case에서 per-region prompt 텍스트 추가 출력 (component마다 region 번호 + 텍스트).

## UX flow

multi-component layer 열림 → SOURCE 위에 점선 outline + 번호 1/2/3 → aside의 REGIONS 섹션에 thumb + textarea 3개 + COMMON CONTEXT textarea 1개 → 사용자가 region별로 "torso 부분", "frill 부분" 등 분리 입력 → generate → 각 region별 프롬프트로 N개 OpenAI 호출 → composite.

## 의도적 한계

- **per-region refine 없음**: 공통 prompt만 한 번 chat refine. region 별 refine은 A.4 (호출 N배 추가). 일단 공통 refined + per-region appendix 만으로 사용자 의도 분배 충분.
- **번호 1-base, id 0-base**: 사용자에게는 1부터 표시 (1, 2, 3), 내부 ComponentInfo.id 는 0-based. 혼동 없게 UI 라벨만 1-based.
- **6색 cycle**: 7+ component면 색 반복. 보통 layer당 island 5개 이하라 충분.
- **SOURCE outline은 dotted**: 너무 진하면 source 가 안 보이고, 가늘면 큰 source 에서 안 보임. dasharray가 bbox 짧은 변 / 6 비율로 자동 조정.
- **번호 라벨 크기**: bbox 짧은 변 / 4. 작은 island도 알아볼 정도, 큰 island에서도 너무 거대하지 않게.

## 검증

- typecheck 통과
- biome 통과
- `next build` 통과

## 시각 검증 가이드 — 이 sprint의 핵심

```bash
git pull && pnpm install && pnpm dev

# 1. 사용자가 본 multi-island layer (上身 등) 진입
# 2. 패널 열리자마자:
#    - SOURCE canvas 위에 색깔별 점선 사각형 + 번호 (1, 2, 3) 보임
#    - 헤더에 "source · 3 regions" 표시
# 3. ASIDE (오른쪽 320px):
#    - REGIONS 섹션 (3개 OpenAI calls 라벨)
#    - 각 region tile: 색 매치된 썸네일 + 64×64 + 색 배지 + 사이즈/area
#    - 각 region에 자기 textarea
# 4. 사용자가 region별 입력:
#    - region 1 (torso 큰 거): "exposed midriff black sailor crop top"
#    - region 2 (frill A): "white lace frill"
#    - region 3 (frill B): "white lace frill"
# 5. COMMON CONTEXT:
#    - "blue-haired schoolgirl, black + white palette, soft anime shading"
# 6. generate → 3개 OpenAI 호출 (각자 region별 prompt + 공통)
# 7. RESULT: 각 region이 자기 silhouette에 맞는 콘텐츠로 채워진 단일 composite
# 8. dev 콘솔 [ai/submit] 그룹:
#    - per-region prompts 줄에 [{region:1, text:"..."}, {region:2, text:"..."}, ...]
#    - source split into 3 component(s) 그대로
```

만약 region이 안 잡히거나 너무 잘게 잡히면 → component minArea 조정 필요. 현재 default 64 px.

## 남은 follow-up

A.4 (선택, 별도 sprint) — region별 chat refinement. 각 region context (썸네일 + per-prompt + refs) 를 chat에 보내 region별 refined 받음. 호출 N배 추가 비용. A.3까지 효과 보고 결정.

또 다른 follow-up: "Live2D model 위 어디인가" 시각화 — drawable vertex로 puppet rendering 위에 highlight overlay. 별도 sprint로 분리.
