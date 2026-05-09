# 2026-05-09 — Phase 6 complete: Sprints 6.3, 6.4, 6.5 in one bundle

[`61 phase6_kickoff`](2026-05-07_61_phase6_kickoff.md) 의 마지막 세 atomic sprint 묶음. 6.2 가 SAM 을 split mode 에 깔아준 위에, 6.3 boolean compose / 6.4 auto-detect regions / 6.5 fullscreen toggle 추가.

## Sprint 6.3 — Boolean composition for SAM apply

기존 candidate apply 가 source-over union 만 지원했는데, 사용자가 region 을 정교화할 때 (특히 잘못 잡힌 영역 빼기) 가 필요. apply-time boolean op 추가:

- **add** (default): `source-over` — candidate 의 opaque 픽셀이 region 에 합쳐짐
- **intersect**: `destination-in` — 둘 다 있는 픽셀만 region 에 남음 (예: region 후보가 너무 넓은데 SAM 이 좁힌 영역만 유지)
- **subtract**: `destination-out` — candidate 가 차지한 영역을 region 에서 제거

state: `samComposeOp: "add" | "intersect" | "subtract"`. SAM 패널 상단에 3-way grid toggle. 적용 시 `globalCompositeOperation` 을 op 에 따라 선택.

## Sprint 6.4 — Auto-detect regions from connected components

split mode 의 "+ add" 옆에 **auto-detect** 버튼. click 시:

1. `findAlphaComponents(sourceCanvas)` — alpha-island 검출 (GeneratePanel 의 region picker 와 동일 로직)
2. 각 component 마다 region 한 개 생성: 기본 색 cycle, 이름 `region 1`, `region 2`, ... (1개면 빈 이름)
3. 각 region 의 canvas 를 component mask 로 seed (binary alpha 그대로 복사)
4. `splitDirty = true`, 첫 region 자동 선택

기존 region 이 있으면 confirm dialog: "replace 할까? cancel 하면 add (append)". 거절 시 새 component 들을 기존 list 끝에 append.

빈 시작 메시지 도 갱신: "no regions yet — auto-detect 또는 + add" 안내.

## Sprint 6.5 — Fullscreen toggle

modal 기본 사이즈 (90vh × min(90vw, 1100px)) 가 4k+ source canvas 에 cramped — split mode regions list 가 sidebar 차지하면 더 좁아짐.

새 state `fullscreen: boolean` + 헤더의 close 옆에 toggle 버튼. true 면 modal 이 `h-screen w-screen rounded-none` 로 전환. 토글 자유.

## 의도적 한계

- **boolean op 은 SAM apply 한정**: brush 는 paint/erase 가 이미 add/subtract 동등. intersection 은 brush 에 드물게 필요 — SAM candidate 같이 큰 영역에서만 의미.
- **auto-detect 는 component split mode 와 같은 기준** (alphaThreshold=1, minArea=64). very tiny island 은 무시됨. 사용자 manual paint 또는 SAM auto 로 보강 가능.
- **fullscreen 은 toggle, 영구 저장 X**: 매 모달 진입 시 작은 모달부터 시작. 사용자 선호 저장은 [향후 polish] (localStorage / IDB).
- **fullscreen 시 esc 동작 동일**: close 가 modal 닫음. esc 가 fullscreen 만 끄게 하지 않음 (사용자 의도 파악 모호 — 그냥 close 가 단순).

## 검증

- typecheck 통과
- biome 통과
- `next build` 통과

## 시각 검증 가이드

```bash
git pull && pnpm install && pnpm dev

# 6.5: fullscreen
# 1. layer → DecomposeStudio 진입
# 2. 헤더 우측 "fullscreen" 클릭 → 모달이 화면 꽉 참, 라벨 "shrink"
# 3. canvas 가 더 큰 공간에서 보임
# 4. shrink 클릭 → 원래 크기

# 6.4: auto-detect
# 1. multi-island layer (上身 등) → DecomposeStudio → split
# 2. 헤더 "auto-detect" 클릭 → N 개 region 자동 생성, 각자 silhouette mask 시드
# 3. 각 region canvas 에 component 영역만 표시 (사용자 색깔 overlay)
# 4. 이름 입력 → save → IDB 저장 → GeneratePanel 의 manual region 으로 사용
# 5. 이미 region 이 있는 상태에서 다시 auto-detect → confirm dialog ("replace? cancel = append")

# 6.3: boolean compose with SAM
# 1. region 하나 선택 → tool: auto
# 2. fg 점 1~2 + bg 점 1 → compute mask → candidate 등장
# 3. 패널의 [add | intersect | subtract] grid 에서 op 선택
#    - add: 기존 region 에 합치기
#    - intersect: 기존과 candidate 의 교집합만 남기기 (예: region 외곽 다듬기)
#    - subtract: candidate 영역을 region 에서 빼기 (잘못 잡힌 영역 제거)
# 4. candidate 클릭 → 선택한 op 로 apply
```

## Phase 6 종합

- ✅ 6.1 SAM provider + Replicate route + diagnostic page ([progress 62](2026-05-09_62_sprint_6_1_sam_route.md))
- ✅ 6.2 DecomposeStudio split mode SAM 통합 ([progress 79](2026-05-09_79_sprint_6_2_sam_in_decompose.md))
- ✅ 6.3 multi-mask boolean composition (이 doc)
- ✅ 6.4 auto-detect regions (이 doc)
- ✅ 6.5 DecomposeStudio fullscreen mode (이 doc)

DecomposeStudio Pro 핵심 기능 정공 마무리. SAM 이 주요 자동화 도구 역할, 사용자가 region 정의 + GeneratePanel 의 multi-region 흐름과 자연 연결.

다음 polish 후보 (Phase 7 또는 별도 sprint):
- per-region history (region 별 generated 결과 기록)
- region-keyed refinement cache (현재 panel-level 1개)
- export ZIP 에 regionMasks 포함 (현재 IDB-only)
- Live2D 모델 위 region 위치 viz
- DecomposeStudio split 모드의 brush boolean op (현재 SAM 만)
