# 2026-05-10 — Sprint 7.5: README + landing copy 정비

[`85 phase7_kickoff`](2026-05-10_85_phase7_kickoff.md) 의 다섯 번째 sprint. README 와 `/` 의 카피 / 상태가 Phase 0 부트스트랩 시점에 머물러 있던 걸 현재 (Phase 7 polish 진행 중) 로 동기화.

## 변경 surface

### `README.md`

- "스택" 섹션의 `(예정)` 라벨 제거. 모든 런타임이 실제 사용 중. AI / 영구화 한 줄 추가 (gpt-image-2 + SAM + Dexie/IDB v9).
- 새로운 "주요 기능" 섹션 (스택 위) — Dual runtime upload / Layer & Variant / Decompose Studio / AI texture / Export-Import / Help-Onboarding 6 줄.
- "현재 상태" — Phase 0 → Phase 7. 7.1~7.4 완료, 7.5/7.6 다음. progress INDEX 링크.

### `app/page.tsx`

- 헤더 라벨 `v0.0.1 · phase 0` → `v0.1.0 · phase 7 (polish & V1)`.
- 부제: "Web-based 2D Live Avatar editor with AI-driven texture generation." → "Cubism / Spine puppet 을 브라우저에서 열고, 레이어를 분해하고, 생성형 AI 로 텍스처를 교체합니다." (한국어로 직접 설명).
- 스택 한 줄: `SDXL inpaint` → `OpenAI gpt-image-2 · SAM`.
- Roadmap phase 상태 P0~P6 `pending` → `done`, P7 `pending` → `active`. P3 blurb (`Replicate, SDXL inpaint + canny`) → 실제 (`OpenAI gpt-image-2 multi-image edits, references 첨부`). P5 / P6 / P7 도 실제 산출물로 갱신.
- 샘플 섹션 안내 줄 강화: `/poc/upload` → 자동 저장 → 라이브러리 다시 열기 흐름 한 문장으로 설명.
- "Phase 0 PoC" 섹션을 "Debug / 데모 페이지" 로 rename. 6 카드 재정렬 (upload / library / dual / spine / cubism / sam-debug). `/poc/upload-debug` 링크는 빠짐 (개발자 전용 — 빠른 진단은 `/poc/upload` 가 흡수).

### `app/poc/library/page.tsx`

- 헤더 `PoC · Asset Library` → `Library`. 카운트 표기 한국어 (`불러오는 중…` / `저장된 puppet 없음` / `N개 puppet 저장됨 (IndexedDB)`).
- 빈 상태 메시지 한국어화 + 홈 (built-in 샘플) 으로 가는 보조 링크 추가.

### `app/poc/upload/page.tsx`

- 헤더 `PoC · Upload` → `Upload`. (PoC 시절 라벨 흔적 정리)

## 의도적 한계

- **헤더 시멘틱 버전 0.1.0 임의 부여**: package.json 은 여전히 `0.0.1`. landing 만 polish 진행도 표시용. release 시점에 둘을 한꺼번에 0.1.0 으로 bump.
- **/poc/upload-debug 링크 제거**: landing 에서 안 보임. 직접 URL 입력으로 여전히 접근 가능 (개발자가 parseBundle 결과 확인용). built-in 샘플 + library + upload 셋이 사용자 흐름의 전부.
- **landing 내 phase 카드 유지**: roadmap 카드 자체는 그대로. 실제 진행 상태가 빠짐없이 보이도록 done 표시 (큰 점). hobby 프로젝트의 정직한 진행 표시.
- **"library" 헤더 한국어 X**: 단어 자체가 짧고 IT 용어 — 헤더 chip 은 영어 유지. 본문/카운트만 한국어. 7.3 의 동일한 mix UI 정책.

## 검증

- typecheck 통과
- biome 통과
- `next build` 통과 (`/poc/library` 5.06 KB / `/` 정적 prerender)

## 시각 검증 가이드

```bash
git pull && pnpm install && pnpm dev

# 1. http://localhost:3000 → 헤더 "v0.1.0 · phase 7 (polish & V1)"
# 2. roadmap 섹션의 점이 P0~P6 채워짐 + P7 깜빡임
# 3. 하단 "Debug / 데모 페이지" 6 카드 (upload-debug 빠짐, sam-debug 추가)
# 4. /poc/library → 헤더 "Library" + 카운트 한국어. 빈 상태일 때 "아직 저장된 puppet 이 없습니다."
# 5. /poc/upload → 헤더 "Upload"
# 6. README 의 "주요 기능" 섹션 (스택 위) + Phase 7 현재 상태 + 라이선스 표 4행
```

## 다음

Sprint 7.6 — 성능 최적화. 첫 페인트 1.5s 목표. dynamic import / lazy decode / IDB hydrate 최적화 후보 측정.
