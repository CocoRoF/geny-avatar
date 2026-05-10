# 2026-05-10 — Phase A.8 (hotfix): basePath prefix on public assets

A.2 가 fetch 와 navigation 은 basePath 정합화했지만 **`<Script src>` + `BUILTIN_SAMPLES.loadInput` + PoC 페이지의 hardcoded `"/samples/..."` 경로** 가 빠졌음. Geny 통합 환경 (basePath=`/avatar-editor`) 에서 `/samples/hiyori/...` 와 `/runtime/live2dcubismcore.min.js` 가 nginx 의 catch-all (`location /`) 로 흘러서 frontend 로 가버리고 404 → Hiyori 빌트인 진입 시 "Live2DCubismCore not available" 에러.

## 증상 (사용자 보고)

`https://geny-x.hrletsgo.me/avatar-editor/edit/builtin/hiyori` 진입:
> error: Live2DCubismCore not available — /runtime/live2dcubismcore.min.js failed to load

## 원인

Next.js 의 `basePath` 자동 prepend 가 적용되는 곳:
- `<Link href>` ✓
- `useRouter().push()` ✓
- `<Image src>` ✓
- 정적 자산 (`_next/...` chunks) via `assetPrefix` ✓

**자동 prepend 가 안 되는 곳**:
- `<Script src>` from `next/script` ✗
- `fetch("/api/...")` ✗ (A.2 에서 `apiUrl()` 헬퍼로 해결)
- 사용자 코드의 hardcoded `"/static-asset"` 경로 ✗

A.2 는 fetch / Link 만 손봤는데 정작 Script + 빌트인 샘플 경로는 누락.

## 변경 surface

### `lib/basePath.ts`

`assetUrl(path)` 신규 (apiUrl 의 자매). 기능적으로 동일 (`${BASE_PATH}${path}`) 이지만 자산 vs API 구분 시각화.

### `app/layout.tsx`

```diff
- <Script src="/runtime/live2dcubismcore.min.js" strategy="afterInteractive" />
+ <Script
+   src={assetUrl("/runtime/live2dcubismcore.min.js")}
+   strategy="afterInteractive"
+ />
```

이게 본 사용자 보고의 직접 원인. Hiyori 진입 시 즉시 해결.

### `lib/builtin/samples.ts`

Hiyori `model3` + spineboy `skeleton`/`atlas` 3개 path 모두 `assetUrl()` wrap.

### PoC 페이지 6개 path

`app/poc/spine/page.tsx`, `app/poc/cubism/page.tsx`, `app/poc/dual/page.tsx` 의 `INPUT.skeleton` / `atlas` / `model3` 6개 모두 wrap.

### `package.json` 0.2.2 → 0.2.3 + landing chip 갱신

## 검증

- `pnpm build` (default basePath 빈 문자열) — `assetUrl("/x") === "/x"` → root 동작 무손상.
- `NEXT_PUBLIC_BASE_PATH=/avatar-editor pnpm build` — 모든 자산 path 가 `/avatar-editor/...` 로 inline.
- typecheck 통과.
- 9개 hardcoded 경로 grep — `BASE_PATH` 도 docstring 예외 외에는 모두 `assetUrl()` wrapping.

## 다음

geny-avatar `v0.2.3` tag + push. Geny 의 submodule pin 갱신 + avatar-editor 컨테이너 rebuild.
