# 2026-05-10 — Sprint 7.2: Onboarding hint banner

[`85 phase7_kickoff`](2026-05-10_85_phase7_kickoff.md) 의 두 번째 atomic sprint. 처음 editor 진입 한 번 짧은 안내 배너 표시 → dismiss 후 영구 hide. help modal 에서 reset 가능.

## 변경 surface

### `components/OnboardingBanner.tsx` (신규)

`onOpenHelp: () => void` prop. 동작:
- mount 시 `localStorage["geny-avatar:onboarding-dismissed:v1"]` 체크
- 키 없으면 banner 표시. 있으면 hide.
- SSR / 첫 hydration 은 `show=null` 로 nothing render → flash of banner 방지
- "got it" 버튼 → localStorage set + state hide
- "전체 안내 보기 (?)" 버튼 → onOpenHelp 호출 (HelpModal 띄움)

복사:
```
처음이신가요? 1. 레이어 행 클릭 = 보이기/숨기기 · 2. 썸네일 클릭 = Decompose · 3. ✨ generate = AI 텍스처 교체
```

스타일: editor 헤더 아래 / canvas 위, accent 색 30% border + 5% bg → subtle. `flex-wrap` 으로 좁은 화면에서 줄바꿈.

versioned key (`:v1`) — 향후 onboarding 컨텐츠 크게 바뀌면 `:v2` 로 bump 하면 모두 다시 노출.

추가 export `resetOnboardingDismissed()` — HelpModal 의 reset 버튼이 호출.

### `components/HelpModal.tsx` 수정

새 section "onboarding" 추가:
- 안내 문구
- "show onboarding again" 버튼 → `resetOnboardingDismissed()` + alert 컨펌

### `app/edit/[avatarId]/page.tsx` + `app/edit/builtin/[key]/page.tsx`

import `OnboardingBanner` + `<OnboardingBanner onOpenHelp={() => setHelpOpen(true)} />` 헤더 바로 아래에 렌더.

## 의도적 한계

- **localStorage 만**: 다른 브라우저 / 다른 기기에선 다시 뜸. 프로필별 동기화 없음 — 단일 사용자 전제.
- **single banner only**: tour-style overlay 나 contextual tooltip 없음. 한 줄 짜리 banner 가 첫 visit 의 80% 가치 제공. 나머지는 help modal 로.
- **versioned reset 자동 X**: `:v2` 로 bump 하면 모두 다시 보지만, 사용자 선호 (이미 한 번 본 사람) 무시. 향후 polish 가능.
- **mobile breakpoint X**: flex-wrap 으로 텍스트 자체는 wrap 되지만 작은 화면 별도 디자인 없음. desktop-first.

## 검증

- typecheck 통과
- biome 통과
- `next build` 통과

## 시각 검증 가이드

```bash
git pull && pnpm install && pnpm dev

# 1. /edit/builtin/<key> (또는 업로드한 puppet) 첫 진입
# 2. 헤더 바로 아래 onboarding banner 등장: "처음이신가요? 1. 레이어 행 클릭 ..."
# 3. "got it" 클릭 → 배너 사라짐
# 4. 새로고침 / 다른 puppet 으로 진입해도 안 뜸 (영구 dismiss)
# 5. 헤더의 ? 버튼 → HelpModal → 하단 "onboarding" section 의 "show onboarding again" 클릭
# 6. alert 확인 → 다음 editor 진입 시 banner 다시 뜸
# 7. 배너의 "전체 안내 보기 (?)" 클릭 → HelpModal 직접 열림
```

## 다음

Sprint 7.3 — 에러 메시지 한국어화. user-facing 영역만 (debug 로그는 영어 유지).
