# 2026-05-07 — Sprint 2.5: Cubism part dedup (logical only)

사용자 검증 후 "part가 너무 세분화" 문제 — Cubism puppet에서 같은 영역이 여러 part로 등장. 이전 분석에서 세 가지 원인을 식별했고, 이번 PR은 **순수 논리적**으로 처리 가능한 두 가지만 해소. 휴리스틱 영역(IoU 매칭 등)은 사용자 요청대로 의도적으로 제외.

## 처리한 것 (logical only)

### A. 조상 inclusion 중복 해소 — `partToDirectDrawables` vs `partToDescendantDrawables` 분리

**문제**: Sprint 1.x에서 `partToDrawables`는 drawable을 자신의 직접 부모 part **+ 모든 조상 part**에 등록. visibility cascading 의도엔 맞지만, *footprint* 의도엔 틀림 — root part가 atlas 전체 footprint를 갖고, container part가 자식들의 footprint를 가짐. 결과적으로 LayersPanel에 "내용물이 비슷한 part들"이 다수 출현.

**해결**: 두 맵으로 분리 (Live2DAdapter):

```ts
// 자신의 직접 부모 part만 — own footprint
private partToDirectDrawables = new Map<number, number[]>();

// 모든 조상 part 포함 — visibility cascade
private partToDescendantDrawables = new Map<number, number[]>();
```

drawable loop에서 둘 다 동시에 채움. 사용처를 의미별로 분기:

| 경로 | 사용 | 이유 |
|---|---|---|
| `applyOverridesAfterUpdate` (visibility 토글) | descendant | container를 끄면 자식까지 사라져야 (Cubism 의미) |
| `buildPartSlice` (Layer.texture 생성) | direct | own footprint만 |
| `getLayerTriangles` (DecomposeStudio clip) | direct | own footprint만 |

이건 **그래프 구조에서 도출된 결정론적 분리** — 휴리스틱 없음.

### B. Pure container part를 LayersPanel에서 제거

**관찰**: direct drawable 수가 0인 part = 자기 픽셀 없음, 자식들의 그룹핑 노드일 뿐. 패널에 보일 가치 없음 (썸네일 없음, mask 못 그림, 행만 차지).

**해결**: `Avatar.layers` 필터:

```ts
const exposedLayers = layers.filter((_, partIdx) => {
  return (this.partToDirectDrawables.get(partIdx)?.length ?? 0) > 0;
});
```

`layerByPartIndex` 내부 맵엔 모든 part를 보존 — 외부에서 layerId로 visibility 토글 호출이 들어와도 동작 (하지만 UI에선 노출 안 됨). 콘솔에 `hid X/Y pure container parts` 진단 로그.

이것도 **결정론적** — 0개 픽셀 = 0개 픽셀.

### C. cdi3.json display names

**관찰**: Cubism 4 표준 manifest는 `FileReferences.DisplayInfo`로 `.cdi3.json`을 가리킬 수 있음. 그 파일의 `Parts: [{Id, Name}]`은 **artist가 직접 author한 사람-가독형 이름** (`頬`, `前髪B` 등). 표준 데이터-driven 소스라 휴리스틱 아님.

**해결**: `loadCdi3PartNames(model3Url)` — manifest fetch → `DisplayInfo` 경로 resolve → cdi3 fetch + parse → `Map<id, displayName>` 반환. layer 생성 시 `name = partDisplayNames.get(externalId) ?? externalId`. 파일 없거나 파싱 실패 시 silent fallback (engine id 그대로 사용).

이건 dedup 자체는 아니지만, dedup된 패널에서 **어느 part가 어느 part인지 분간 가능하게 만드는** 보조 효과. 상태 변형 part들을 작가가 일관된 이름 (`Eye01/Eye02/Eye03`) 으로 만든 경우, 이름만 봐도 그룹핑 의도 보임.

## 의도적으로 제외 (heuristic)

**State variant grouping (분석 #2의 strict 자동 그룹핑)**: 표준 `cdi3.json` spec에는 `PartGroups` 같은 필드 없음 (이전 분석에서 잘못 말함 — 정정). artist-authored part 그룹 정보의 logical source는:
- `.moc3` binary의 part-opacity-curves 테이블 (framework가 직접 노출 안 함)
- 파라미터 스윕 후 part opacity 관찰 (side-effecty + fragile)
- UV bbox IoU 매칭 (휴리스틱)

셋 다 사용자 제약(휴리스틱 금지)에 못 맞음. 이번 PR에서 제외. cdi3 display names로 artist의 이름 컨벤션은 그대로 보이므로, user가 시각적으로 그룹을 식별 가능.

**Z-stacking compositing parts (분석 #3)**: 의도된 동작이라 처리 자체가 부적절. 그대로 둠.

## 변경 파일

오직 `lib/adapters/Live2DAdapter.ts` 한 파일. Spine 어댑터, DecomposeStudio, LayersPanel 등 다른 코드 영향 0. 문서 (`docs/progress/`)만 추가.

## Revert

이 PR은 단일 atomic commit. 잘못 작동하면:

```bash
git revert <commit-sha>
```

으로 깔끔하게 sprint 2.4 직후 상태로 돌아감. Avatar.layers, partToDrawables 시그니처 등 외부 영향 0 (Avatar.layers는 줄어든 array — 소비처는 `layers.length`만 보고 동작하므로 안전).

## 검증

- typecheck/lint/build 통과
- Live2DAdapter 단일 변경 — 기타 모듈 회귀 가능성 0

## 시각 검증 가이드

```bash
git pull && pnpm install && pnpm dev
# 1) /edit/builtin/hiyori
#    - LayersPanel: 이전보다 part 수 줄어듦 (container hidden)
#    - 이름이 PartArtMesh1 → 일본어 part 이름으로 (cdi3 있는 경우)
#    - hover → edit 클릭하면 footprint clip 정확
# 2) console에 [Live2DAdapter] hid X/Y pure container parts + cdi3 part display names: N
# 3) 토글 visibility는 그대로 작동 (descendant 경로 보존)
# 4) Spine /edit/builtin/spineboy 영향 받지 않음
```

## 다음

Phase 2 마무리:
- mesh silhouette 추출 (ControlNet 입력 준비)
- 또는 마스크 IDB 영속성
- 또는 사용자 검증 결과 따라 추가 보정

Phase 3 (AI texture generation) 진입 결정.
