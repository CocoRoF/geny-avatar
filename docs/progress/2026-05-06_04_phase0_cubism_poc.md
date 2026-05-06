# 2026-05-06 — Phase 0 Cubism PoC

Phase 0의 두 번째 PoC. 목표: Live2D Cubism 모델을 Pixi v8 위에 띄우고 drawable 토글이 작동하는지 검증.

## 검증할 것

- Cubism Core JS+wasm 정적 호스팅 (vendor → public/runtime/)
- Pixi v8 + Cubism 4 모델 호환 (`untitled-pixi-live2d-engine` 또는 fallback)
- Drawable / Part 토글 가능성 (T1 — texture hot-swap의 사전 단계)
- 어댑터 인터페이스 D4가 Live2D를 받아내는지 (Spine PoC에서 1차 검증한 인터페이스)

## 결정

- **모델**: Hiyori — Live2D Cubism Sample, General User EULA 통과 (hobby 컨텍스트)
- **런타임**: `untitled-pixi-live2d-engine` (Pixi v8 + Cubism 5 SDK 호환). pixi-live2d-display는 v6 한정이라 후순위
- **Cubism Core**: Live2D Inc. 폐쇄 바이너리. vendor 레포로 격리. `app/layout.tsx`에서 정적 `<script>` 로 사전 로드 (전역 `Live2DCubismCore`로 노출)

## 체크리스트 — 완료

- [x] `untitled-pixi-live2d-engine` v1.1.0 (Pixi v8 + Cubism 5 SDK)
- [x] Cubism Core (`live2dcubismcore.min.js` 207KB) → `vendor/cubism/Core/`
- [x] Hiyori 풀 모델 → `vendor/cubism/samples/Hiyori/` (model3.json, moc3 444KB, physics, cdi, pose, userdata, 2 atlas pages, 10 motions)
- [x] vendor `ae492e8` push, 메인 submodule pointer 갱신 (다음 commit에 묶음)
- [x] `pnpm add untitled-pixi-live2d-engine` → 1.1.0
- [x] `app/layout.tsx`에 `next/script`로 Core 사전 로드 (`strategy="beforeInteractive"`)
- [x] `app/poc/cubism/page.tsx` — Pixi Application + Hiyori + Part 토글 + Motion 라디오
- [x] typecheck OK, lint OK (1 format auto-fix), build OK (`/poc/cubism` 2.06 kB / 219 kB First Load)

## 진행 노트

### 11:35 — engine 패키지 정보

