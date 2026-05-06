# 2026-05-06 — Phase 0 Dual Mount (T-rt1)

Phase 0의 세 번째 PoC. 두 런타임을 같은 페이지·같은 Pixi Application에 동시 마운트하고 충돌이 있는지 검증.

## 검증할 것

- **T-rt1**: 같은 `Application.stage`에 spine-pixi-v8의 `Spine`과 untitled-pixi-live2d-engine의 `Live2DModel`이 같이 그려지는가
- GL state 충돌 (블렌딩 모드, 텍스처 바인딩, 스텐실)
- Asset 로드의 동시성 (Pixi Assets cache 키 충돌)
- 어댑터 인터페이스가 한 store에 둘 다 들어가는지의 prelude

## 실험 설계

가장 단순한 변형: 한 페이지에 두 캐릭터를 좌우로 배치.

```
[ Spine spineboy ]   [ Cubism Hiyori ]
       (좌)                  (우)
```

같은 `Application` 인스턴스, 같은 `stage`, 두 `Container` 자식. 한쪽이 다른 쪽 렌더링을 깨면 즉시 보임.

만약 같은 Application으로 안 되면 두 개 분리해서 두 canvas로 폴백 검증 (UI 단계에서 한 캔버스 1개를 권장하지만, 그게 안 되더라도 두 캔버스도 우리 V1에서 받아들일 수 있음).

## 체크리스트 — 완료

- [x] `app/poc/dual/page.tsx` — 한 Pixi Application + 두 자식 Container
- [x] Spine 좌측 (25% x), Cubism 우측 (75% x) 마운트
- [x] 자산 로드 격리 (Pixi Assets alias 두 개로 충돌 방지)
- [x] 상태 인디케이터 — pixi/spine/cubism 각각의 상태 chip
- [x] typecheck + lint (auto-format) + build 통과
- [x] 홈에 PoC 링크 3개 추가 (`/poc/spine`, `/poc/cubism`, `/poc/dual`)

## 진행 노트

### 12:00 — dual 페이지 작성

`app/poc/dual/page.tsx`:
- 단일 `Application` 인스턴스
- `app.stage`에 `leftHost`, `rightHost` 두 `Container` 자식
- Spine을 `leftHost`로, Cubism을 `rightHost`로
- `try/catch`를 두 런타임 각각 감싸서 한쪽이 실패해도 다른 쪽은 계속 진행
- 상단 status bar에 `pixi=ok · spine=ok · cubism=ok` chip 표시 — 한쪽 깨지면 즉시 가시화

**Asset alias 충돌 회피**: spine PoC는 `"spineboy-skel"`, dual은 `"dual-spine-skel"` — Pixi Assets는 alias 기반 캐시라 같은 alias로 두 번 등록하면 충돌. 컴포넌트별로 prefix를 다르게.

### 12:08 — 정적 검증

- typecheck — 0 errors
- lint — 1 format issue (`await import(...)` 줄 정리) → `lint:fix` 자동 수정 → 0 errors
- build — 7.5s 컴파일, 7개 정적 페이지 prerender 성공
  - `/poc/spine` 1.67 kB / 270 kB First Load (이전 134/236 → spine 코드가 shared chunk로 이동)
  - `/poc/cubism` 2.06 kB / 219 kB First Load
  - `/poc/dual` 1.46 kB / 270 kB First Load (spine + 동적 cubism 로드)

**관찰**: 한 페이지가 두 런타임을 모두 import하면 First Load가 270 kB로 spine PoC와 같음 — Cubism engine은 동적 import로 PoC 페이지에서만 해당 청크를 fetch. 즉 dual 페이지의 270 kB는 spine 청크만 정적 첨부, cubism은 page-load 후 fetch.

### 12:10 — T-rt1 정적 결론

