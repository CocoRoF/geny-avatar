# 2026-05-10 — Sprint 7.4: 라이선스 / attribution 명확화

[`85 phase7_kickoff`](2026-05-10_85_phase7_kickoff.md) 의 네 번째 sprint. 외부 SDK / 모델 의존성을 사용자가 인지할 수 있도록 footer + per-card disclosure + README 정비.

## 변경 surface

### 신규 — `components/AttributionFooter.tsx`

작은 footer 컴포넌트. 4개 third-party 자산을 한 줄씩 나열:

- Spine Runtime v4 — Esoteric Software · Spine Runtimes License (별도 SDK 라이선스 필요)
- Live2D Cubism Core — Live2D Inc. · Proprietary EULA
- Pixi.js v8 — PixiJS contributors · MIT
- OpenAI gpt-image-2 — OpenAI · API Terms of Use

각 항목 끝에 외부 license URL 링크 (target="_blank"). 마지막 줄: 1인 hobby 프로젝트 / 자체 코드 라이선스 미부여 / 상업적 배포 시 각 SDK 라이선스 별도 확보 필요.

### `app/page.tsx`

기존 `<footer>` (단순 "설계 문서는 docs/" 한 줄) 을 `<p>` 로 바꾸고 `<main>` 밖에 `<AttributionFooter />` 추가. fragment 로 감쌌음.

### `app/poc/library/page.tsx`

두 가지 추가:

1. **`<AttributionFooter />`** — `<main>` 의 마지막 자식. scroll 영역과 sibling 이라 항상 하단 고정.
2. **per-card "i" disclosure** — origin select 옆에 `<details><summary>i</summary>...</details>`. 펼치면 `ORIGIN_LICENSE_NOTES[source]` 의 한국어 라이선스 안내 + (있으면) source URL 링크.

`ORIGIN_LICENSE_NOTES` 는 6개 origin source 각각에 1~2 줄 안내 (Live2D Free Material License / Spine Examples License / Inochi2D BSD-2-Clause+CC-BY / community / self-made / unknown).

### `README.md`

기존 한 줄짜리 "## 라이선스" 섹션을 확장:

- 자체 코드 라이선스 명시 (private hobby)
- "### 제3자 자산 / Third-party" 표 (4 row, 위 footer 와 동일)
- 내장 샘플 (Hiyori, spineboy) 안내
- export 시 `LICENSE.md` 자동 동봉 안내

## 의도적 한계

- **editor 페이지 footer 없음**: editor 는 full-screen 작업 공간. footer 자리 만들면 캔버스 영역 줄어들음. 라이브러리 / landing 에서만 노출 — 사용자가 진입 전에 보고 들어옴.
- **per-puppet origin URL editor 없음**: `AssetOriginNote.url` / `notes` 필드는 schema 에 이미 있지만 library UI 에서 setter 안 만듦. select 만 노출 (가장 많이 쓰는 path). url/notes 는 schema 호환 — 향후 puppet 상세 페이지에서.
- **license popup 디자인 polish X**: native `<details>` 활용. 스타일링 minimum (border + bg + padding). a11y / animation 등 framework 안 깜.
- **license URL 외부 링크**: 모두 `target="_blank" rel="noopener noreferrer"`. 외부 페이지 깨질 가능성은 있지만 이쪽은 권리자 책임 (vs 우리가 미러).

## 검증

- typecheck 통과
- biome 통과 (3 files autofix — formatting)
- `next build` 통과 (`/poc/library` 4.97 KB → 정상 범위)

## 시각 검증 가이드

```bash
git pull && pnpm install && pnpm dev

# 1. http://localhost:3000 → 페이지 하단에 "Third-party / 제3자 자산" footer
# 2. /poc/library → 카드 내 origin select 옆 "i" 버튼 → 클릭 시 라이선스 안내 펼침
# 3. origin 을 "live2d-official" / "spine-official" / "community" 등으로 변경 → "i" 안내 텍스트가 그에 맞게 갱신
# 4. footer 의 license 링크 클릭 → 외부 EULA / MIT / OpenAI TOS 페이지 새 탭으로 열림
# 5. README 의 ## 라이선스 섹션 표 4행 확인
```

## 다음

Sprint 7.5 — README + landing copy. README 의 "현재 상태" Phase 0 표시 + landing 의 phase 카드 (P0 active, 나머지 pending) → 실제 진행 (P1~P6 done, P7 active) 으로 갱신. landing 카피 polish.
