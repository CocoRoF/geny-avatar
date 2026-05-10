# 2026-05-10 — Root UX 통합: Library + Upload → `/`

Phase 7 closure 직후 추가 UX 정리. 사용자 피드백: "Upload 를 따로 구분하지 말고 Library + Upload 가 둘 다 되는거고 선택하면 Edit 이 되는거고."

이전 구조는 진입 동선이 셋으로 흩어져 있었음:
- `/` — 로드맵 / 철학 / debug 링크 (workspace 진입 X)
- `/poc/upload` — drop zone + 즉시 미리보기 + autoSave
- `/poc/library` — 저장된 puppet 목록

새 구조: 모든 진입을 `/` 에 통합. 사용자가 라우트 사이를 점프할 필요 없음.

## 변경 surface

### `app/page.tsx` — 전면 재작성

server component → client component (IDB + dropzone). 4 섹션:

1. **Hero** — `geny-avatar` 한 줄 설명 + 스택 한 줄 + 버전 (`v0.1.0 · phase 7`).
2. **새 puppet 시작** — `<UploadDropzone>` (h-44). 드롭 시:
   - `.zip` 이면 먼저 `tryRestoreGenyAvatarZip` 시도 → 성공하면 `router.push(/edit/<id>)`
   - 아니면 `parseBundle` → `savePuppet` → `router.push(/edit/<newId>)`
   - 진행 상태 (`파일 분석 중…` / `geny-avatar zip 확인 중…` / `puppet 번들 파싱 중…` / `라이브러리에 저장 중…`) inline 한국어로 표시
   - 실패 시 `인식 실패: <reason>` 한국어
3. **내장 샘플** — `BUILTIN_SAMPLES` 카드 (Hiyori / spineboy) → `/edit/builtin/<key>`.
4. **내 라이브러리** — IDB `listPuppets` 결과 카드 그리드. 각 카드 = thumbnail + runtime / version / id 꼬리 / name / 파일수 + 크기 + 상대시간. Footer 에 origin select + `<details>` "i" 라이선스 안내 + delete. 카드 본체는 `<a href=/edit/<id>>` 로 클릭 시 editor 진입.

`router.push` 사용 (full reload 대신 client navigation — 이미 hydrate 된 chunks 재사용).

### 삭제된 라우트

- `app/poc/upload/` — 흡수됨
- `app/poc/library/` — 흡수됨

남아있는 PoC 라우트 (`spine` / `cubism` / `dual` / `sam-debug` / `upload-debug`) 는 개발자용 진단으로 유지. Landing 에 링크 안 나옴 — 직접 URL 입력으로만 접근.

### 정리된 stale 참조

`/poc/upload` / `/poc/library` 가 docstring 에 박혀 있던 곳들 갱신:

- `components/LayersPanel.tsx` — `puppetKey === null` 주석을 "transient guard, 현재 라우트는 항상 key 해소" 로 일반화
- `components/GeneratePanel.tsx` — 동일
- `lib/avatar/useReferences.ts` / `useRegionMasks.ts` / `useComponentLabels.ts` / `useVariants.ts` — 동일
- `lib/export/buildBundle.ts` — LICENSE.md 마지막 줄 "Re-import via the geny-avatar upload page (`/poc/upload`)" → "Re-import by dropping this zip onto the geny-avatar landing page"
- `app/edit/[avatarId]/page.tsx` 헤더의 `← library` 링크 `/poc/library` → `/`

## 의도적 한계

- **whole-page drag-drop 안 함**: 명시적 dropzone (h-44) 만. document-level drag listener 는 textarea / select 와 충돌 위험. 향후 fullscreen overlay 로 빌드 가능.
- **upload 진행 시 미리보기 X**: 이전 `/poc/upload` 는 parseBundle 후 즉시 캔버스 표시했지만 새 흐름은 parseBundle → savePuppet → 즉시 redirect. 사용자 입장에서 "drop → editor" 가 한 step. 미리보기는 editor 안에서.
- **PoC 라우트 redirect 안 함**: /poc/upload 와 /poc/library 는 404 가 되도록 그냥 삭제. 외부 링크 마이그레이션 안 신경씀 (1인 hobby 프로젝트, 외부 인덱스 X).
- **builtin sample 추가 동선 안 만듦**: builtin 은 read-only 진입점. 사용자가 자기 puppet 을 editor 에서 builtin 으로 promote 하는 흐름은 별도 설계 필요 — Phase 8 의 candidate.
- **Roadmap / Philosophy 섹션 제거**: workspace selector 에 Phase 0~7 status 표가 있는 건 노이즈. README + docs/INDEX 에 남아있고 footer 의 한 줄 ("두 가지 운영 철학: P1 dual / P2 upload day-1") 로 압축.

## 검증

- typecheck 통과
- biome 통과 (1 file autofix — formatting)
- `next build` 통과 (`/` 7.68 kB / 324 kB First Load — 새 페이지의 dropzone + IDB 로직 + license map 포함)

## 시각 검증 가이드

```bash
git pull && pnpm install && pnpm dev

# 1. http://localhost:3000 → Hero 4줄, dropzone 한 단, 내장 샘플 2 카드, 라이브러리 N 카드, footer
# 2. dropzone 에 Spine .skel + .atlas + .png 드롭 → "파일 분석 중…" → "puppet 번들 파싱 중…" → "라이브러리에 저장 중…" → /edit/<newId>
# 3. dropzone 에 *.geny-avatar.zip 드롭 → "geny-avatar zip 확인 중…" → /edit/<restoredId>
# 4. dropzone 에 텍스트 파일 드롭 → "인식 실패: ..." 빨강 inline
# 5. Hiyori 카드 클릭 → /edit/builtin/hiyori
# 6. 라이브러리 카드 클릭 → /edit/<id>
# 7. 라이브러리 카드의 origin select 변경 / "i" 토글 / delete → 페이지 머무름 (stopPropagation)
# 8. /edit/<id> 헤더의 "← library" 클릭 → / (home)
# 9. /poc/upload + /poc/library 직접 입력 → 404
```

## 다음

별도 제안 없음 — Phase 7 + 본 통합으로 V1 시연 흐름이 한 라우트로 모임. Phase 8 후보:
- 시연 영상 / 스크린샷 docs 에 추가
- builtin sample slot 에 사용자 puppet promote 기능
- whole-page drag-drop overlay