빌드까지 깨지지 않은 것으로 다음을 확인:
1. 두 런타임이 서로의 import를 깨지 않음 (이름 충돌·중복 export 없음)
2. 같은 `Application` 인스턴스에 두 자식 Container를 추가하는 코드가 컴파일 통과
3. Pixi Assets cache는 alias prefix로 안전하게 분리 가능

**아직 검증 안 된 부분 (사용자 브라우저 시각 확인 필요)**:
- GL state 충돌 — Spine과 Cubism 둘 다 자체 셰이더·블렌드 모드를 쓰는데, 한쪽이 stencil/blend state를 두고 가서 다른 쪽 렌더가 깨지는지
- 텍스처 바인딩 점유 — atlas page 두 장 + Cubism 텍스처 두 장이 같은 GL 상태 공간에서 충돌하지 않는지
- 프레임 단위 성능 — 60fps 유지하는지

이 셋은 사용자가 `localhost:3000/poc/dual`을 열었을 때 비주얼/devtools로 즉시 확인 가능한 항목.

## 어댑터 인터페이스 — Phase 1 진입 가능 판단

세 PoC를 종합해서 [plan/02 D4](../plan/02_architecture.md) 어댑터 인터페이스의 다음을 확정:

```ts
interface AvatarAdapter {
  static detect(files: FileBundle): DetectionResult | null
  load(files: FileBundle): Promise<AvatarSnapshot>
  toPixiObject(): Container          // 양쪽 모두 Container 상속 OK
  setLayerVisibility(layerId, visible): void
  setLayerColor(layerId, rgba): void
  setLayerTexture(layerId, png): void
  playAnimation(name: string): void
  setParameter(name, value): void
  serialize(): AvatarSnapshot
  capabilities: AdapterCapabilities  // 비대칭 능력 분기
}

type AdapterCapabilities = {
  canChangeMesh: boolean             // Spine MeshAttachment yes, Cubism no
  canSwapTexture: boolean            // 둘 다 yes (T1 Phase 1 검증 항목)
  canTint: 'rgba' | 'multiply-rgb' | 'opacity-only'
                                     // Spine slot.color: rgba
                                     // Cubism Drawable: multiply-rgb (alpha 미사용)
                                     // Cubism Part: opacity-only
  hasAnimationTimeline: boolean      // Spine yes, Cubism yes (motion3.json)
  hasParameterGraph: boolean         // Cubism yes (first-class), Spine no
  layerUnit: 'slot' | 'drawable' | 'part'
                                     // Spine: slot
                                     // Cubism: drawable (정밀) 또는 part (그룹)
}
```

이걸 Phase 1에서 `lib/adapters/AvatarAdapter.ts` 인터페이스로 cement.

## Phase 0 종료 조건 체크

[plan/07 Phase 0 완료 조건](../plan/07_phased_roadmap.md):
- [x] spine-pixi-v8 PoC — slot 토글 작동 (정적 검증)
- [x] untitled-pixi-live2d-engine PoC — Hiyori 마운트, Part 토글 (정적 검증)
- [x] T-rt1 — 두 런타임이 같은 Pixi Application에 깨지지 않고 빌드됨 (시각 검증은 사용자)
- [ ] T-rt2 — Spine 3.8 호환 (real-world 자산 들고 검증 필요, Phase 1 자산 업로드 단계와 묶을 예정)
- [ ] T9 — Cubism 2/3 호환 (마찬가지)
- [x] 어댑터 인터페이스 1차 안 확정 (위 표)

T-rt2·T9는 사용자가 인터넷에서 다양한 버전의 자산을 들고 와야 검증 가능 — Phase 1의 업로드 흐름과 같이 자연스럽게 검증된다. 그래서 Phase 0의 단독 작업으로는 여기서 종료.

**Phase 0 부트스트랩 + 세 PoC = 종료 가능 상태**. 다음은 Phase 1 — 진짜 어댑터 클래스 + 업로드 흐름 + 레이어 패널.

