# 2026-05-09 — Sprint G.7: Focus-mode RESULT preview shows the tight-cropped focused region

## 사용자 보고

```
일단 이렇게 특정 source 부분에 대한 generation이 제대로 처리되지 않는 심각한 문제가 있어.
```

스크린샷 분석:
- 6 region 胸 layer focus mode 진입 (region 1 "chest")
- 사용자 prompt 입력 + generate this region click
- 서버 로그: API 200, 1.4MB result blob, postprocess 성공
- PROMPT 헤더 옆 ✓ generated 배지 보임
- HISTORY 2 entry 표시
- **그런데 RESULT panel은 텅 빔 (까만 checkered)**

## 근본 원인

[`75 sprint_g_focus_mode_redesign`](2026-05-09_75_sprint_g_focus_mode_redesign.md) 에서 SOURCE 는 focus mode 일 때 region tight-crop으로 paint하게 해놨지만, RESULT 는 여전히 phase.url (= 합성된 composite blob, source canvas 전체 dim) 에 binding.

수치: layer 의 source canvas 가 약 3863×3381 px. RESULT panel 은 modal 내 ~500×400 영역. 합성 blob 을 그 panel 에 fit 시키면 region 1 의 1016×639 px 영역은 ~130×80 px 로 축소 — 시각적으로 거의 안 보임 (특히 region 1 silhouette 외 영역은 transparent 라 panel 의 dark checker 만 보임).

→ 사용자 입장: "generation succeeded 라는데 화면엔 아무것도 안 보임" → silent UX 실패.

SOURCE 는 focus mode 에서 isolated region tight-crop 이라 1016×639 가 panel 안에 꽉 차서 잘 보임. RESULT 와의 비대칭이 confusion 의 핵심.

## 수정

### `components/GeneratePanel.tsx`

#### 신규 ref + 새 useEffect

`resultRef: HTMLCanvasElement` 추가. SOURCE 의 ref 와 페어로 RESULT 도 canvas paint 방식.

신규 effect (G.7) — focus mode + succeeded 시 매번 실행:
- `regionStates[focusedIdx].resultBlob` 를 image 로 load
- canvas dim = `components[focusedIdx].bbox.w × bbox.h`
- `drawImage(img, bbox.x, bbox.y, w, h, 0, 0, w, h)` — bbox area 만 crop in
- SOURCE 와 동일 framing → 1:1 비교 가능

#### RESULT JSX 분기

`isFocusedMulti` 체크해서 두 path:

**focus mode**:
- header: "result · region N of M"
- 상태별:
  - idle: "type a prompt and generate to see output"
  - running: "generating this region · provider call in flight" (OpenAI ~10–30s)
  - failed: "failed" + reason
  - succeeded: `<canvas ref={resultRef}>` (effect 가 paint)
- focusedRegionState 에서 status 읽음 (panel-level phase 가 아님)

**non-focus path** (single-component / Gemini):
- 기존 `<img src={phase.url}>` 그대로

### Helper hoisting

`isFocusedMulti` / `focusedPromptValue` / `focusedRegionState` 헬퍼들을 `regionStates` declaration 직후로 끌어올림 (예전엔 effect 들 아래에 있어서 G.7 effect 가 use-before-declare 에러). Hoisted body 가 effect deps 에 안전히 들어감.

## 의도적 한계

- **focus 모드에서만 동작**: single-component layer 도 components.length === 1 이라 `isFocusedMulti = false` (조건이 `length > 1` 이므로). 그래서 single-component 는 기존 phase.url img 경로 그대로. 만약 single-component 도 region preview 식으로 바꾸려면 `isFocusedMulti` 조건 완화 필요 — 다음 sprint.
- **canvas 가 unmounted 되면 reset**: status 가 succeeded 외로 바뀌면 (running / failed / idle) canvas 가 사라짐. 새 generate 돌리는 동안 이전 결과가 안 보임. 사용자가 "이전 결과 비교 + 새거 진행 중" 보고 싶을 수 있는데 — 일단 단순화. polish 가능.
- **RESULT canvas dim = bbox dim**: bbox 가 매우 큰 region (예: 1016×639) 은 panel 에 꽉 차서 OK. 매우 작은 region (예: 70×191) 도 max-h-full max-w-full + CSS object-fit 으로 panel 안에 보이지만 작음. 충분.
- **composite 도 여전히 만들어짐**: phase.blob/url 에 합성 blob 저장됨 (apply 시 사용). focus RESULT 는 시각적 표시만, apply pipeline 은 그대로.

## 검증

- typecheck 통과
- biome 통과
- `next build` 통과

## 시각 검증 가이드

```bash
git pull && pnpm install && pnpm dev

# 1. 6 region 胸 layer 진입 → PICKER VIEW
# 2. region 1 (chest) 클릭 → FOCUS MODE
# 3. SOURCE: region 1 만 tight-cropped 보임 (가슴 mesh)
# 4. RESULT: "type a prompt and generate to see output" 메시지
# 5. PROMPT 입력 + "generate this region" click
#    - RESULT: "generating this region · provider call in flight" + ~10–30s 표기
# 6. 1~30초 후 generation 완료 → ✓ generated badge
#    - RESULT: SOURCE 와 같은 dim/framing 의 canvas, 새 generated content 보임
# 7. SOURCE/RESULT 양쪽 비교 직관 — 같은 bbox 안에서 변화 확인
# 8. "← regions" → PICKER VIEW
#    - region 1 카드에 ✓ 표시
# 9. region 2 클릭 → 그 region 의 SOURCE / 별개 RESULT
# 10. apply → atlas 에 region 1 + region 2 의 generated 가 composite 로 반영
```

## 남은 follow-up

- single-component layer 도 같은 region-preview 패턴으로 통일 (현재는 panel.url img 사용)
- running 중에도 이전 succeeded blob 화면에 유지 (시각 비교용)
- RESULT canvas 옆 small "before/after toggle" 토글 (이전 generated vs 현재 generating)
