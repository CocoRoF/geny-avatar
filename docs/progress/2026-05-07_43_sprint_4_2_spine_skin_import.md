# 2026-05-07 — Sprint 4.2: Spine Skin → Variant import

[`41 phase4_kickoff`](2026-05-07_41_phase4_kickoff.md)의 두 번째 sub-sprint. 4.1의 visibility-only Variant 위에 **Spine Skin**(런타임이 puppet 안에 baked해 둔 의상 프리셋)을 IDB Variant로 import + apply 하는 경로를 얹는다.

## 변경 surface

### 도메인 타입 확장 (`lib/avatar/types.ts`)

```ts
type VariantApplyData = {
  spineSkin?: string;                      // setSkinByName 인자
  // future: live2dGroup, ...
};

type NativeVariantSource = "spine-skin" | "live2d-group";

type NativeVariant = {
  source: NativeVariantSource;
  externalId: string;                       // skin name 등 stable runtime id
  name: string;
  description?: string;
  applyData: VariantApplyData;
};
```

추후 어떤 런타임 프리셋을 더 얹어도 `applyData`에 옵셔널 필드 추가만 하면 모든 호출 surface가 동작 — 마치 GenerateRecord처럼 open-ended.

### `AvatarAdapter` 인터페이스 — 3개 메서드 추가

```ts
listNativeVariants(): NativeVariant[];
applyVariantData(data: VariantApplyData): void;
getActiveVariantData(): VariantApplyData;
```

- **list**: puppet에 baked된 프리셋 열거 (Spine 6개 / Cubism 0개)
- **apply**: 런타임에 push (Spine: setSkinByName + setSlotsToSetupPose / Cubism: no-op)
- **getActive**: 현재 활성 프리셋 (Spine: `skeleton.skin?.name` / Cubism: `{}`) — capture 시 같이 묶어 저장하기 위함

### SpineAdapter — 3개 모두 구현

`skeleton.data.skins`를 그대로 매핑. Default skin도 포함 (사용자가 import 후 다른 skin → default skin을 다시 적용해 원래 모습 복원하기 위함). `applyVariantData`는 `setSkinByName(name)` 후 `setSlotsToSetupPose()`로 슬롯 attachment를 새 skin의 setup pose로 즉시 갱신.

### Live2DAdapter — stub만

`listNativeVariants` → `[]`, `applyVariantData` → no-op, `getActiveVariantData` → `{}`. cdi3 group 정보는 4.3에서 채울 예정. 4.2는 의도적으로 Spine만.

### `VariantRow` v4 마이그레이션 (`lib/persistence/db.ts`)

```ts
type VariantRow = {
  // ... 기존 필드 ...
  applyData?: VariantApplyData;             // 4.2 추가
  source: "user" | NativeVariantSource;     // 4.2 추가 (required)
  sourceExternalId?: string;                // import dedup 키
};
```

Dexie v4 마이그레이션은 인덱스 그대로 + `.upgrade()` 핸들러로 v3 row들에 `source: "user"` backfill. 기존 사용자 캡처는 그대로 user-made으로 표기.

### `useVariants` 훅 확장

- `capture(name, visibility, layers, opts?)` — `opts.applyData`를 받아 활성 skin 같이 영구화
- 신규 `importNative(native)` — `(source, sourceExternalId)` 중복 시 기존 row 반환
- `apply` 반환 shape 변경: `Record<LayerId, boolean>` → `{ visibility, applyData }` 번들
- 신규 `filterUnimportedNativeVariants(natives, variants)` — panel "from puppet" 드롭다운에서 이미 import된 항목 제외

### `usePuppetMutations.applyVariant`

`applyVisibilityMap`만으론 부족. Variant 적용은 (1) `adapter.applyVariantData(applyData)` 먼저 → skeleton의 슬롯 attachment 재배치, (2) skin 변경 시 store의 기존 visibility를 다시 push (setSlotsToSetupPose가 슬롯을 리셋하므로), (3) 마지막으로 variant의 `visibility` overlay를 history와 함께 apply. 순서가 중요해서 별도 액션으로 묶음.