[GitHub repo](https://github.com/Untitled-Story/untitled-pixi-live2d-engine)에서 확인:
- npm: `untitled-pixi-live2d-engine` v1.1.0 (2026-04-29)
- API: `configureCubismSDK({ memorySizeMB: 32 })` + `Live2DModel.from('path/to/model3.json')`
- 외부 의존성: `live2dcubismcore.min.js`를 별도 로드 (전역 `Live2DCubismCore`로 노출돼야 함)
- pixi-live2d-display와 같은 모양의 internal 노출(`model.internalModel.coreModel`)이라 part/drawable API 접근 가능

### 11:38 — Cubism 자산 다운로드

- Cubism Core: `https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js` (CDN, 200 OK, 207KB) → vendor/cubism/Core/
- Hiyori: `Live2D/CubismWebSamples` 레포의 `Samples/Resources/Hiyori/`. CubismWebSamples 자체에는 Core JS가 들어있지 않음(CHANGELOG·README·LICENSE만) — RedistributableFiles.txt가 외부 다운로드를 안내. CDN 경로가 가장 깔끔.
- Hiyori 풀세트 19개 파일 다운로드 (model3.json 1.7KB, moc3 444KB, physics 26KB, 텍스처 두 장 ~4.3MB, 모션 10개 ~125KB).
- 텍스처 폴더명이 `Hiyori.2048` (해상도 표기 관례) — model3.json의 `FileReferences.Textures`가 `Hiyori.2048/texture_00.png`로 참조.

### 11:40 — vendor commit + push

vendor `git add cubism/` → `ae492e8 "Add Cubism Core 5 + Hiyori sample model"` → push. 메인의 working tree submodule pointer 자동으로 새 SHA 가리킴.

### 11:42 — engine 설치 + layout 와이어링

`pnpm add untitled-pixi-live2d-engine` 백그라운드 실행 (~30초, 작은 패키지). 끝나는 동안 layout 작업 병렬:
- `app/layout.tsx`에 `next/script` import + `<Script src="/runtime/live2dcubismcore.min.js" strategy="beforeInteractive" />` 추가.
- `beforeInteractive` 이유: Live2D 페이지가 mount되기 전에 전역 `Live2DCubismCore`가 준비되어야 engine init이 깨지지 않음.

**경고 — pnpm add가 또 package.json 덮어씀**: 이번에는 우리가 같은 시간에 편집하지 않아서 OK. 학습 적용됨.

### 11:46 — Cubism PoC 페이지

`app/poc/cubism/page.tsx` — 137줄, Spine PoC와 동일 레이아웃:

핵심 차이 (Cubism vs Spine):
1. **Cubism Core 대기**: Live2DCubismCore가 전역에 로드될 때까지 100ms × 50회 polling. 보통 즉시 사용 가능하지만 안전망.
2. **Dynamic import**: `await import("untitled-pixi-live2d-engine")` — 프로덕션 빌드의 dead code elimination을 보장하면서 Cubism 페이지에서만 engine bundle을 로드 (다른 페이지에서 219 KB가 안 들어옴).
3. **Configure**: `configureCubismSDK({ memorySizeMB: 32 })` — Cubism 5 SDK는 모델별 work memory를 사전에 잡음. 32MB가 표준 권장.
4. **Internal model**: `model.internalModel.coreModel` — pixi-live2d-display와 같은 내부 구조. `getPartCount()`, `getPartId(i)`, `getPartOpacity(i)`, `setPartOpacity(i, v)` 노출.
5. **Drawable vs Part**: 우리 PoC는 Part 단위만 토글 (큰 그룹 단위 — 머리/얼굴/몸 등). Drawable 단위 토글은 Phase 1에서 `setDrawableOpacity` 또는 `multiplyColor` alpha=0으로 가능.

**관찰 — Cubism 어댑터 인터페이스 1차 검증** (Spine 표와 비교):

| D4 인터페이스 메서드 | engine에서 가능 | 호출 |
|---|---|---|
| `load(files)` | yes | `configureCubismSDK` + `Live2DModel.from(model3JsonPath)` |
| `toPixiObject()` | yes | `Live2DModel`이 `Container` 상속 |
| `setLayerVisibility(layerId, visible)` | yes (Part 단위) | `coreModel.setPartOpacity(index, 0/1)` |
| `setLayerColor(layerId, rgba)` | partial (Drawable 단위) | `coreModel.setDrawableMultiplyColor(...)` 가능, Part 직접은 불가 |
| `setLayerTexture(layerId, png)` | T1 | atlas page 자체 교체. `internalModel.textures[i]` 갱신 후 redraw — 다음 검증 |
| `playAnimation(name)` | yes | `model.motion(group, index?)` — engine API. 실패 시 console.warn |
| `setParameter(name, value)` | yes | `coreModel.setParameterValueById(id, value)` — Cubism은 paramater first-class |
| `serialize()` | manual | overrides 직렬화는 우리 store |

### 11:55 — typecheck + lint + build

- typecheck (`tsc --noEmit`) — 0 errors
- lint (Biome) — 1 format issue (`await import(...)` 이전 빈 줄) → `pnpm lint:fix` 자동 수정 → 0 errors
- build — 7.5s 컴파일, `/poc/cubism` 2.06 kB 페이지 / 219 kB First Load (engine 동적 import 덕분에 spine PoC 270 kB보다 작음). 모든 라우트 정적 prerender 성공.

`'use client'` + Cubism Core가 `<Script>`로 inject되므로 SSR 단계는 placeholder만 그림. WebGL/wasm 사용은 모두 client side.

## 산출물

| 위치 | 무엇 |
|---|---|
| `app/layout.tsx` | Cubism Core `<Script>` beforeInteractive 추가 |
| `app/poc/cubism/page.tsx` | Cubism PoC 페이지, 137줄 |
| `package.json` | `untitled-pixi-live2d-engine` ^1.1.0 의존성 |
| vendor 레포 `ae492e8` | Cubism Core + Hiyori 풀세트 |
| 메인 레포 (다음 커밋) | submodule pointer + script wiring + PoC 페이지 |

## 어댑터 인터페이스 — 두 PoC 합산 검증

[plan/02 D4](../plan/02_architecture.md)의 어댑터 인터페이스가 양쪽에서 받아낼 수 있음을 확인. Phase 1에서 만들 `SpineAdapter` / `Live2DAdapter` 둘이 같은 인터페이스를 구현한다는 가정이 PoC 단계에서 깨지지 않음.

**다듬어야 할 부분**:
- `setLayerColor`가 비대칭 — Spine은 slot 단위 RGBA, Cubism은 Drawable 단위 (Part는 opacity만). 우리 `Layer.capabilities.canTint`로 Spine은 `'rgba'`, Cubism은 `'opacity-only'` 또는 `'multiply-rgb'`로 분기 표시.
- `setLayerTexture`는 둘 다 atlas page 픽셀 교체로 통합 가능. 단 Cubism은 텍스처 핸들 갱신 시 모델에 textures 배열 직접 수정 + GL 재바인딩 필요 (T1 검증 항목).
- `setParameter`는 Cubism만 first-class. Spine은 노출 안 함 (timeline-only). 우리 `Avatar.parameters`는 어댑터별 source 표시.

## 다음 PoC

T-rt1 — Spine과 Cubism을 같은 페이지(또는 같은 Pixi Application)에 동시 마운트하고 GL state·텍스처 바인딩 충돌이 있는지 본다. `app/poc/dual/page.tsx` 한 페이지로 두 인스턴스를 띄우는 게 가장 단순한 검증.

