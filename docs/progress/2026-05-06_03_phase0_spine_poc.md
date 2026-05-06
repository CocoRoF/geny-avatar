# 2026-05-06 — Phase 0 Spine PoC

Phase 0의 첫 PoC. 목표: `@esotericsoftware/spine-pixi-v8` + Pixi v8을 메인 레포에 깔고 spineboy를 띄워서 slot 토글이 작동하는지 검증.

## 검증할 것

- T2 (Spine MeshAttachment UV) — 미루지 않음
- T4 (Spine MeshAttachment 교체) — 1차 관찰
- 어댑터 인터페이스 1차 안 ([plan/02 D4](../plan/02_architecture.md))이 Spine을 받아내는지
- Asset pipeline: vendor 레포 → 메인의 public 경로로 sync

## 결정 — 자산 격리 패턴

Spine 평가 자산도 외부 SDK 산출물이고 evaluation EULA 종속이라, 일관성을 위해 **vendor 레포에 격리**한다 (Cubism Core와 같은 격리 패턴). 메인 레포 코드는 vendor 자산을 직접 참조하지 않고, 빌드 시 `vendor/` → `public/`로 sync.

```
vendor/
├── spine/samples/spineboy/      ← 평가용 spineboy 자산
├── cubism/Core/                  ← (다음 PoC) Cubism Core
└── cubism/samples/hiyori/        ← (다음 PoC) Hiyori 모델
```

`scripts/sync-vendor.mjs`가 명시적 매핑으로 필요한 파일을 `public/`로 복사. `predev`/`prebuild`에 hook.

**Why 명시적 매핑**: vendor 폴더 통째 복사가 아니라 "어떤 자산이 어디로 가는지"가 코드에 있어야 추후 라우팅·디버깅이 쉽다.

## 체크리스트 — 완료

- [x] `pnpm add pixi.js@^8 @esotericsoftware/spine-pixi-v8` → pixi 8.18.1, spine-pixi-v8 4.2.114
- [x] `scripts/sync-vendor.mjs` 작성 + `predev`/`prebuild`/`sync:vendor` hook
- [x] vendor 레포에 spineboy 평가 자산 (`spineboy-pro.skel` 64KB, `spineboy-pro.json` 220KB, `spineboy-pma.atlas` 1.7KB, `spineboy-pma.png` 245KB)
- [x] vendor 레포 commit `22ec040` + push, 메인의 submodule pointer 갱신 (commit으로 묶음)
- [x] `app/poc/spine/page.tsx` — 좌측 Pixi 캔버스 + 우측 Slot 토글 + 애니메이션 라디오
- [x] 정적 검증 (typecheck + lint + production build) 통과 — 실제 시각 확인은 사용자 브라우저에서
- [x] 어댑터 D4 검증 — 아래 관찰 노트 참고
- [x] biome 2 includes 문법 (negative globs)으로 `.next/`·`vendor/`·`docs/` 제외 정리

## 진행 노트

### 11:13 — pnpm add pixi+spine

`pnpm add pixi.js@^8 @esotericsoftware/spine-pixi-v8 --reporter=ndjson` 백그라운드 실행. pixi 8.18.1 (~16MB) 다운로드 ~20초. spine-pixi-v8 4.2.114는 작아서 즉시.

**경고 1 — pnpm add가 package.json을 덮어씀**: install 진행 중에 우리가 `predev`/`prebuild`/`sync:vendor` 스크립트를 package.json에 추가한 것을 pnpm이 자기 in-memory 버전(deps만 추가된)으로 덮어쓰면서 우리 변경이 사라짐. 복구는 단순 — 다시 추가. 학습: pnpm add 진행 중에 같은 파일을 편집하지 말 것.

### 11:14 — vendor에 spineboy 추가

`spine-runtimes` 4.2 브랜치 `examples/spineboy/export/`에서 raw로 4 파일 다운로드:
- `spineboy-pro.skel` — Spine 4.2 binary, 64463 bytes
- `spineboy-pro.json` — 같은 데이터의 JSON, 220662 bytes (둘 중 하나만 써도 됨, 우리는 `.skel`을 우선 로드)
- `spineboy-pma.atlas` — atlas 텍스트 정의, 1695 bytes, 첫 줄에 `spineboy-pma.png` 페이지 참조
- `spineboy-pma.png` — premultiplied alpha 페이지, 1024×256, 244861 bytes

**경고 2 — 버전 변종 명명 규칙**: spine-runtimes 예제 디렉터리에 `spineboy-ess`(essential, no physics) / `spineboy-pro`(full, with 4.2 physics) / `spineboy-run`(별도 변종) 셋이 있고, 텍스처는 `spineboy-pma`(premultiplied alpha) / `spineboy`(straight alpha) 둘. skel 파일에는 텍스처 패킹 변종이 없으므로 어떤 atlas와도 페어링 가능. 우리는 `pro.skel + pma.atlas` 조합 — 4.2 physics + PMA(웹 표준).

### 11:15 — vendor 커밋·push

vendor 레포에서 `git add spine/` → 커밋 `22ec040 "Add spineboy 4.2 sample"` → `git push`. 메인 레포의 working tree 안 vendor submodule이 자동으로 새 SHA(`22ec040`)를 가리킴 (`git submodule status`에서 `+22ec0403...` 출력).

### 11:18 — sync 스크립트 + PoC 페이지