Skin 전환 자체는 history에 안 들어감 — visibility step만 들어감. 이전 skin으로 되돌리려면 그 skin variant를 다시 클릭하면 됨.

### `VariantsPanel` 확장

- 새 prop: `adapter: AvatarAdapter | null`, `onApplyVariant: (bundle) => void` (기존 `onApplyVisibility` 대체)
- 헤더에 `+ from puppet (N)` 버튼 — 클릭하면 import 가능한 native variants 인라인 패널이 열림
- 각 native row에 `import` 버튼 — 한 번 import되면 다음 render부터 import 가능 목록에서 빠짐
- 행 메타: variant.source가 user 아니면 `skin:Casual` 같은 작은 mono 라벨, layerCount는 0이면 숨김
- "No variants yet" 안내문도 native가 있으면 다른 카피 ("Import a Skin from the puppet, or capture…")

### 페이지 와이어링

3개 페이지가 `applyVisibilityMap` 대신 `applyVariant`를 prop으로 통과시키고, `<VariantsPanel adapter={adapter} ... />`. /poc/upload는 `savedId === null`일 때 native variants가 보이지만 import 버튼은 disabled — 이 경우엔 "Save to library to enable variants" hint가 먼저 뜸.

## 검증

- typecheck 통과
- biome 통과
- `next build` 통과

## 시각 검증 가이드

```bash
git pull && pnpm install && pnpm dev

# 1) 내장 Spineboy를 Spine 샘플로 마운트한 puppet으로 진입
#    (또는 /poc/upload에 Spine zip 드롭 후 autoSave 후 /edit/<id>로)
# 2) Variants 헤더에 "from puppet (N)" 버튼이 보이고, 클릭하면 모든 Skin 목록
# 3) 한 Skin (예: "default")을 import → 변형 row로 등장 + 라벨 "skin:default"
# 4) 다른 Skin도 import → 두 번째 row → 클릭하면 puppet의 모습이 즉시 변함
# 5) 다시 첫 row 클릭 → 원래 default skin으로 되돌아감
# 6) skin import 후 추가로 layer 몇 개 hide → "+ capture" → 활성 skin + visibility 묶어서 저장됨
# 7) 다른 variant 적용 후 6번 변형 클릭 → skin도 visibility도 둘 다 한 번에 복원
# 8) /edit/builtin/hiyori (Live2D) → "from puppet" 버튼이 안 보임 (native 0개), capture는 기존대로 visibility만
# 9) 페이지 새로고침 → import한 변형/캡처 모두 살아있음 (IDB v4)
```

## 의도적 한계

- **Cubism 쪽은 Sprint 4.3에서**: Live2DAdapter의 native list는 빈 배열. cdi3 Groups 파싱 + part 가시성 프리셋 변환은 다음 sprint
- **Skin 전환 history X**: 위에서 설명. 의도한 단순화
- **Skin 동적 추가 X**: SpineAdapter는 skin set이 puppet 로드 시 고정이라고 가정. 실제로 Spine은 `skeleton.data.skins`가 immutable → 안전
- **Spine 외 runtime preset의 import label**: panel은 "skin:" / "group:" 두 케이스를 처리하지만 "group:"은 4.3에서 채워짐

## 다음 — Sprint 4.3

cdi3 DisplayInfo의 `Groups` (예: 표정 그룹 / 의상 부위 그룹) → Variant import. Live2DAdapter:
- cdi3.json 파싱 (이미 1.3 fix에서 part display name pull용으로 일부 사용 중)
- `listNativeVariants()`가 group별 NativeVariant 반환 — `applyData` 대신 visibility map (group의 part들 visible/hidden)으로 표현하는 게 맞을지, 아니면 `live2dGroup` 같은 새 applyData 필드를 추가하는 게 맞을지 결정. 후자면 어댑터가 group→part 매핑을 들고 있어야 함.

설계 결정 후 구현.
