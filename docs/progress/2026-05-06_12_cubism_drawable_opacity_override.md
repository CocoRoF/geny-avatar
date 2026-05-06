# 2026-05-06 — Cubism: drawable-opacity override (real hide-all fix)

## 문제 (재진단)

직전 progress 11에서 `setPartOpacity`를 매 프레임 RAF로 다시 호출했지만 hide all이 안 작동. 이번엔 motion이 우리 값을 못 덮어쓰는 영역까지 내려가야 함.

## 원인 — Cubism update 단계의 race

Cubism Core `model.update()` 한 번 안에서:
1. parameters reset to default
2. motion·expression이 parameters에 값 적용
3. parameters → parts (PartOpacity 자동 매핑)
4. parts → drawables (drawable opacity 계산)
5. moc.update — drawable vertex/uv 갱신

`setPartOpacity(idx, 0)`은 3단계의 결과인 `_partOpacities[idx]`를 mutate. 4단계가 그 값을 drawable에 propagate하려면 update가 한 번 더 호출되어야 함. 우리 RAF가 model.update 후 호출되면 `_partOpacities` 변경은 되지만 그 frame의 drawables는 이미 갱신 완료 → render는 옛 값으로. 다음 frame 시작에 motion이 다시 _partOpacities를 1로 덮어씌우니 우리 변경은 영영 적용 안 됨.

## 수정 — drawable opacity 배열 직접 mutate

motion이 직접 건드리지 않는 곳은 **drawable opacities Float32Array** (4단계의 출력). 매 frame model.update가 이 배열을 새로 계산하지만 그 후 render 직전에 우리가 곱셈으로 끼어들면 render는 우리 값으로 그림.

```ts
const opacities: Float32Array = coreModel.getDrawableOpacities();
for (const [partIdx, multiplier] of overrides) {
  for (const d of partToDrawables.get(partIdx)) {
    opacities[d] *= multiplier;  // 0 = hide
  }
}
```

핵심 구성:

1. **`partToDrawables` 맵 (load 시 1회 빌드)** — 각 part에 속하는 drawable 인덱스 리스트. Cubism part는 nesting되니 ancestor chain까지 따라가서 part X를 hide하면 X의 모든 descendant part 소속 drawable도 hide.
2. **RAF 루프** — `partOpacityOverrides`가 비어 있지 않으면 매 frame drawable opacities mutate.
3. **자동 정지** — Map size 0이 되면 다음 tick에서 RAF cancel. show all 후엔 비용 0.
4. **`setLayerVisibility(id, true)`는 override를 *추가*하는 게 아니라 *제거*** — 0 multiplier가 사라지면 motion의 자연스러운 값으로 돌아감.

엔진 빌드가 `getDrawableOpacities`를 노출 안 할 때만 setPartOpacity로 fallback (best-effort).

## ancestor chain 처리

Cubism은 part가 sub-part를 가질 수 있다 (`getPartParentPartIndex` API). 단순히 drawable의 직접 parent만 매핑하면 hierarchical hide가 안 먹힘 — "옷" part를 끄면 옷의 sub-part들 (옷 그림자, 옷 단추 등) 의 drawable도 같이 꺼져야 함.

load() 시 각 part의 ancestor chain (자기 + 모든 조상)을 미리 계산해두고, drawable의 직접 parent의 chain 전체에 그 drawable을 등록. 64-depth guard로 cycle 방지 (Cubism 트리는 보통 1~3 depth).

## 검증

- typecheck/lint/build 통과
- `/poc/cubism` 2.5KB / 273KB First Load (변동 미미)

진짜 검증은 사용자 브라우저: hide all 클릭 시 캐릭터가 거의 다 사라져야 함 (clipping mask·base layer는 part 정의에 따라 안 사라질 수 있지만 가시 영역은 대부분 사라짐).

## 학습

이 종류의 race는 진단이 까다롭다 — "코드 호출은 됐는데 효과 없음"의 전형. Cubism API 디자인이 "part는 motion 영향, drawable은 후처리 영역"으로 분리되어 있는 걸 활용해 문제 우회. 다음에 비슷하게 막히면 *어느 단계가 motion 영향 밖에 있는가* 를 먼저 묻기.

## 다음

이번에 깔끔히 hide되면 Phase 1.3 — drag-drop 업로드.
