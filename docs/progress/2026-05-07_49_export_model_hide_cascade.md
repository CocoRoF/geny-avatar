# 2026-05-07 — Fix: Export Model에서 Cubism part hide cascade 누락

## 증상

[`47 export_model`](2026-05-07_47_export_model_baked.md)으로 베이크된 atlas zip을 다시 import해 봤더니, **사용자가 끈 part의 자식 drawables가 atlas에 그대로 남아있어** 본체 위로 비춰 보임. 사용자 보고:

> part0은 껐음에도 불구하고 그게 여전히 존재하고 그 존재하는 것 때문인지 그냥 심각하게 텍스처가 깨지고 있어. 반면 Mask를 적용했던 것은 정확하게 적용되고 있어. (...) 특정 PART를 끄는 것이 해당 파트에 뭔가 마스크를 넣는 게 아니라 렌더링 로직 자체를 좀 조작해야 할 것으로 보여.

스크린샷에선 캐릭터 본체에 격자/노이즈 + 배경에 illustrator 크레딧 텍스트 같은 것이 비쳐 나옴.

## 원인

`bakeAtlasPages`의 visibility erase가 **layer 자기 자신의 footprint만** `getLayerTriangles`로 가져와 erase. 그러나 Cubism part는 **하위 part들을 가진** 트리 구조. 부모 part를 hide하면 런타임에선 `partOpacityOverrides` × `partToDescendantDrawables` cascade로 자식 drawables의 opacity까지 0이 됨 → 정상 동작. 그런데 export 시점에선:

- `visibilityOverrides[parent.id] === false` ✓
- 자식 layer는 사용자가 직접 토글 안 했으므로 `visibilityOverrides[child.id] === true`
- 자식 footprint는 erase 대상에서 빠짐 → atlas에 그대로 남음

그 결과 외부 도구 / 우리 재import 시:
1. 자식의 atlas region은 살아있고
2. 부모 part의 opacity가 (재import에선 default visibility로 reset된 상태) 정상이라 자식이 렌더됨
3. 그게 본체와 겹쳐 시각적으로 깨짐

## 수정

사용자의 핵심 통찰("렌더링 로직 자체를 조작해야 한다")은 puppet 표준 형식이 영구적 disable을 허용하지 않아 atlas erase가 유일한 경로지만, 그 erase가 **런타임 cascade와 동일하게 자식 drawables까지 포함**해야 한다는 결론으로 풀어냈다.

### `AvatarAdapter` 인터페이스에 `listHiddenAtlasFootprints` 추가

```ts
listHiddenAtlasFootprints(hiddenLayerIds: ReadonlyArray<LayerId>): LayerTriangles[];
```

- **Spine**: slot 트리 구조 없음 → 각 layer의 직접 attachment region만 반환 (`getLayerTriangles` 결과 모음)
- **Live2D**: hidden layer의 partIdx → `partToDescendantDrawables`로 모든 자식 drawables 확장 → drawable별로 UV indices를 풀어 top-down UV 배열 구성 → `LayerTriangles[]` 반환 (drawable당 한 entry, atlas 페이지별로 묶일 수 있게 textureId 포함)

multi-page split layer 들은 같은 partIdx를 가리키므로 `Set<partIdx>`로 dedupe → cascade 한 번만 traverse.

### Live2DAdapter에 `textureIdByPageIndex` 멤버 추가

기존 `pageIndexByTextureId`만 있었음 (역방향). drawable의 page index → textureId 변환을 위해 정방향 맵도 멤버로 보관. load 시 둘 다 채우고 destroy 시 같이 clear.

### `bakeAtlasPages` 갱신

기존 layer-by-layer erase 루프 → 한 번에 `adapter.listHiddenAtlasFootprints(hiddenIds)` 호출 + textureId별 그룹핑 + 페이지 내부에서 모든 footprint를 한 번에 fill (`destination-out`).

기존의 visibility 룰은 그대로 유지: **사용자가 명시적으로 끈** layer (`visibility[id] === false` AND `defaults.visible === true`)만 hidden 후보로 모음. default-hidden part는 안 건드림.

`trianglesPathForLayer` 헬퍼를 `trianglesUVsToPath2D`로 재사용 가능하게 분리해 layer/raw UV 두 입력 형태 모두 같은 path 생성.

## 한계와 다음

- **drawable이 다른 drawable의 mask로 쓰이는 케이스**: Cubism은 한 drawable이 다른 drawable의 clipping mask일 수 있음. mask 역할 drawable이 hidden parent의 자식이고 사용자가 부모를 끄면 mask 자체가 erase됨 → 다른 drawable의 클리핑이 망가질 가능성. 현재는 진단도 fallback도 안 함. 실제 puppet에서 이 케이스가 보이면 별도 sprint.
- **drawable이 동일 atlas region을 share하는 케이스**: 2개 drawable이 같은 픽셀을 가리키면 한쪽 erase 시 다른 쪽도 영향. Cubism에선 거의 없는 패턴이지만 가능성은 있음.
- **Spine 슬롯의 skin 어태치먼트 변형**: skin 변경으로 슬롯의 attachment가 바뀌면 atlas region도 바뀌지만 export는 한 frozen state를 가정. skin import variants와 export 모델은 별개.

## 검증

- typecheck 통과
- biome 통과
- `next build` 통과

## 시각 검증 (사용자)

CJK 이름 puppet으로 다시 시도:
1. `/poc/upload`에 puppet 드롭 → autoSave → `/edit/<id>`
2. 어떤 부모 part 토글 off (예: 정보 텍스트 컨테이너)
3. mask 그리고 AI texture 적용도 한두 개
4. `export model` → zip 받기
5. 풀어서 atlas PNG 직접 보기:
   - hidden parent의 **자기 footprint 뿐 아니라 자식 drawables 영역도** 모두 transparent
   - mask + AI texture는 그대로
6. zip을 다시 `/poc/upload`에 드롭 → 재import
   - 본체 위로 비치는 잔재 사라짐
   - 격자/노이즈 사라짐 (자식 drawables가 사라졌으므로 본체 mesh와의 sampling 충돌 없음)
   - mask 적용 영역은 그대로 정확
