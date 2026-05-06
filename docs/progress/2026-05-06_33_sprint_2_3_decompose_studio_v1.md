# 2026-05-06 — Sprint 2.3: DecomposeStudio v1 (alpha threshold + brush mask)

Phase 2 본 작업 첫 사용자-facing 도구. 레이어의 atlas region을 풀사이즈로 띄워 알파 임계 + 브러시로 마스크를 다듬을 수 있는 모달 스튜디오.

## UI 흐름

LayersPanel 행에 hover 시 우측에 `edit` 버튼 노출 (Layer.texture가 있는 행만 — 즉 Spine 모든 슬롯 + Cubism 대부분 part). 클릭 시 `editorStore.studioLayerId` 설정 → `<DecomposeStudio>` 모달 마운트.

모달:
- 좌측 (큰 영역): region 풀사이즈 캔버스 미리보기 (체커보드 배경으로 alpha 보임)
- 우측 (240px): 알파 임계 슬라이더, 브러시 컨트롤 (paint/erase 토글, 사이즈), 사용법 메모
- 헤더: 레이어 이름, dirty 표시, `clear mask` / `save & close` / `close` 버튼
- Esc → close

## 데이터 흐름

### Editor store 추가 (`lib/store/editor.ts`)

```ts
type EditorState = {
  // ...기존
  studioLayerId: LayerId | null;
  layerMasks: Record<LayerId, Blob>;
  setStudioLayer(id: LayerId | null): void;
  setLayerMask(id: LayerId, blob: Blob | null): void;
};
```

`setAvatar`가 둘 다 reset.

### 캔버스 셋업

3개 캔버스 (모두 source 픽셀 dim 기준 1:1, CSS로 화면 fit):
1. **sourceCanvas** (ref, 비표시) — `extractRegionCanvas(source, rect, rotated)`로 atlas page에서 region을 풀사이즈 crop. rotated 처리는 useLayerThumbnail과 같은 -90 회전.
2. **maskCanvas** (ref, 비표시) — alpha 0 = 비마스크, 255 = 마스크. 브러시가 그리는 캔버스.
3. **previewCanvas** (DOM, 표시) — pointer events 받음. 매 갱신마다 `redraw()`가 source × (1 − effective mask)를 imageData로 합성해 putImageData.

### `effective mask = max(thresholdMask, paintedMask)`

- thresholdMask: source 픽셀의 alpha < threshold이면 255, 아니면 0
- paintedMask: maskCanvas의 alpha 값 그대로

이 두 가지를 픽셀별 max로 합쳐 effective mask 도출. preview 합성 + save 시 동일 로직.

### Pointer paint

Pointer events on preview canvas:
- pointerdown → `paintingRef.current = true`, `setPointerCapture` (한 번만 down 이후 떨어져도 전역 추적)
- pointermove + painting → 현재 위치를 source coords로 변환 후 maskCanvas에 원 그리기
- pointerup/cancel → `paintingRef = false`, release capture
- mode=erase면 `globalCompositeOperation = 'destination-out'` → 기존 마스크에서 빠짐

### Save

`save & close`: source + mask + threshold를 **하나의 PNG blob**으로 baking
- 결과는 RGB=0,0,0 + alpha = effective mask (0..255)
- `setLayerMask(layer.id, blob)` → store에 저장
- 모달 닫힘

저장 후 LayerRow에 `mask` 배지가 우측 끝에 표시. (아직 어떤 곳에서도 이 마스크를 사용하지 않음 — Phase 3 AI 워크플로의 ControlNet 입력 / atlas 분해 export에서 활용 예정)

`clear mask`: maskCanvas 지우고 store에서 제거 (`setLayerMask(layer.id, null)`).

## 영속성 정책

마스크 blob은 store에 in-memory만. avatar 재진입 / 페이지 새로고침 시 사라짐. 의도적인 v1 제약 — DecomposeStudio Pro (Sprint 6 / Phase 6)에서 IDB 영속성 + auto-restore 추가 예정.

## 알려진 한계

- Undo within studio 없음. 실수로 그리면 `clear mask` 또는 erase로만 복구. 향후 stroke 기반 undo 스택 (작은 PR).
- 브러시는 단일 stroke가 dot 시퀀스. fast move 시 점이 끊어짐. `lineTo`로 잇는 게 더 매끄러움 (다음 sprint에서 다듬기).
- threshold가 brush와 분리되어 있음. 둘 다 동시에 이펙트 — UX 직관적이지만, "threshold만 적용된 영역"을 보존하면서 brush로 살리는 방향은 currently 불가능. 후속 결정.

## 검증

- typecheck/lint/build 통과
- DecomposeStudio.tsx 약 360줄 — 단일 컴포넌트 안에 다 들어감 (canvas refs, redraw, pointer, save, ui)
- /edit/builtin/spineboy 또는 /edit/builtin/hiyori 에서 LayersPanel 행 hover → edit 클릭 → 모달 열림

## 시각 검증 가이드

```bash
git pull && pnpm install && pnpm dev
# 1) /edit/builtin/spineboy → LayersPanel 행 hover → 우측 "edit"
# 2) DecomposeStudio 열림: 체커보드 위에 region 풀사이즈
# 3) alpha threshold 슬라이더 올려 → 가장자리 사라짐
# 4) brush paint 모드로 영역 칠하기 → 미리보기에서 사라짐
# 5) erase → 칠한 곳 다시 보임
# 6) save & close → 행에 "mask" 배지
# 7) 같은 layer edit 다시 → 저장된 마스크 복원
# 8) /edit/builtin/hiyori 도 동일 흐름 (Cubism part)
# 9) Esc로 닫기
```

## 다음

Phase 2 마지막 산출물:
- **mesh silhouette 추출** (Sprint 2.4): drawable / mesh attachment 정점 outline polygon → `Layer.silhouette` 채우기. AI ControlNet 입력 준비.
- 또는 DecomposeStudio 다듬기: stroke continuity, undo, mask preview overlay on layer thumbnail
- 또는 IDB 영속성으로 마스크 보존