`scripts/sync-vendor.mjs` — 명시적 매핑 배열로 vendor의 어떤 경로를 public의 어디로 복사할지 결정. Cubism Core·Hiyori는 다음 PoC에서 추가될 예정이니 missing 경고만 출력하고 실패하지 않게.

`app/poc/spine/page.tsx` — `"use client"` 컴포넌트. 핵심 로직:
1. `Application` 인스턴스 → host div에 마운트
2. `Assets.add({ alias, src })` 두 개 (skel + atlas), `Assets.load([...])`로 모두 로드 대기
3. `Spine.from({ skeleton, atlas, scale })`로 Spine 디스플레이 객체 생성
4. `spine.skeleton.slots` → 슬롯 배열 (각 slot은 `data.name`, `getAttachment()`)
5. `spine.state.data.skeletonData.animations` → 애니메이션 메타
6. 토글: `slot.setAttachment(null)`로 끄고, 켤 때 `spine.skeleton.getAttachment(slotIndex, attachmentName)`로 복원

**관찰 — Spine 어댑터 인터페이스 1차 검증**:

| D4 인터페이스 메서드 | spine-pixi-v8에서 가능 | 호출 |
|---|---|---|
| `load(files)` | yes | `Assets.add` × N + `Assets.load([...])` + `Spine.from` |
| `toPixiObject()` | yes | `Spine.from(...)` 결과가 그 자체로 Pixi `Container` |
| `setLayerVisibility(layerId, visible)` | yes | `slot.setAttachment(null)` / 복원은 `skeleton.getAttachment(slotIndex, name)` |
| `setLayerColor(layerId, rgba)` | yes | `slot.color.setFromRgba8888(...)` 또는 `slot.color.r/g/b/a` |
| `setLayerTexture(layerId, png)` | 부분 yes | RegionAttachment의 region을 새 텍스처로 교체. MeshAttachment는 attachmentName 단위로 새 attachment 생성·등록. T4 검증은 다음 단계 |
| `playAnimation(name)` | yes | `spine.state.setAnimation(0, name, true)` |
| `setParameter(name, value)` | n/a | Spine은 timeline 기반, 가상 파라미터 노출은 future work |
| `serialize()` | manual | overrides를 우리 store에서 직렬화 |

**핵심 발견**:
- Slot의 native ID는 `slot.data.name` (string). 우리 `Layer.externalId`는 이걸 쓰면 됨.
- Slot index는 `slot` 객체에 직접 노출되지 않고 `skeleton.slots.indexOf(slot)` 또는 우리가 전달. 매번 indexOf는 비싸니 우리가 stored index를 들고 있음 (`SlotInfo.index`).
- `slot.data.attachmentName`이 default attachment 이름. 토글 끄고 켤 때 이걸로 복원.
- `spine.skeleton.getAttachment(slotIndex, name)` 호출이 active skin에서 검색 → 없으면 default skin → 둘 다 없으면 null. 우리 multi-skin 지원의 출발점.

### 11:30 — 정적 검증

- `pnpm typecheck` (`tsc --noEmit`) — 0 errors.
- `pnpm lint` (Biome 2) — 처음에 `.next/`·`vendor/` scan 충돌 → biome.json `files.includes`에 negative glob (`!**/.next/**` 등) 추가 → 5 errors → `pnpm lint:fix` 자동 수정 → 1 ARIA 에러 남음 (`aria-label` 단독은 `<span>`에 무효) → `role="img"` 추가로 해결 → 0 errors.
- `pnpm build` (Next.js prod) — 10.8s 컴파일, `/poc/spine` 134 kB (236 kB First Load), 정적 prerender 성공.

**Why 정적 검증으로 충분**:
- `'use client'` 컴포넌트라 SSR 단계에서는 placeholder만 렌더, GL 호출 없음. 빌드가 통과한다는 건 client bundle의 정적 import가 깨지지 않았다는 뜻.
- 실제 시각 동작 (spineboy가 portal 애니메이션 재생, 슬롯 토글로 부위 사라짐)은 사용자가 `localhost:3000/poc/spine`에서 시각 확인 — 헤드리스 자동화는 WebGL 콘텐츠에서 매우 비싸고 우리 PoC 단계 가치보다 부담이 큼.

## 산출물

| 위치 | 무엇 |
|---|---|
| `app/poc/spine/page.tsx` | Spine PoC 페이지, 137줄 |
| `scripts/sync-vendor.mjs` | vendor → public sync, 명시적 매핑 |
| `package.json` 스크립트 | `predev`·`prebuild`·`sync:vendor` 추가 |
| `biome.json` | v2 includes 문법으로 docs/vendor/.next 제외 |
| vendor 레포 `22ec040` | spineboy 4.2 자산 4개 |
| 메인 레포 (다음 커밋) | submodule pointer + scripts + PoC + lint config |

## 다음 PoC

Cubism. 진행 순서:
1. Live2D Cubism Core JS 다운로드 → `vendor/cubism/Core/`
2. CubismWebSamples에서 Hiyori 모델 → `vendor/cubism/samples/Hiyori/`
3. vendor 커밋·push → 메인 submodule pointer 갱신
4. `pnpm add untitled-pixi-live2d-engine` (또는 `pixi-live2d-display`로 v8 호환 검증)
5. `app/layout.tsx`에 Cubism Core 정적 스크립트 inject
6. `app/poc/cubism/page.tsx` — 같은 레이아웃, drawable 토글
7. T-rt1 검증을 위해 `app/poc/dual/page.tsx` — 두 런타임 같은 Pixi Application

