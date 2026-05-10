# 2026-05-10 — Sprint 7.3: User-facing 메시지 한국어화

[`85 phase7_kickoff`](2026-05-10_85_phase7_kickoff.md) 의 세 번째 sprint. 사용자가 직접 보는 alert / confirm / status / placeholder 영어 → 한국어. dev console 의 structured log / debug 진단 로그는 영어 유지.

## 변경 surface

### `components/GeneratePanel.tsx`

- error states: "layer has no texture region" → "이 레이어에는 텍스처 영역이 없습니다"
- "region rect is empty / unrenderable" → "영역이 비어있거나 렌더링할 수 없습니다"
- requestClose 의 in-flight alert + unapplied confirm 한국어
- onRevertTexture confirm 한국어
- onRevertFocusedRegion confirm 한국어
- prompt placeholder 두 가지 (multi/single) 한국어 + 한국어 예시 ("네이비 플리츠 스커트, 흰색 레이스 단" / "빨간 체크 스커트, 부드러운 코튼 재질")
- negative prompt placeholder "things to avoid" → "피하고 싶은 요소"
- result panel status: idle / submitting / running / failed (focus + non-focus 둘 다)
- "loading region…" → "영역 불러오는 중…"

### `components/DecomposeStudio.tsx`

- error states 동일 (layer has no texture region / region rect)
- autoDetectRegions 의 alert + replace/append confirm 한국어
- clearAllRegions confirm 한국어
- requestClose unsaved changes confirm 한국어
- per-row delete region confirm 한국어

### `components/ReferencesPanel.tsx`

- "is not an image" → "은(는) 이미지 파일이 아닙니다"

## 의도적 한계

- **debug 로그 영어 유지**: `[ai/submit]`, `[openai]`, `[ai/sam]`, `[GeneratePanel]` 등 console.info/warn 은 그대로 영어. 트러블슈팅 시 검색성 + 글로벌 디버깅 팁 검색 도움.
- **버튼 라벨은 영어 유지**: "save & close", "apply to atlas", "generate this region" 등 짧은 액션 라벨 영어 유지 (technical term + 한국어와 영어 mix UI 가 혼란스럽지 않도록 — 의도된 디자인 선택). 향후 framework 도입 시 결정.
- **i18n framework X**: `lib/i18n/messages.ts` 같은 중앙 dictionary 안 만듦. 인라인 번역 — 양 적고 한 사용자 (한국어).
- **테스트 자산 안 변경**: `/poc/sam-debug` 같은 진단 페이지의 영어 레이블 유지 (개발자용).

## 검증

- typecheck 통과
- biome 통과
- `next build` 통과

## 시각 검증 가이드

```bash
git pull && pnpm install && pnpm dev

# 1. /edit/[id] → GeneratePanel 진입
# 2. prompt textarea placeholder, negative placeholder, 빈 result message → 한국어
# 3. close 버튼 (in-flight 시): "생성이 진행 중입니다..." alert
# 4. close 버튼 (unapplied 시): "적용되지 않은 생성 결과..." confirm
# 5. revert texture: "이 레이어에 적용된 AI 텍스처를..." confirm
# 6. revert this region: "region '...' 만 원본 atlas..." confirm
# 7. DecomposeStudio: clear all / delete region / unsaved close 모두 한국어
# 8. ReferencesPanel: 이미지 아닌 파일 업로드 → "은(는) 이미지 파일이 아닙니다"
```

## 다음

Sprint 7.4 — license / attribution 명확화. footer + library 카드 + LICENSE.md polish.
