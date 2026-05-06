# 2026-05-06 — Phase 1.1: Adapter Interface + Two Adapter Classes

Phase 0 종료 → Phase 1 첫 step. 두 PoC에서 발견한 각 런타임 API의 모양을 [plan/02 D4](../plan/02_architecture.md)·[plan/04](../plan/04_data_model.md)의 추상화로 cement.

## 스코프

이 step에서 만드는 것:
- `lib/avatar/types.ts` — Avatar / Layer / Texture / Variant / Parameter 등 코어 도메인 타입
- `lib/avatar/id.ts` — 안정 ID 생성 헬퍼
- `lib/adapters/AvatarAdapter.ts` — 어댑터 인터페이스 + capabilities 타입
- `lib/adapters/SpineAdapter.ts` — spine-pixi-v8 wrapping
- `lib/adapters/Live2DAdapter.ts` — untitled-pixi-live2d-engine wrapping

이 step에 **포함하지 않는 것** (이후 step):
- PoC 페이지를 어댑터로 리팩터 (다음 step)
- `AvatarRegistry` + `FormatDetector` (drag-drop 업로드와 함께)
- Zustand 스토어
- LayersPanel React 컴포넌트

## 결정

### 어댑터는 interface, 일부 default는 abstract class로

`AvatarAdapter`를 TypeScript interface로 정의하되, 공통 헬퍼(예: id 매핑, draw order 추출)가 필요해지면 `BaseAvatarAdapter` abstract class를 도입. 지금은 interface만으로 충분.

### Capability flag 구조

PoC 검증을 통해 확정한 비대칭:

```ts
type AdapterCapabilities = {
  layerUnit: 'slot' | 'drawable' | 'part'
  canChangeMesh: boolean
  canSwapTexture: boolean
  tinting: 'rgba' | 'multiply-rgb' | 'opacity-only'
  hasAnimationTimeline: boolean
  hasParameterGraph: boolean
  hasPhysics: boolean
}
```

- Spine: `layerUnit: 'slot'`, `canChangeMesh: true`, `canSwapTexture: true`, `tinting: 'rgba'`, `hasAnimationTimeline: true`, `hasParameterGraph: false`, `hasPhysics: true` (4.2+)
- Cubism: `layerUnit: 'part'` (PoC는 part 단위), `canChangeMesh: false`, `canSwapTexture: true`, `tinting: 'opacity-only'` (Part) / `'multiply-rgb'` (Drawable), `hasAnimationTimeline: true`, `hasParameterGraph: true`, `hasPhysics: true`

Cubism의 경우 부위별 토글은 Part 단위가 자연스럽고, Drawable 단위는 Phase 1 후반(텍스처 분해와 함께)에서 노출.

### load는 URL bundle로 받음 (당분간)

Phase 1.x 후반에 drag-drop 업로드를 다룰 때 File API → in-memory blob URL로 정규화. 그 시점에 `AssetBundle`을 추가. 지금은 PoC와 같은 형태로 `{ kind: 'urls', urls: {...} }`만 받음.

## 진행 노트

### 12:30 — 도메인 타입

`lib/avatar/types.ts` (165줄):
- `Avatar` 루트 + `Layer`/`LayerGroup`/`Texture`/`TextureSlice`/`Variant`/`AnimationRef`/`Parameter`
- `AvatarSource` 판별합집합 — Spine과 Live2D가 다른 파일 구성을 가진 게 자연스럽게 표현 (Spine: skeleton/atlas/pages, Live2D: model3/moc3/textures/physics/cdi/...).
- `AssetRef` 판별합집합 — `url` (PoC) / `idb` (업로드 후 영구) / `inline` (drop 직후 메모리)
- `RGBA`/`Rect`/`Polygon`/`UVIsland` 같은 작은 primitive

`lib/avatar/id.ts` (33줄):
- `newId(prefix)` — 12자 base32 random + 짧은 prefix. ULID 안 씀 (lex sortable 불요)
- `ID_PREFIX` 상수 — av/ly/lg/tx/va/an/pm/ad/jb. 디버깅 시 `ly_X8K3MN0PQR2W` 보면 즉시 layer 식별 가능

### 12:35 — 어댑터 인터페이스

