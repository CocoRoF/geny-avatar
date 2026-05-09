# 2026-05-07 — Export staged chips: bake state UI hint

## 사용자 요청

[`52` fix](2026-05-07_52_cubism_id_csmstring_unwrap.md) 후 워터마크 part hide가 정상 export됨을 확인. 이어진 사용자 요청:

> 우리의 이러한 수정이 반영 되었음을 좀 표시할 수 있으면 좋겠는데 (우리 에디터에선)

즉, "이 visibility 토글은 export 시 모델 파일에 베이크된다"는 신호를 editor UI에서 한 눈에 보이게 해달라.

## 변경 surface

### `LayersPanel`

- `bakedHideCount` useMemo — `visibility[id] === false && defaults.visible === true`인 layer 수
- 헤더 우측에 빨간 chip `N hide` (count > 0일 때만, normal-case + tracking-normal 로 헤더의 uppercase tracking-widest와 시각적 구분)
- LayerRow 별 `willBakeHide` prop — 동일 조건. 해당 row에:
  - 빨간 border + 빨간 텍스트의 `hide` 배지 (mask/gen 배지 옆)
  - layer.name에 `text-fg-dim` + `line-through decoration-red-400/60` 스타일 — **디폴트로 보이던 게 사용자가 끄면 취소선**으로 한눈에 알아봄

### `ExportButton`

- 같은 predicate으로 `bakedHideCount` + 마스크 / AI texture 카운터 계산
- 버튼 우측에 `staged` chip — 예: `1 hide · 3 mask · 2 gen` 형태로 결합. 0이면 안 보임 (퇴장 잡음 방지)
- 두 버튼의 `title` 속성 (hover tooltip) 도 staged 정보 포함:
  - save: "..., will include: 1 hide / 3 mask / 2 gen"
  - export model: "... (1 hide via pose3.json / 3 mask / 2 gen on atlas)"

## 디자인 결정

- 빨간색은 의도적 — mask/gen은 accent green (사용자 추가 컨텐츠), hide는 red (사용자 제거 의도). 두 의미를 다른 색으로 분리.
- "hide" 배지는 default-hidden인 layer에는 안 붙음 (그건 baseline 상태이지 사용자 의도가 아님)
- line-through는 `decoration-red-400/60` 으로 살짝 투명하게 — 너무 강하지 않음
- staged chip은 disabled 상태 (puppet 없음 / 작업 중)에선 숨김 — 클릭 액션이 없는 상태에서 정보만 띄우면 혼란

## 검증

- typecheck 통과
- biome 통과
- `next build` 통과

## 시각 검증

```bash
git pull && pnpm install && pnpm dev

# 1. CJK puppet 업로드 → /edit/<id>
# 2. layer panel 우측 상단: "Layers (93/93)" 만 보임 (아무것도 안 끔)
# 3. Part17 (워터마크) 토글 off:
#    - layer name이 dim + 취소선
#    - row 우측에 빨간 hide 배지
#    - panel header 우측에 "1 hide" chip
#    - 페이지 헤더의 export model 옆에 "1 hide" chip
# 4. 다른 layer에 mask 그리기 + AI texture 적용:
#    - 해당 row에 mask / gen 배지 (accent green)
#    - export model 옆 chip이 "1 hide · 1 mask · 1 gen"
# 5. export model 버튼 hover → tooltip:
#    "Download a runtime-ready .zip — atlas + model patches baked in
#     (1 hide via pose3.json / 1 mask / 1 gen on atlas)"
# 6. 위에서 끈 layer를 다시 켜면 hide 배지 / chip 사라짐
```
