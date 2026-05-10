# 2026-05-10 — Phase 8.2: Cubism manifest meta extraction

[Phase 8 plan](../plan/09_editor_animation_tab.md) 두 번째 sprint. 자체 typed view 로 model3.json 의 motion / expression / hit area 메타를 노출 — 8.3~8.6 의 UI 가 이 메타를 토대로 동작.

## 변경 surface

### `lib/adapters/Live2DAdapter.ts`

- private `model3Url: string | null` 필드 추가, `load()` 가 `input.model3` 를 그대로 캐시.
- public `getModelManifestUrl(): string | null` 메서드 — `getDisplayObject()` 자리 다음에. 8.2 hook 의 진입점.

기존 동작 무손상 — engine 의 자체 manifest 파싱은 그대로.

### `lib/avatar/cubismMeta.ts` (신규)

- 타입: `CubismMotionEntry` (group/file/index/fadeIn/fadeOut), `CubismMotionGroup`, `CubismExpression` (name/file/index), `CubismHitArea` (name/id?), `CubismMeta`.
- `parseCubismManifest(raw)` — pure function. `Model3Manifest` 의 `FileReferences.Motions / Expressions` + top-level `HitAreas` 만 읽음. 누락 섹션 정상 처리.
- `fetchCubismMeta(url)` — fetch + parse, 실패 시 throw.
- `useCubismMeta(adapter)` hook — adapter 의 manifest URL 변경 시 자동 refetch. `loading` / `error` / `meta` 상태. non-Live2D adapter 면 즉시 `null` 반환.

**index 보존**: `CubismExpression.index` 가 model3.json 의 expression 순서. Geny 의 emotionMap 이 인덱스 기반이라, 8.8 의 export 에서 NAME → 인덱스 변환 시 사용.

### `components/animation/AnimationPanel.tsx`

8.1 의 placeholder 에서 실제 메타 prefetch + 표시:

- error / loading 헤더 라인.
- motions 섹션: `(N groups, M entries)` 라벨 + 그룹별 카운트 리스트.
- expressions 섹션: `(N)` 라벨 + 이름 chip 그리드 (file 은 hover title).
- hit areas 섹션: 동일 패턴, 빈 경우 한국어 안내.

UI 는 read-only — 8.3 (Display) 부터 인터랙티브 시작.

## 의도적 한계

- **engine internals 의존 X**: 자체 fetch 로 manifest 를 다시 읽음. ~1KB 파일 + 브라우저 캐시 → 비용 0. engine 이 들고 있는 settings 객체에 reach 하면 더 빠르지만 unstable API.
- **abs URL 변환 X**: `entry.file` 은 manifest 상대 경로. preview (8.4) 에서 `new URL(file, manifestUrl)` 로 결합. 본 sprint 는 raw value 만.
- **Spine adapter 에서 경고 X**: `useCubismMeta` 가 `meta=null` 만 반환. AnimationPanel 의 isLive2D 가드가 먼저 잡아 안내 메시지 출력.
- **error 시 fallback 없음**: manifest 가 fetch 안 되면 빈 화면 + 빨간 줄. blob URL 의 model3.json 도 동일 코드 경로.

## 검증

- `pnpm typecheck` 통과
- `pnpm lint:fix` 통과 (2 file autofix)
- `pnpm build` 통과
- 시각 검증: `/edit/builtin/hiyori?tab=animation` 진입 시 모션 / 표정 카운트 정확히 표시 (Hiyori = Idle 1 그룹 / 9 entries / 0 expressions / 0 hit areas).
- ellen_joe 같은 풍부한 puppet → motions, expressions, hit areas 모두 채워짐.

## 다음 — 8.3

`components/animation/DisplaySection.tsx` 신규. kScale / X-Y shift 슬라이더 + 라이브 프리뷰. PuppetCanvas 의 transform 즉시 반영. IDB 저장은 8.7 까지 in-memory 만 (미리 형 잡기).
