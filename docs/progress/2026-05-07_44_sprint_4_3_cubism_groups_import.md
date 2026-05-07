# 2026-05-07 — Sprint 4.3: Cubism cdi3 Groups → Variant import

[`41 phase4_kickoff`](2026-05-07_41_phase4_kickoff.md)의 세 번째 sub-sprint. [`43 sprint_4_2`](2026-05-07_43_sprint_4_2_spine_skin_import.md)에서 Spine은 native skin을 IDB Variant로 끌어왔다. 이번엔 Cubism 쪽을 같은 패널 surface로 통합 — cdi3.json의 `Groups` (의상 / 표정 그룹)를 visibility-기반 Variant로 import.

## 설계 결정 — Cubism은 visibility, Spine은 runtime API

Spine Skin은 `setSkinByName(name)`이라는 단일 런타임 API 호출이지만 Cubism cdi3 Group은 **단순한 part id 묶음**이다. 런타임은 그 그룹들을 모르고, `coreModel`에는 "그룹을 활성화한다" 같은 콜이 없다.

따라서 cdi3 Group은 **visibility 맵으로 표현**한다:

- 그룹 자신의 part들 → `true`
- 다른 cdi3 Group에 속한 part들 → `false`
- 어느 그룹에도 속하지 않은 part들 → 손대지 않음 (map에 미포함)

이건 의류 선택(mutex) 시나리오를 가장 자연스럽게 표현하는 동시에, 표정처럼 다중 적용이 의도된 그룹에서도 사용자가 다른 그룹 변형을 추가로 클릭해 다시 켤 수 있어 유연성을 잃지 않는다.

이 결정에 맞춰 `NativeVariant`에 `visibility?` 옵셔널 필드를 추가했다 — 런타임이 어떤 표현 채널을 쓰든 import 시 IDB row의 `visibility`로 그대로 흘러간다.

## 변경 surface

### `NativeVariant.visibility?` (`lib/avatar/types.ts`)

```ts
type NativeVariant = {
  source: "spine-skin" | "live2d-group";
  externalId: string;
  name: string;
  applyData: VariantApplyData;          // Spine: {spineSkin}; Cubism: {}
  visibility?: Record<string, boolean>; // Cubism이 채움; Spine은 비움
};
```

`NativeVariantSource`는 4.2에서 이미 `"live2d-group"`을 포함시켜 둠 — 이번 sprint는 그 빈 슬롯에 진짜 데이터를 채우는 것.

### `useVariants.importNative` (`lib/avatar/useVariants.ts`)

`saveVariant`에 `native.visibility ?? {}`를 그대로 전달. 한 줄 변경. 기존 import path가 visibility 처리 능력을 이미 갖고 있어서 더 만질 게 없음.

### Live2DAdapter — cdi3 Groups 파싱 + listNativeVariants

#### `loadCdi3` (구 `loadCdi3PartNames`) 통합

cdi3.json을 한 번만 fetch해서 두 정보를 같이 추출하도록 합쳤다:

```ts
private async loadCdi3(manifestUrl: string): Promise<{
  partNames: Map<string, string>;
  partGroups: { name: string; partIds: string[] }[];
}>
```

- `partNames`: 4.0부터 쓰던 part display names (예: `頬`)
- `partGroups`: 새로 추가. `Target === "Part"` 또는 `"PartOpacity"` 인 그룹만 받음 (Parameter 그룹은 향후 param 패널 몫). Cubism Editor 버전에 따라 `Target` 값이 다른 걸 둘 다 수용.

추출된 그룹은 `this.cdi3PartGroups`에 저장.

#### `listNativeVariants` 본 구현

- `cdi3IdToExternalIds`: cdi3 part id (예: `PartArtMesh1`) → 매칭되는 모든 layer externalId. Multi-page part는 `PartArtMesh1#p0` / `#p1`로 갈라져 있으므로 두 개 다 들어감 (4.0의 multi-page split 결과 그대로 호환).
- `allGroupedExternalIds`: 어떤 cdi3 그룹에든 속한 모든 layer externalId의 합집합. 그룹 적용 시 "그 외 그룹" 차단용.
- 각 그룹별로 `visibility = {ownIds:true, otherIds:false}`를 만들어 NativeVariant 한 개 발행.

