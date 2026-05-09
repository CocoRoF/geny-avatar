# 2026-05-09 — Sprint E.3: GeneratePanel uses manual regions over auto-detect

[`68 e_kickoff`](2026-05-09_68_e_kickoff.md) 의 마지막 atomic sprint. E.2 의 manually-defined regions 가 GeneratePanel 의 auto-detect 보다 우선. 사용자 정의 region이 있으면 그것대로 generation 호출, 없으면 기존 auto-detect.

## 변경 surface

### `lib/ai/client.ts`

신규 `prepareOpenAISourcesFromMasks(source, masks) → Promise<PreparedComponent[]>`:
- `prepareOpenAISourcesPerComponent` 의 manual 변형 — 미리 만들어진 mask canvas 배열을 받음
- 각 mask 마다: `isolateWithMask` → `prepareOpenAISource` → `PreparedComponent` 구성
- area는 sourceBBox 면적 추정 (정확 픽셀 카운트는 submit path 에 불필요, 진단/정렬용으로 충분)

### `lib/avatar/connectedComponents.ts`

- `ComponentInfo` 에 optional `name?: string` + `color?: string` 추가
  - manual region 출처일 때만 set
  - auto-detect 는 둘 다 undefined → UI는 E.1 label / 팔레트 cycle로 fallback
- 신규 `bboxFromMask(mask, alphaThreshold=1)` — binary mask canvas 로부터 tight bbox + area 계산. manual region path 가 connected-components 다시 안 돌리고 사용

### `components/GeneratePanel.tsx`

- 새 hook 호출 `useRegionMasks(puppetKey, layer.externalId)` → `manualRegions: RegionMaskEntry[]`
- 새 state `regionSource: "manual" | "auto"` — 진단 / UI badge 용
- mount effect 변경:
  - `manualRegions.length > 0` 시 manual path: 각 region blob → canvas decode → `bboxFromMask` → `ComponentInfo` 구성 (name/color set)
  - 그 외 auto-detect 그대로
  - 두 경로 모두 동일한 `components: ComponentInfo[]` state 채움 → 이후 UI/submit 코드 single path
  - dependencies 에 `manualRegions` 추가 — 사용자가 DecomposeStudio 닫을 때 (panel 같이 열려있는 case 드물지만) 자동 재계산
- submit 분기:
  - `regionSource === "manual"`: `prepareOpenAISourcesFromMasks(source, components.map(c => c.maskCanvas))`
  - `auto`: `prepareOpenAISourcesPerComponent(source)`
- 진단 로그 헤더에 source mode 표시: `source split into N component(s) (manual)` 또는 `(auto)`
- per-region label 우선순위: `c.name ?? componentLabels[sig] ?? ""` — manual 이름이 우선

### REGIONS 섹션 UI

- 헤더에 우측 작은 chip: `[manual]` 강조색 / `[auto]` dim — 어느 path가 active 한지 한눈에
- 각 region tile:
  - color: `c.color ?? COMPONENT_COLORS[idx]` — manual 이면 사용자 색, auto 면 팔레트 cycle
  - name 영역:
    - manual (`c.name !== undefined`): readonly `<div>` 표시 — DecomposeStudio 가 source of truth
    - auto: 기존 E.1 inline `<input>` (debounced IDB save)
- bbox dim, area, per-region textarea 그대로

### SOURCE overlay

- SVG outline color도 `c.color ?? COMPONENT_COLORS[idx]` — manual 색이 source overlay 와 region tile 양쪽에서 매치

## 통합된 흐름

1. 사용자가 layer 진입 → DecomposeStudio split mode → "torso" / "frill" region 정의 + paint + save
2. layer GeneratePanel 진입 → manual regions 자동 감지 → REGIONS 섹션에 사용자 색깔 + 이름 그대로 표시 (`[manual]` chip)
3. SOURCE 위 outline 도 사용자 색
4. region별 textarea 에 prompt 입력 (region 1 textarea 옆에 "torso" 이름 표시 + placeholder "torso — what should fill this region?")
5. generate → `prepareOpenAISourcesFromMasks` 흐름 → 각 region 의 mask 로 isolate → 1024² pad → 병렬 호출 → composite
6. 호출에는 `For [image 1] (region 'torso' (1 of 2, ...))` 식의 명시적 라벨 들어감

