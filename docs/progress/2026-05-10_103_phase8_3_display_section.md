# 2026-05-10 — Phase 8.3: Display section (kScale + shift sliders)

[Phase 8 plan](../plan/09_editor_animation_tab.md) 세 번째 sprint. Animation 탭의 첫 인터랙티브 surface — viewport 디폴트값 (Geny 의 model_registry 의 kScale / initialXshift / initialYshift / idleMotionGroupName) 을 슬라이더로 조정 + 캔버스에 즉시 반영.

## 변경 surface

### `components/animation/DisplaySection.tsx` (신규)

- props: `{ adapter, app, meta, initial?, onChange? }`. `meta` 는 8.2 의 CubismMeta — idle group 추론에 사용.
- 4 컨트롤:
  - **kScale** slider (0.1 ~ 2.0, step 0.01) — 디폴트 0.7
  - **X shift** slider (-400 ~ 400, step 1)
  - **Y shift** slider (-400 ~ 400, step 1)
  - **idle motion group** dropdown (motion groups 자동, /^idle$/i 우선 fallback 첫 그룹)
  - reset 버튼 (kScale + shift 만 디폴트로, idle 은 유지)
- 적용 로직: `useEffect([adapter, app, cfg])` 안에서 `baseFactor = min(screen.w*0.9/baseW, screen.h*0.9/baseH)` 계산 → `display.scale = baseFactor * kScale` + `display.position = (w/2 + xShift, h/2 + yShift)`. PuppetCanvas 의 fit 로직과 동일 공식.
- `onChange?(cfg)` ref 패턴으로 호출 — inline callback 의 reference change 가 effect 재실행 안 시킴.
- 8.7 까지 in-memory state only.

### `components/animation/AnimationPanel.tsx`

- props 에 `app: Application | null` 추가.
- `meta && adapter && app` 모두 준비된 시점에만 `<DisplaySection>` 렌더 — 그 전에는 manifest loading placeholder.

### `app/edit/[avatarId]/page.tsx` + `app/edit/builtin/[key]/page.tsx`

- 두 페이지 모두 `<AnimationPanel app={app} ... />` 로 prop 전달.
- builtin 페이지는 기존에 `app` 을 capture 하지 않았으므로 `useState<Application | null>` + `onReady` 의 세 번째 인자 받기 추가.

## 의도적 한계

- **Edit 탭 복귀 시 transform 유지**: 사용자가 Animation 에서 슬라이더 만진 뒤 Edit 으로 가도 그 transform 그대로. PuppetCanvas 가 fit 을 다시 안 함. 의도된 동작 — 사용자가 본 puppet 모양 그대로 편집 작업 (texture / mask) 가능. 디폴트 fit 으로 복귀 원하면 reset 버튼.
- **kScale 디폴트 0.7 vs PuppetCanvas 초기 fit 1.0**: Animation 탭 첫 진입 시 puppet 이 0.7 로 살짝 줄어듦 — Geny export 기본값 미리보기 의도. user 가 1.0 을 원하면 슬라이더로 조정.
- **IDB 영속성 X**: 이번 sprint 는 in-memory only. 페이지 reload 시 디폴트로 돌아옴. 8.7 가 영속화 + initial 값 채움.
- **slider 의 라이브 적용 throttle X**: 마우스 드래그 매 tick 마다 재적용. baseFactor 계산이 가벼워서 60fps 무난.
- **idle motion group dropdown 은 passive**: 선택만 됨 — 실제 그 그룹의 motion 을 트리거하는 건 8.4 (PuppetCanvas 가 mount 시 첫 idle 자동재생하는 동작과 별개로, 사용자가 idle 선택을 명시적으로 만지는 흐름은 8.4 의 ▶ 버튼).

## 검증

- `pnpm typecheck` 통과
- `pnpm lint` 통과 (label-without-control 1건 발견 → htmlFor 대신 label 안에 input 감싸기로 수정)
- `pnpm build` 통과
- 시각 검증: `/edit/builtin/hiyori?tab=animation` → kScale 슬라이더 만지면 Hiyori 즉시 크기 변화. X/Y shift 도 즉시 반영.

## 다음 — 8.4

`components/animation/MotionsSection.tsx` 신규. motion group / entry 목록 + ▶ 버튼 → adapter.playMotion(group, index) 트리거. Live2DAdapter 의 motion 트리거 API 가 노출돼있는지 먼저 확인 필요 — 없으면 thin wrapper 추가.
