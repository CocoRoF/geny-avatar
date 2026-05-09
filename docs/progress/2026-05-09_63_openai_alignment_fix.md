# 2026-05-09 — OpenAI alignment fix: tight-crop + preview parity

사용자 보고: gpt-image-2 결과가 SOURCE 위치/크기와 안 맞고, RESULT 미리보기는 fragment가 엉뚱한 자리에 떠 있음. apply 누르면 또 다른 그림이 나옴.

근본 원인 두 개를 같이 고침.

## 원인 1 — RESULT preview는 raw 1024² blob

`onSubmit`은 OpenAI에서 받은 blob을 그대로 `phase.blob` 으로 저장하고 `<img src={phase.url}>` 로 표시했음. 정작 silhouette에 맞춘 crop / re-position / alpha-enforce 는 `onApply` 의 `postprocessGeneratedBlob` 에서만 실행. 결과:

- preview: 1024×1024 raw — 모델이 페인트한 위치 그대로 떠 있음 (가로 어디든)
- apply 후 atlas: silhouette에 alpha-enforced — preview에 보이던 fragment가 alpha=0 영역이라 사라짐

사용자 입장에선 "내가 보는 거 != 실제 적용되는 거". 매 generate마다 잘못 정렬된 미리보기를 보고 혼란.

**Fix**: submit 성공 직후 `postprocessGeneratedBlob` 즉시 실행 → `phase.blob` 자체를 후처리된 blob으로 교체. preview / apply / IDB history 가 같은 blob을 공유. `onApply`는 단순히 `setLayerTextureOverride(layer.id, phase.blob)`.

## 원인 2 — sparse silhouette in large bbox → 모델 frame mismatch

레이어의 atlas region (bbox)이 silhouette 보다 훨씬 큰 경우가 흔함. 예: 800×800 bbox 안에 100×100 silhouette가 좌상단에. 기존 흐름:

1. `padToOpenAISquare(sourceCanvas)` — 800×800 전체를 1024² 에 fit. 작은 silhouette은 1024² 의 좌상단 ~128×128 영역으로 들어감
2. 모델이 보는 [image 1]: 거의 흰색 캔버스 + 좌상단 코너의 작은 subject
3. 모델이 페인트하는 위치는 silhouette 위치를 보장 X (centered, 또는 prior에 따라 어디든)
4. crop back: 1024²에서 silhouette은 좌상단인데, 모델은 다른 곳에 페인트 → alpha-enforce 후 빈 결과

**Fix**: `prepareOpenAISource(sourceCanvas)` — 새 함수가 **silhouette tight bbox** 로 먼저 crop한 뒤 1024² 에 pad. 모델 frame이 subject 로 꽉 차서 generated content가 silhouette 위치와 정렬됨.

apply 시:
- raw 1024² 에서 padding offset 사각형 추출 → tight crop 만큼 (예: 100×100)
- source canvas (800×800) 의 sourceBBox 위치 (x=0, y=0, w=100, h=100) 에 paint
- alpha-enforce against full source canvas → silhouette 영역만 살아남음
- 결과: 모델이 silhouette 위치에 정확히 페인트 + alpha-enforce 한 번 → 정렬 OK

## 변경 surface

### `lib/ai/client.ts`

- 신규 `tightSilhouetteCrop(canvas, alphaThreshold=1)` — alpha>0 픽셀의 tight bbox 찾아 cropped canvas + bbox 반환. silhouette이 이미 캔버스 꽉 채우면 원본 그대로.
- 신규 `prepareOpenAISource(canvas)` — tight-crop 후 padToOpenAISquare. 반환: `{ padded, paddingOffset, sourceBBox }`
- `postprocessGeneratedBlob` — `openAIPadding` 에 `sourceBBox` 옵션 추가. 있으면 raw → padding offset 추출 → sourceBBox 위치/크기로 paint. 없으면 (legacy / Gemini) 전체 source canvas 채움.
  - backwards-compat alias: `openAIPadding.offset` ≡ `paddingOffset` 으로 해석.
- `padToOpenAISquare` 자체는 그대로 — `prepareOpenAISource` 가 내부적으로 호출.

### `components/GeneratePanel.tsx`

- import `prepareOpenAISource`, drop `padToOpenAISquare`
- `openAIOffsetRef` → `openAIPaddingRef` 로 rename. `{ paddingOffset, sourceBBox }` 둘 다 보관
- `onSubmit`:
  - OpenAI 경로: `prepareOpenAISource(sourceCanvas)` 사용
  - 결과 받자마자 `postprocessGeneratedBlob` 즉시 실행 → `phase.blob` 에 후처리된 blob 저장
- `onApply`: 후처리 재실행 X. `phase.blob` 그대로 store에 set

## 의도적 한계

- **alphaThreshold=1**: 1 미만 alpha 픽셀은 silhouette 외부로 간주. 부드러운 경계(antialiased edge)는 살짝 잘릴 수 있지만 alpha-enforce가 마지막에 다시 enforce하므로 시각적 차이 X.
- **Tight crop이 silhouette의 bbox**: silhouette 자체가 매우 비정형 (긴 사선)이면 여전히 sparse. 그래도 padding이 minimum으로 줄어 향상 폭 큼.
- **Gemini는 unchanged**: 여전히 native dim, postprocess는 alpha-enforce만.
- **Legacy 호환성**: `openAIPadding: { offset }` 만 보내는 호출자도 그대로 동작 (sourceBBox 없으면 전체 source canvas 채움).
- **History blob도 후처리 후 저장**: IDB history의 blob은 이미 후처리된 거라 `onRevisit` 은 추가 후처리 없이 그대로 set.

## 검증

- typecheck 통과
- biome 통과
- `next build` 통과

## 시각 검증 가이드

```bash
git pull && pnpm install && pnpm dev

# 1. /edit/[id] 진입, atlas region 안에 silhouette이 작은 layer 선택
# 2. references 1~2장 첨부, prompt 입력
# 3. generate
# 4. RESULT 미리보기 — 이전엔 1024² raw가 떴지만, 이제는 silhouette 형태에 맞춰진 결과가 SOURCE 와 같은 크기로 보임
# 5. apply → atlas에도 같은 결과 반영
# 6. dev 콘솔 [GeneratePanel] / [postprocess] 로그로 sourceCanvas dim, tightCrop dim,
#    paddingOffset, sourceBBox 가 일치하는지 확인
```

이제 모델이 silhouette을 frame 그 자체로 보고 페인트하므로 위치/크기 mismatch가 사라진다. preview 와 apply 가 같은 blob을 공유하므로 "내가 본 거 != 적용된 거" 혼란도 끝.
