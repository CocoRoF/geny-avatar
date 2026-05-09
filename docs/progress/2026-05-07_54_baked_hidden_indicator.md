# 2026-05-07 — `bakedHidden` 시각화: 모델 파일이 강제 숨긴 part 표시

## 사용자 보고

[`53` chips](2026-05-07_53_export_staged_chips.md) 후속:

> 우리가 Export 했던 것 중 다시 Import하면 그 part와 관계없이 어차피 이제 안 보이게 된다고. 그런 것들을 제대로 표시해야 한다고.

즉, **Export Model 결과를 다시 import한 puppet은 puppet 자체의 pose3.json이 매 프레임 part_X opacity를 0으로 묶음**. editor의 visibility 토글은 인터럽트 없이 store/adapter에 푸시되지만 런타임이 곧바로 덮어쓰기 때문에 무효. 사용자는 토글이 왜 효과 없는지 알 길이 없음.

## 변경 surface

### `Layer.bakedHidden?: boolean` (`lib/avatar/types.ts`)

새 필드. 런타임이 모델 파일에 박힌 메커니즘 (현재는 Cubism `pose3.json`의 non-anchor 멤버) 으로 매 프레임 0으로 묶는 part임을 표시. 시각/UX 전용 — 토글 자체는 막지 않음 (사용자가 명시적으로 시도해 학습할 수 있게).

### `Live2DAdapter` — `loadPose3HiddenParts`

`load()` 시 puppet의 `pose3.json` 을 직접 fetch해서 모든 group의 첫 entry 외 멤버를 `bakedHiddenPartIds` 셋에 모음. layer 생성 시 `partExternalId`가 셋에 있으면 `bakedHidden = true`. multi-page 분할된 layer들도 같은 part를 가리키므로 동일 플래그.

#### `resolveSiblingUrl` blob URL fix

업로드 puppet은 `rewriteLive2DManifest` 가 모든 FileReferences를 blob URL로 치환. 기존 `resolveSiblingUrl` 은 manifest dir + relPath 단순 concat 이라 이미 absolute인 blob URL을 받으면 garbage URL 생성. 그래서 우리 cdi3 로더도 업로드 puppet에서 silent fail 했었음.

수정: `relPath` 가 `blob:` / `http(s):` / `data:` 으로 시작하면 그대로 반환. cdi3 part 표시명도 덤으로 동작하기 시작.

### `LayersPanel`

- 헤더에 amber `N baked` chip — count > 0 일 때 표시 (red `N hide` chip 옆)
- LayerRow 의 `Layer.bakedHidden` 값을 row 내 `baked` 변수로 사용해:
  - layer name 에 `decoration-amber-400/70` 취소선 + `text-fg-dim`
  - 우측에 amber `baked` 배지 (mask/gen/hide 옆)
  - `willBakeHide` (red) 와 `baked` (amber) 동시 만족하면 baked 가 우선 (이미 박혀있는 게 더 강한 사실)
  - 토글 버튼은 그대로 — 클릭은 store 에 반영되지만 렌더는 안 바뀐다는 걸 사용자가 직접 확인

색상 의미 정리:
- 🟢 accent green: 사용자가 추가한 컨텐츠 (mask, gen)
- 🔴 red: 다음 export 에서 추가될 사용자 변경 (hide)
- 🟡 amber: puppet 파일에 이미 박혀있는 것 (baked)

### `ExportButton`

- `bakedAlreadyHiddenCount` useMemo — bakedHidden=true layer들의 unique partId 수 (multi-page 중복 제거)
- staged chip 에 `M baked` 추가 — `1 hide · 1 baked · 2 mask · 1 gen` 식으로 함께
- save / export model 모두의 hover tooltip 에 baked 항목 포함:
  - "(... / 1 baked / ...)"
  - 익스플리시트하게 "이미 박혀있는 N개는 그대로 따라간다"

이미 박힌 항목은 다음 export 에서 **건드리지 않음** — 우리 `patchCubismForHide` 는 기존 pose3.json을 로드해서 새 group 을 push 만 함. 따라서 baked 카운트는 정보 표시일 뿐 export 에 추가 액션 발생 안 함.

## 의도적 한계

- **baked-hidden을 unhide 하는 UX 없음**: 한 번 export-import 사이클을 거친 part는 우리 editor 에서 다시 visible 로 되돌릴 수단이 없음. 해결 경로:
  - 원본 puppet 다시 업로드 (baked 없는 상태에서 시작)
  - 또는 미래 sprint 에서 "이 baked entry 제거" UX 추가
- **Spine baked 표시 X**: Spine 의 setup pose `attachment=""` 는 이미 `defaults.visible=false` 로 인코드되어 있음. 별도 baked 플래그 안 붙임 — 회색 dot 으로 충분.
- **motion3.json 패치는 baked 로 안 셈**: 우리 export 는 pose 와 motion 양쪽 다 패치하지만 motion 은 재생 안 되면 영향 없는 보조 채널. 사용자에게 보여주는 단일 신호는 pose 기준으로 통일.
- **moc3 binary 의 default opacity = 0 인 part**: `defaults.visible = false` 로 이미 표현됨. baked 로 별도 안 셈.

## 검증

- typecheck 통과
- biome 통과
- `next build` 통과

## 시각 검증

```bash
git pull && pnpm install && pnpm dev

# 1. 원본 CJK puppet 업로드 → /edit/<id1>
# 2. Part17 (워터마크) toggle off
#    - row 에 빨간 hide 배지 + 빨간 취소선
#    - 헤더에 "1 hide" chip (red)
#    - export 버튼 옆 "1 hide"
# 3. "export model" → zip 다운로드
# 4. 그 zip 을 /poc/upload 에 다시 드롭 → 새 puppet 으로 등록 → /edit/<id2>
#    - 같은 Part17 row 에 amber baked 배지 + amber 취소선
#    - 헤더에 "1 baked" chip (amber, red 자리 차지 안 함 — hide 와 다른 카테고리)
#    - export 버튼 옆 "1 baked"
# 5. 그 Part17 의 토글 dot 클릭 → store 갱신되지만 puppet 렌더는 그대로 (pose 가 매 프레임 0)
#    - 사용자에게 시각적으로 "이게 인터액티브하지 않은 이유" 가 amber 배지 + tooltip 으로 설명됨
# 6. 다른 part toggle off → red `hide` 배지 추가 (next export 에 새로 baked)
# 7. 헤더가 "1 baked · 1 hide" 같이 둘 다 표시
# 8. cdi3 partNames 도 이번 fix 로 업로드 puppet 에서 표시되기 시작 (덜 중요한 보너스)
```
