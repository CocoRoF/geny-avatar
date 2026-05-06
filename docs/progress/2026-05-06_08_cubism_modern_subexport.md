# 2026-05-06 — Cubism Modern Sub-export Fix

## 문제

브라우저에서 `/poc/cubism` 시각 검증 시 런타임 에러:

```
error: Could not find Cubism 2 runtime. This plugin requires live2d.min.js to be loaded.
```

## 원인

`untitled-pixi-live2d-engine`은 `package.json`에 4개의 sub-export를 노출:

```
.                  combined (Cubism Modern + Cubism 2/3 legacy)
./cubism           Cubism Modern only (4/5)
./cubism-legacy    Cubism 2/3 only
./extra            lipsync 등 부가
```

우리가 default(`untitled-pixi-live2d-engine`)를 import하면 combined 번들이 로드되고, 런타임 init 단계에서 `live2d.min.js` (Cubism 2 legacy core)도 같이 요구됨. 우리는 Hiyori 같은 Cubism 4 모델만 쓰니 modern only로 충분. WebFetch에서 본 README의 안내도 동일: "default for combined, `'untitled-pixi-live2d-engine/cubism'` for Cubism Modern only".

## 수정

3곳에서 import 경로 변경:

```diff
- await import("untitled-pixi-live2d-engine")
+ await import("untitled-pixi-live2d-engine/cubism")
```

- `app/poc/cubism/page.tsx`
- `app/poc/dual/page.tsx`
- `lib/adapters/Live2DAdapter.ts`

Cubism 2/3 best-effort 지원 ([analysis/03 T-rt2·T9](../analysis/09_open_questions.md))은 Phase 1.x에서 별도 어댑터(`Live2DLegacyAdapter`?) 또는 Live2DAdapter 안에서 모델 버전 감지 후 sub-export 분기로 풀자. 지금은 modern만.

## 검증

- typecheck: 0
- lint: 0 (1 format auto-fix)
- build: 통과 (`/poc/cubism` 2.4 kB / 219 kB First Load 변동 없음 — sub-export가 같은 번들 사이즈 영역)

## 다음

Phase 1.2 — AvatarRegistry + PoC 페이지를 어댑터 사용 패턴으로 리팩터.
