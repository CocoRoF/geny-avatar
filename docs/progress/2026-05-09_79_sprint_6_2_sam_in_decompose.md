# 2026-05-09 — Sprint 6.2: SAM auto-mask integrated into DecomposeStudio split mode

[`61 phase6_kickoff`](2026-05-07_61_phase6_kickoff.md) 의 두 번째 atomic sprint. Sprint 6.1 의 SAM backend (`/api/ai/sam` + `submitSam` client) 를 [`70 sprint_e_2_decompose_split_mode`](2026-05-09_70_sprint_e_2_decompose_split_mode.md) 의 region 정의 UX 에 통합. 사용자가 region 직접 brush 로 paint 하던 것에 더해 한두 번 click 으로 SAM 이 자동 mask 후보를 제시.

## 변경 surface

### `components/DecomposeStudio.tsx`

**BrushMode 확장**:
```ts
type BrushMode = "paint" | "erase" | "auto";
```

`auto` 는 split mode 안에서만 활성. trim mode 엔 영향 없음.

**SAM state**:
- `samPoints: SamPoint[]` — fg/bg click 점 누적
- `samCandidates: SamCandidate[] | null` — compute 후 후보 마스크
- `samRunning: boolean` — compute 중
- `samError: string | null` — failure reason inline

**pointer handling**:
- `auto` 모드 + split: `onPointerDown` 이 그리지 않고 `recordSamPoint` 로 분기. 좌클릭 = label 1 (fg), 우클릭/middle = label 0 (bg). canvas 의 `onContextMenu={preventDefault}` 로 우클릭 메뉴 억제.
- 그 외 모드: 기존 brush 흐름 그대로.

**actions**:
- `computeSamMasks()`: source canvas → PNG blob, `submitSam({ imageBlob, points })` 호출, candidates state 업데이트. fg 점 0개면 friendly error.
- `applySamCandidate(c)`: candidate mask blob → image 로 디코드 → 선택된 region canvas 에 source-over union (clipPath 로 layer footprint 외부 차단). 적용 후 점 + candidates 자동 reset → 다른 영역 한 번 더 cycle 가능.
- `resetSamPoints()`: 점 + candidates + error 모두 초기화.

**자동 cleanup**:
- mode 가 auto 외로 바뀌거나, studio mode 가 trim 으로 가거나, 선택된 region 이 바뀌면 — 누적된 점/candidates 모두 초기화. 그 점들이 더 이상 의미 없는 컨텍스트라.

**UI**:
- canvas 위에 SVG overlay (auto 모드 + 점 있을 때만). source-pixel viewBox 라 CSS scale 무관하게 점 위치 정확.
- sidebar tool toggle: `paint | erase | auto` (3-column grid). auto 는 region 선택 안 됐으면 disabled (tooltip "select a region first").
- auto 모드 활성 시 brush size slider 숨김. SAM 패널 등장:
  - 헤더: "auto-mask · SAM" + 안내 "L = fg · R = bg"
  - 점 카운터: total / fg / bg
  - `compute mask` (메인) / `reset` (보조) 버튼
  - error 인라인
  - candidates 그리드 (3-col 썸네일) — 클릭 = 적용
- 하단 how-to 에 auto 사용법 한 줄 추가.

## 의도적 한계

- **single click → 즉시 호출 X**: 매번 click 마다 SAM 호출은 토큰/지연 비효율. 사용자가 점 누적 후 explicit compute 로 1번 호출. 단순 1점 click 이면 그냥 점 1개 추가 + compute = 2 click.
- **candidates URL 누수**: 후보 썸네일에 `URL.createObjectURL` 하지만 명시적 revoke 안 함. apply 또는 reset 시 candidates 가 바뀌면서 GC 됨 — 패널 unmount 까지 short-lived. polish 가능.
- **점 좌표는 source canvas pixel space**: clipPath 로 footprint 밖 paint 차단되지만 SAM 자체는 source canvas 전체 이미지 기준 분할. footprint 외부 점은 그쪽 영역 mask 도 만들 수 있음 → apply 시 clipPath 로 잘림. OK.
- **multi-region union**: candidate apply 가 source-over union 만. boolean intersection / subtract 는 [`61 phase6_kickoff`](2026-05-07_61_phase6_kickoff.md) Sprint 6.3 territory.
- **trim mode 에 SAM X**: 기존 single-mask 흐름엔 추가 안 함. 사용자가 split mode 의 region painting 에 SAM 을 가장 많이 쓸 거라 가정. trim 도 원하면 별도 polish.
- **REPLICATE_SAM_MODEL env**: 필요. default `meta/sam-2`. 서버 측 설정 필요 — Sprint 6.1 doc 에 명시.

## 검증

- typecheck 통과
- biome 통과
- `next build` 통과

## 시각 검증 가이드

```bash
# .env.local 에 둘 필요
# REPLICATE_API_TOKEN=r8_...
# REPLICATE_SAM_MODEL=meta/sam-2  (또는 검증된 fork)

git pull && pnpm install && pnpm dev

# 1. layer (multi-island layer 권장 — 上身, 胸 등) → DecomposeStudio
# 2. header [trim | split] → split
# 3. "+ add" → region "torso" 생성 (자동 선택)
# 4. tool 그리드: paint / erase / auto. auto 클릭
# 5. canvas 상단 brush slider 사라지고 SAM 패널 등장
# 6. canvas 의 torso 부분 좌클릭 → 초록 점 (fg)
# 7. (옵션) torso 가 아닌 부분 우클릭 → 빨강 점 (bg) — 그쪽은 mask 에 포함되지 말라는 hint
# 8. compute mask 클릭 → ~2-5초 SAM 호출
# 9. SAM 패널에 candidate thumb 1~3개 등장 (미니 mask 미리보기)
# 10. 마음에 드는 candidate 클릭 → torso region canvas 에 union (region 색 overlay 진하게)
# 11. paint/erase 로 미세 조정 가능
# 12. save → IDB 저장 → GeneratePanel 에서 manual region 으로 그대로 사용
```

dev 콘솔 [ai/sam] 로그로 호출 latency, candidate 수, byte 사이즈 확인 가능.

## Phase 6 진행 종합

Sprint 6.1 + 6.2 끝나면:
- ✅ 6.1 SAM provider + Replicate route + diagnostic page
- ✅ 6.2 DecomposeStudio split mode 안에 SAM auto 통합
- ⏳ 6.3 multi-mask boolean composition (union/intersection/subtract)
- ⏳ 6.4 auto-decompose all layers (batch)
- ⏳ 6.5 DecomposeStudio fullscreen mode

다음: 6.3 — apply 시 union 외 옵션 (intersection / subtract). 한 region 안에서 SAM 결과 + 기존 brush stroke 의 boolean 합성 도구.
