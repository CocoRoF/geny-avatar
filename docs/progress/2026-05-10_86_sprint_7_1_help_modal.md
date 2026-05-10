# 2026-05-10 — Sprint 7.1: Help & Shortcuts modal

[`85 phase7_kickoff`](2026-05-10_85_phase7_kickoff.md) 의 첫 atomic sprint. discoverability 의 1차 진입점 — editor 의 `?` 버튼 / 키로 모달 띄우면 단축키 + 워크플로 + 패널/모달 한 줄 안내 한 번에 확인.

## 변경 surface

### `components/HelpModal.tsx` (신규)

`open: boolean` + `onClose: () => void` props. 5 sections:
1. **workflow** — library → editor → DecomposeStudio → GeneratePanel → ExportButton 흐름 (1~6 ordered list)
2. **shortcuts** — Cmd/Ctrl+Z, Shift+Z, R, Esc, ? 키 표 (kbd 스타일)
3. **panels** — Tools / References / Variants / Layers 한 줄 설명 each (dl)
4. **modals** — DecomposeStudio (trim/split + SAM) / GeneratePanel (picker/focus + per-region) 짧은 안내
5. **tips** — fullscreen, region prompt 메모리, revert 차이, close guard 등

Esc 로 dismiss. backdrop click 으로 dismiss. 모달 자체는 max-h-[85vh] w-[min(92vw,720px)] — 작은 reference card 사이즈.

복사: 한국어 + 영어 mix. third-party 용어 (Spine, Cubism, gpt-image-2 등) 는 영어 유지.

### `app/edit/[avatarId]/page.tsx` 수정

- `helpOpen: boolean` state 추가
- `?` 키 (Shift+/) 토글 effect — input/textarea 포커스 시 무시
- 헤더에 `?` 버튼 추가 (← library 옆) — tooltip "단축키 / 워크플로 / 패널 안내 (?)"
- `<HelpModal open={helpOpen} onClose={...} />` 메인 옆 렌더

### `app/edit/builtin/[key]/page.tsx` 수정

동일 wiring (helpOpen state + ? 키 effect + 버튼 + 모달).

## 의도적 한계

- **i18n framework X**: 한국어 + 영어 직접 hardcode. next-intl 등 안 깔음 — 문자열 양 적고 단일 사용자 (한국어) 전제.
- **검색 / table of contents X**: 모달이 5 section 짧음 — 스크롤로 충분.
- **per-modal context-help X**: GeneratePanel / DecomposeStudio 안에서 `?` 누르면 그 모달의 도구 안내가 뜨는 식의 contextual help 없음. 일단 editor-level help 만. polish 가능.
- **`?` 키 충돌**: 다른 단축키 시스템 (esc 등) 과 안 겹침. modal 안에서 `?` 입력 가능 (input 포커스 가드).

## 검증

- typecheck 통과
- biome 통과
- `next build` 통과

## 시각 검증 가이드

```bash
git pull && pnpm install && pnpm dev

# 1. /edit/[id] 진입
# 2. 헤더 우측에 "?" 버튼 보임
# 3. 클릭 또는 키 ? 입력 → HelpModal 등장
# 4. workflow / shortcuts / panels / modals / tips 5 section
# 5. Esc 또는 close 버튼 또는 backdrop click → 닫힘
# 6. /edit/builtin/<key> 도 동일
# 7. textarea/input 포커스 상태에서 ? 입력 → 모달 안 뜸 (편집 방해 X)
```

## 다음

Sprint 7.2 — onboarding hint cards. 처음 editor 진입 시 작은 dismissable cards 로 패널/버튼 가리키기.