`stripPageSuffix(externalId)` 헬퍼로 `#p${idx}` 제거 → cdi3 id와 매칭. 실제 layer는 fan-out으로 여러 개가 보이므로 그룹 적용 시 다리 메시처럼 multi-page 갈라진 part도 한 번에 visible/hidden 갱신.

#### `applyVariantData(_data)` — no-op으로 유지

Cubism은 visibility 맵에 모든 의미가 들어있으므로 `applyVariantData`는 비워둔다. `applyVariant` 헬퍼(usePuppetMutations)는 이미 두 채널을 묶어 처리하므로 변형 적용 시:

1. `adapter.applyVariantData({})` — 아무것도 안 일어남
2. `applyVisibilityMap(bundle.visibility)` — 그룹의 visibility map이 store + adapter에 반영, history 통과

## 검증

- typecheck 통과
- biome 통과
- `next build` 통과

내장 Hiyori 샘플은 cdi3 Groups가 0개라 시각 검증은 cdi3 Groups가 채워진 외부 puppet으로 해야 함 (예: 의상 선택이 있는 commercial puppet).

## 시각 검증 가이드

```bash
git pull && pnpm install && pnpm dev

# 1) cdi3 Groups가 채워진 Cubism puppet 업로드 (/poc/upload)
#    - cdi3.json을 메모장에서 열어 Groups 항목이 비어있지 않은지 확인
# 2) autoSave 후 /edit/<id> 진입
# 3) Variants 헤더에 "from puppet (N)" 등장 — N = cdi3 Part 그룹 개수
# 4) 한 그룹 import → row 라벨 "group:<name>"
# 5) 클릭 → 그룹의 part는 visible, 다른 그룹의 part들은 한 번에 hidden, 그룹 외 part는 그대로
# 6) 다른 그룹 import + 클릭 → 의상 전환처럼 동작
# 7) 일부 part hide + "+ capture" → 활성 visibility만 저장 (Cubism은 applyData 없음)
# 8) 새로고침 → 모든 변형 살아있음 (IDB v4)
# 9) Hiyori 같은 cdi3 Groups 빈 puppet은 "from puppet" 버튼이 안 보임 (4.2 그대로)
```

## 의도적 한계

- **그룹별 mutex 가정**: 한 그룹을 import하면 다른 그룹은 자동 숨김. layered 그룹(표정 add-on 등)을 의도한 puppet에선 사용자가 여러 그룹 변형을 같이 적용해야 함. 향후 NativeVariant에 "exclusive vs additive" 메타를 cdi3에서 못 읽으므로 더 정교한 구분 필요 시 사용자 hint UI 필요
- **`applyVariantData` 미사용**: Cubism은 group state를 visibility로 100% 표현. live2dExpression / live2dPose 같은 미래 채널을 위해 메서드 시그니처는 유지
- **Live2D Pose / Expression group 미지원**: cdi3.json은 Parameter 그룹도 정의하는데(표정 매크로 등) 이건 param 패널의 영역. Variants 패널엔 안 올림
- **Multi-page split의 fan-out은 항상 일치 가정**: cdi3 part id가 layer baseId와 같다는 단순 매칭. 어댑터가 layer externalId를 임의 변형하면 깨질 수 있지만, 4.0 multi-page split 외엔 그런 변형 없음

## Phase 4 진행 상태

- ✅ 4.1 Variant 모델 + 캡처/적용 (visibility-only, IDB v3)
- ✅ 4.2 Spine Skin → Variant import (IDB v4, NativeVariant + applyData)
- ✅ 4.3 Live2D cdi3 Groups → Variant import (NativeVariant.visibility 채널)
- ⏳ 4.4 Export `*.geny-avatar.zip`
- ⏳ 4.5 Import `*.geny-avatar.zip`

다음 sprint는 4.4. fflate로 ZIP 빌드 + Avatar JSON + 모든 텍스처/마스크/오버라이드 PNG + LICENSE.md 자동 첨부. /edit 페이지에 Export 버튼 추가.
