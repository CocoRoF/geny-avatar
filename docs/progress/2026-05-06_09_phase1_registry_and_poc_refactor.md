# 2026-05-06 — Phase 1.2: AvatarRegistry + PoC pages on adapter classes

Phase 1.1에서 만든 어댑터 인터페이스·구현이 실제 코드 경로에서 작동하는지 검증. PoC 페이지를 어댑터 사용 패턴으로 리팩터해서 동작 1:1 보존을 확인하면, Phase 1.3의 drag-drop 업로드를 어댑터 위에 자연스럽게 얹을 수 있다.

## 스코프

- `lib/adapters/AvatarRegistry.ts` — 어댑터 카탈로그 + 자동 detect 라우팅
- `app/poc/spine/page.tsx` — `SpineAdapter` 사용으로 리팩터
- `app/poc/cubism/page.tsx` — `Live2DAdapter` 사용으로 리팩터
- `app/poc/dual/page.tsx` — 두 어댑터 사용으로 리팩터
- 새 React 훅 `usePuppet`이 어댑터 라이프사이클(`load` → `getDisplayObject` → `destroy`)을 캡슐화

## 결정

### Registry는 그냥 어댑터 클래스의 모음 + detect 우선순위

지금은 두 개라 굳이 인터페이스 디자인을 무겁게 할 필요 없음. 단순한 모듈 — `getAdapterFor(input)`이 input의 `kind`로 어댑터를 instantiate. drag-drop 업로드 단계에서 `detectFromBundle(filenames)`이 추가됨.

### 훅 vs 클래스 컴포넌트

PoC 페이지마다 같은 마운트/해제 패턴이 반복됨. `usePuppet({ kind, ... })` 훅 하나로 묶으면 페이지 코드는 입력 + UI에만 집중. Phase 1의 본 LayersPanel/LivePreview 컴포넌트도 같은 훅을 쓰게 만든다.

### PoC는 자체 미니 LayersPanel을 들고 있음

Phase 1.4의 본 LayersPanel은 Zustand 스토어 + variant 시스템과 통합되어야 해서 따로 만든다. PoC의 사이드바는 로컬 state로 빠르게 어댑터 호출을 검증하는 용도로 유지.

## 진행 노트

### 14:10 — AvatarRegistry + usePuppet

`lib/adapters/AvatarRegistry.ts` — 단순 모듈:
- `createAdapter(input)` — `kind`로 어댑터 instantiate
- `detectFromFilenames(filenames)` — 모든 어댑터의 `static detect()`를 돌려 best match. drag-drop 업로드 흐름의 진입점.
- 어댑터 카탈로그는 그냥 const array. 세 번째 어댑터 들어오면 그때 DI 디자인 검토.

`lib/avatar/usePuppet.ts` — React 훅. 책임:
- Pixi `Application` init + 호스트 div mount
- 어댑터 instantiate + `load(input)` + `getDisplayObject()`을 stage에 add
- `onMount` 콜백으로 페이지별 위치/스케일 적용 (Spine slot pivot vs Cubism 1500px model space가 달라서 hook 안에 일반화하지 않음)
- cleanup: `adapter.destroy()` + `app.destroy()`

cancellation 가드를 모든 await 사이에 둬서 입력 변경/언마운트 시점에 dangling Pixi context를 만들지 않음.

### 14:25 — /poc/spine 어댑터 사용으로 리팩터

이전 (PoC 1차): `app/poc/spine/page.tsx`가 `Spine.from`/`Assets`를 직접 호출.
이후: `usePuppet({ kind: 'spine', skeleton, atlas })` → state에서 `avatar`·`adapter`·`app` 받음. layer 목록은 `avatar.layers`, 토글은 `adapter.setLayerVisibility`.

페이지 코드가 ~30 LoC 짧아짐 + spine-pixi-v8 import가 PoC 페이지에서 사라짐 (어댑터로 격리).

### 14:35 — /poc/cubism 어댑터 사용으로 리팩터

같은 패턴. `usePuppet({ kind: 'live2d', model3 })` 한 번. Part 토글도 `adapter.setLayerVisibility`로 통일 — 페이지 코드는 더 이상 `coreModel.setPartOpacity` 같은 engine 내부를 모름.

display 객체에 `anchor.set`/`position.set`/`scale.set` 호출은 Pixi `Container`의 표준 API라 굳이 어댑터 메서드로 노출하지 않음.

### 14:45 — /poc/dual 어댑터 사용으로 리팩터

`usePuppet`은 단일 puppet용이라 dual 페이지는 직접 `Application` 인스턴스 + `new SpineAdapter()` + `new Live2DAdapter()` 두 어댑터 인스턴스. 두 자식 Container에 각각 mount.

페이지 코드는 짧아졌지만 여전히 `Application.init`을 손으로 다룸 — 어댑터 두 개를 한 application에 거는 use case가 V1에는 한 번만 등장 (LayersPanel UI는 한 puppet씩) 이라 일반화 안 함.

### 14:50 — 검증

- typecheck: 0
- lint: 5 format issues → `lint:fix` 자동 수정 → 0
- build: 통과
  - `/poc/spine` 2.23 kB / 273 kB First Load (이전 2.03/270 — 어댑터·훅 import로 +3 kB)
  - `/poc/cubism` 2.28 kB / 273 kB (이전 2.4/219 — 사실상 동일, shared chunks 정리)
  - `/poc/dual` 1.4 kB / 273 kB (변동 minimal)

페이지 코드가 어댑터 인터페이스 위에서 작동하는데 빌드가 통과한다는 건 인터페이스가 실제로 두 런타임을 받아낸다는 1차 회귀.

## 산출물

| 파일 | 라인 | 역할 |
|---|---|---|
| `lib/adapters/AvatarRegistry.ts` | 50 | 어댑터 카탈로그, createAdapter, detectFromFilenames |
| `lib/avatar/usePuppet.ts` | 130 | 단일 puppet 마운트 React 훅 |
| `app/poc/spine/page.tsx` | 180 | usePuppet + adapter 사용으로 축약 |
| `app/poc/cubism/page.tsx` | 186 | 같은 패턴 |
| `app/poc/dual/page.tsx` | 139 | 두 adapter 인스턴스를 한 Application에 |

## 다음 (Phase 1.3)

- **Drag-drop 업로드 흐름** — 사용자가 ZIP 또는 폴더를 drop → 압축 해제 → `detectFromFilenames` → `createAdapter` → IndexedDB(Dexie)에 저장 → 다시 로드.
- AssetBundle 추상화 — 현재는 `kind: 'spine'/'live2d'`가 URL을 들고 있는데, 업로드는 in-memory blob에서 시작. AdapterLoadInput에 `blob` variant 추가.