auto path도 똑같이 동작 — name이 비면 ordinal, 있으면 (E.1 saved) 라벨 사용. 두 path가 unified data flow.

## 의도적 한계

- **manual ↔ auto 토글 X**: panel UI에서 강제로 auto로 돌아가는 버튼 없음. manual 끄려면 DecomposeStudio split mode 들어가서 모든 region 삭제 후 save (IDB row 삭제됨 → auto 로 fallback)
- **manual region rename via panel X**: 이름 편집은 DecomposeStudio split mode 가 단일 진입점. panel은 readonly. 단순화.
- **panel-DecomposeStudio sync**: panel 열려있고 DecomposeStudio 에서 region 변경 시 panel은 자동 갱신 안 함 (mount effect의 `manualRegions` deps가 hook의 react state라 변동 시 갱신은 되긴 하는데 동시 오픈은 드문 케이스). panel 닫고 다시 열면 확실히 새 상태 반영.
- **export ZIP 미포함**: regionMasks도 IDB-only. export/import 통합은 후속.

## 검증

- typecheck 통과
- biome 통과
- `next build` 통과

## 시각 검증 가이드 — A+B+E end-to-end

```bash
git pull && pnpm install && pnpm dev

# 케이스 1 — manual override 우선 사용
# 1. multi-component layer (上身) 의 LayerRow 우클릭 → DecomposeStudio
# 2. 헤더 [trim | split] 토글 → split
# 3. "+ add" 두 번 → region 두 개. 첫 번째 "torso" 이름 + 큰 영역 brush, 두 번째 "frill" 이름 + 작은 영역
# 4. save & close
# 5. 같은 layer 의 LayerRow → generate (panel)
# 6. REGIONS 섹션 헤더 우측에 [manual] chip 강조색
# 7. 두 region tile: 사용자 색깔 / 이름 readonly / bbox dim
# 8. SOURCE 위 outline 도 사용자 색
# 9. region 1 textarea: "exposed midriff black sailor crop", region 2: "white lace frill"
# 10. COMMON CONTEXT: 공통 분위기
# 11. generate → 콘솔 [ai/submit] 그룹: "source split into 2 component(s) (manual)"
# 12. RESULT 가 region 별 의도대로
#
# 케이스 2 — auto fallback (manual region 없는 layer)
# 1. 다른 layer 진입
# 2. REGIONS 섹션 헤더 우측에 [auto] chip dim
# 3. component name input 보임 (E.1 흐름 그대로)
# 4. 이름 입력 → IDB persist
#
# 케이스 3 — manual 끄기
# 1. manual layer 의 DecomposeStudio split mode
# 2. 모든 region 삭제 후 save
# 3. GeneratePanel 다시 열기 → [auto] chip 으로 전환됨 (regionMasks IDB row 삭제 → useRegionMasks 빈 배열)
```

## A + B + E 정공 종합

- **A** ([sprint A.1](2026-05-09_65_sprint_a_1_connected_components.md), [A.2](2026-05-09_66_sprint_a_2_parallel_submit.md)): connected component 자동 분리 + 병렬 호출 + composite
- **B** ([sprint A.3](2026-05-09_67_sprint_a_3_region_aware_ui.md)): region-aware UI (per-region prompt + SVG overlay + 색깔 매치)
- **E** (sprint E.1 ~ E.3): per-component 명명 영구 저장 → DecomposeStudio split mode → GeneratePanel manual region 우선

multi-region layer 의 generation 정밀도 정공 마무리. 사용자 의도 → DecomposeStudio 에서 region 정의 → GeneratePanel 에서 region 별 prompt → 정확한 결과.

## 남은 follow-up (별도 sprint)

- **SAM 통합 in DecomposeStudio**: Sprint 6.1 backend 활용해 click-to-region. brush 보다 빠른 region 정의.
- **Live2D model 위 region 위치 viz**: drawable vertex 기반 character preview 위 highlight overlay.
- **export/import region masks**: ZIP에 regions/ 디렉토리 포함, import 시 IDB 복원.
- **per-region refinement**: A.4 territory — region 별 chat refine.
