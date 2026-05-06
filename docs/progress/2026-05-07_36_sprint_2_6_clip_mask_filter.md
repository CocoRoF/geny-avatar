# 2026-05-07 — Sprint 2.6: Clip-mask part 필터 (마지막 logical dedup)

Sprint 2.5 후 사용자가 "모든 part가 완벽하게 동작하지는 않는다"고 보고. 분류 결과 남은 logical path 중 처리 가능한 두 가지를 이번 PR에서 마무리. 이후 Phase 3 진입.

## 처리한 logical path

### A. Mask drawable reverse lookup → pure-clip part 필터

**문제**: Cubism에서 어떤 drawable은 다른 drawable의 *clipping mask*로만 사용됨. 자체로는 렌더에 안 보이지만 atlas에 UV는 차지함. Sprint 2.5의 container 필터를 통과해 LayersPanel에 등장하지만 edit해도 시각적 변화가 없음 — "ghost" 행.

**해결**: Cubism Core의 `getDrawableMasks(): Int32Array[]`은 drawable당 자기를 clip하는 mask drawable 인덱스 배열을 반환. 이걸 reverse하면 "어떤 drawable이 ≥1개의 다른 drawable의 mask로 쓰이는지" 결정론적으로 알 수 있음:

```ts
const drawableMaskLists = coreModel.getDrawableMasks();  // Int32Array[]
for (let d = 0; d < drawableMaskLists.length; d++) {
  for (const maskIdx of drawableMaskLists[d]) {
    this.maskDrawables.add(maskIdx);
  }
}
```

이후 `Avatar.layers` 필터에 추가 조건: **part의 direct drawables가 100% mask drawable이면 제외**.

```ts
const allMasks = direct.every((d) => this.maskDrawables.has(d));
if (allMasks) return false;  // pure-clip part
```

이게 "drawable A는 다른 part의 drawable B의 mask로만 쓰임"을 정확히 식별. 시그널은 Cubism의 자체 데이터(forward mask 리스트)에서 직접 도출 — 휴리스틱 없음.

**Edge case 인지**: drawable이 mask로 쓰이면서 *동시에* 자체 콘텐츠로도 렌더되는 케이스가 이론적으론 가능. 그런 part는 잘못 필터될 수 있음. 그러나 실제 작가 워크플로에서는 drawable이 mask 전용이거나 visible 전용으로 분리됨 (drawable 단위로 의도가 갈림). 이 분리가 깨진 puppet에서만 영향. 만약 발생하면 `git revert <sha>`로 즉시 롤백.

### B. Multi-page part 진단 (필터 X, 로그만)

**문제**: 한 part의 drawables가 두 개 이상의 atlas page에 걸쳐 있으면 `buildPartSlice`는 dominant page 하나만 사용. 다른 page쪽 픽셀은 studio에 안 보임.

**처리 결정**: page 합성 (canvas 두 장을 한 캔버스로 묶어 좌표 정규화)은 구현 비용이 크고 실제로는 드문 케이스 (작가는 보통 한 part를 한 page에 모음). 따라서 **합성은 deferred, 진단 로그만 추가**:

```ts
const pages = new Set<number>();
for (const d of direct) pages.add(coreModel.getDrawableTextureIndex(d));
if (pages.size > 1) multiPagePartCount++;
```

콘솔에 `X parts span multi-page (dominant page only)` 로그. 사용자가 보면 puppet에 multi-page part가 있다는 사실을 인지 → 필요시 별도 처리 결정.

## 처리하지 않은 항목 (구조적 한계로 확정)

분석 메시지에서 정리한 "진짜 structural limit":
1. **State variant 그룹** — cdi3에 PartGroups 없음. moc3 디깅/IoU/파라미터 스윕 모두 휴리스틱.
2. **Z-stack 합성 part** — 의도된 동작.
3. **Live deformation** — atlas는 정적, render는 변형. 본질적 불일치.
4. **cdi3 없는 puppet** — `PartArtMesh1` 그대로.

이번 PR로 logical-only 영역은 모두 소진. 남은 imperfect 케이스는 위 1-4번 중 하나.

## 변경

`lib/adapters/Live2DAdapter.ts` 단일 파일.
- `maskDrawables: Set<number>` 인스턴스 상태 추가
- drawable parent loop 직후 `getDrawableMasks()` reverse lookup
- `Avatar.layers` 필터에 mask-only 조건 추가
- multi-page 진단 로그 추가
- `destroy()`에 `maskDrawables.clear()` 추가

Spine 어댑터, DecomposeStudio, LayersPanel 등 영향 0.

## Revert

단일 atomic commit. `git revert <sha>`로 sprint 2.5 직후 상태로 돌아감. 외부 인터페이스 시그니처 변경 없음 (Avatar.layers 길이만 줄어들 수 있음).

## 검증

- typecheck/lint/build 통과

## 시각 검증 가이드

```bash
git pull && pnpm install && pnpm dev
# /edit/builtin/hiyori
# - 콘솔: [Live2DAdapter] hidden N containers + M clip-only parts of K
# - LayersPanel에 추가로 mask-only part 사라짐
# - 토글 visibility, DecomposeStudio 정상 작동 (sprint 2.5와 동일)
```

## 다음 — Phase 3

Phase 2 종료. 다음은 Phase 3 — AI texture generation (MVP).
- Replicate 통합 (SDXL inpaint + canny ControlNet)
- /api/ai/generate, /api/ai/status 라우트
- GeneratePanel UI
- DecomposeStudio가 만든 마스크 + atlas region을 ControlNet 입력으로 활용

별도 sprint 시작.