`lib/adapters/AvatarAdapter.ts` (90줄):
- `AdapterCapabilities` — PoC 검증으로 확정한 비대칭 (layerUnit / canChangeMesh / canSwapTexture / tinting / hasAnimationTimeline / hasParameterGraph / hasPhysics)
- `FormatDetectionResult` — `runtime`, `version?`, `confidence: 'high' | 'low'`. Phase 1.x의 `FormatDetector`가 어댑터의 `static detect()`를 호출
- `AdapterLoadInput` 판별합집합 — `kind: 'spine'` (skeleton+atlas URL) 또는 `kind: 'live2d'` (model3 URL). drag-drop 업로드 단계에서 `kind: 'spine-bundle'` 등을 추가할 자리

### 12:42 — SpineAdapter

`lib/adapters/SpineAdapter.ts` (185줄). PoC 페이지의 spine 로딩 + 토글 코드를 어댑터 클래스로 옮김:
- `static detect(filenames)`: 파일명 휴리스틱 (`.atlas` + `.skel`/`.json`)
- `load(input)`: `Assets.add` × 2 + `Assets.load` → `Spine.from`. Pixi Assets cache 충돌 방지를 위해 alias prefix(default: `spine-${randomId}`)로 격리. 슬롯 → `Layer[]`, 애니메이션 → `AnimationRef[]` 변환.
- `setLayerVisibility`: 슬롯 attachment를 default로 복원 또는 null로 끄기
- `setLayerColor`: `slot.color.{r,g,b,a}` 직접 — Spine은 RGBA 모두 적용
- `getDisplayObject()`: `Spine` 인스턴스 (Pixi `Container` 상속이라 그대로 stage에 add 가능)
- `destroy()`: `spine.destroy()` + 매핑 클리어

`layerByExternalId` + `slotIndexByExternalId` 두 Map으로 `LayerId → 슬롯 객체` 변환을 O(1)에 가깝게 유지.

### 12:50 — Live2DAdapter

`lib/adapters/Live2DAdapter.ts` (245줄). Cubism PoC 코드를 어댑터로:
- `static detect(filenames)`: `.model3.json` 있으면 high-confidence, `.moc` (구버전)이면 low-confidence (Cubism 2/3 best-effort)
- `load(input)`: `waitForCubismCore` (timeout 5s) → engine `await import` (dynamic) → `configureCubismSDK` → `Live2DModel.from`. coreModel을 통해 Part·Parameter 열거. 모션은 `internalModel.settings.motions` 매니페스트에서 추출.
- `setLayerVisibility`: `coreModel.setPartOpacity(index, 0/1)`
- `setLayerColor`: alpha 채널만 honor — capabilities `tinting: 'opacity-only'`와 일치
- `setParameter`: `coreModel.setParameterValueById(id, value)` — Spine과 다른 first-class 기능
- `getParameters()`: live 추출 (load 시 한 번 + 추후 재호출 가능)

engine import는 `await import("untitled-pixi-live2d-engine")`라 SpineAdapter만 쓰는 페이지는 engine bundle을 다운로드하지 않음.

### 13:00 — 정적 검증

- typecheck (`tsc --noEmit`) — 0 errors
- lint (Biome) — 5 format issues → `lint:fix` 자동 수정 → 0 errors
- build — 통과. 페이지 사이즈 변동 없음 — 어댑터는 아직 import 안 되므로 dead code.

## 산출물

| 파일 | 라인 | 역할 |
|---|---|---|
| `lib/avatar/types.ts` | 165 | 도메인 타입 — Avatar/Layer/Texture/Variant/Parameter |
| `lib/avatar/id.ts` | 33 | 안정 ID 생성 (ly_X8K3MN0PQR2W 형태) |
| `lib/adapters/AvatarAdapter.ts` | 90 | 어댑터 인터페이스 + capabilities |
| `lib/adapters/SpineAdapter.ts` | 185 | spine-pixi-v8 wrapping |
| `lib/adapters/Live2DAdapter.ts` | 245 | untitled-pixi-live2d-engine wrapping |

## 다음 (Phase 1.2)

`AvatarRegistry` — 어댑터 카탈로그 + 자동 detect 라우팅. PoC 페이지를 어댑터 사용 패턴으로 리팩터해서 어댑터가 실제로 동작하는지 confirms. 그 다음 drag-drop 업로드 흐름.

