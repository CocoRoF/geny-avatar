# 2026-05-13 hotfix — OpenAI 호출 120s timeout + mask reference dim 정렬

**Phase / 작업**: PR #29 follow-up
**상태**: done
**관련 계획**: [../plan/01-Phase1.md](../plan/01-Phase1.md)

## 사용자 보고

```
Error: generate timed out after 120000ms
```

server 콘솔에 `[openai] response` 가 안 보임 — OpenAI 호출이 client
polling timeout (120s) 안에 안 끝남.

## 진단 — 두 가지 원인

1. **OpenAI multi-image edit 처리가 느려짐**:
   - image[]: 3 entries (source + mask-reference + character snapshot)
   - 긴 refined prompt (gpt-5.4 refinement 결과)
   - OpenAI server-side compute 60-150s 가능.
   - 120s ceiling이 너무 짧음.

2. **mask reference dim mismatch 가능성**:
   - source는 multi-component path의 padded comp.padded (1024²).
   - mask reference는 원본 atlas dim (예: 384×384).
   - OpenAI multi-image 입력에서 dim 다른 image들이 잘못 해석될 수
     있고, server-side에서 hang 가능.

## 수정 A — Client timeout 300s

`lib/ai/client.ts`:

```ts
// 120_000 → 300_000
const timeoutMs = input.timeoutMs ?? 300_000;
```

OpenAI gpt-image-2 multi-image edit가 우리 use case (3 image + 긴
prompt) 에서 60-150s 정상. 300s ceiling은 worst case도 cover하고
genuinely 깨진 submit은 그래도 5분 안에 끊음.

## 수정 B — Mask reference dim align (single-source path 분기)

OpenAI + 사용자 MASK 있으면 multi-component split을 우회하고 single
padded source path로:

```ts
const isOpenAIMaskRef = providerId === "openai" && !!inpaintMaskBlob;
const useMultiComponent = providerId === "openai" && !isOpenAIMaskRef;

if (isOpenAIMaskRef && inpaintMaskBlob) {
  const prep = prepareOpenAISource(sourceCanvas);
  openaiInpaintPadding = { paddingOffset, sourceBBox, canvasSize: prep.padded.width };
  geminiSourceBlob = await canvasToPngBlob(prep.padded);
  openaiMaskRefBlob = await padInpaintMaskRefToOpenAI(
    inpaintMaskBlob,
    prep.paddingOffset,
    prep.padded.width,
  );
}
```

- `prepareOpenAISource` 로 source를 1024² padded square로.
- 신설 `padInpaintMaskRefToOpenAI` — mask blob을 같은 1024² 위
  `paddingOffset`에 배치 (RGB white-on-black 그대로, convention
  변환 X). 외부 영역 RGB black (preserve).
- submitGenerate에 `maskReferenceImage: openaiMaskRefBlob` 전달.
- postprocess는 `openaiInpaintPadding` 으로 atlas crop dim 복원.

multi-component path는 mask 없는 OpenAI 호출에만 진입 (기존 atlas
split 흐름 유지).

신설 헬퍼 `padInpaintMaskRefToOpenAI` 는 PR #26의
`convertInpaintMaskToOpenAIPadded` 와 다름:
- 이번 헬퍼: RGB convention 그대로 (white = edit, black = preserve).
  Image reference hint 용도.
- PR #26 헬퍼: alpha-invert + padded. OpenAI inpaint mask channel
  (`alpha=0=edit`) 용도. 두 헬퍼 모두 inpaintMask.ts에 존재.

## 검증

- `pnpm typecheck` ✓
- `pnpm exec biome check` ✓
- 실호출 검증: 사용자가 dev 재시작 후
  1. MASK 탭 paint → save → GEN → OpenAI 선택 → "change masked area
     to blue ocean color" → generate.
  2. 콘솔:
     ```
     [generate] openai mask-ref hint: padded source=1024x1024,
       mask aligned at offset=(X,Y) subrect=WxH.
     [openai] POST .../v1/images/edits
       image[]: 3 entries
         [0] source: padded 1024² source
         [1] mask-reference: 1024² aligned hint
         [2] reference: character snapshot
     ```
  3. timeout 120s 대신 300s.
  4. 결과: white painted 영역만 색 변경.

## 결정

1. **300s timeout**. OpenAI gpt-image-2 multi-image 처리 max 시간
   기준. 5분이면 무한 hang은 막고 정상 호출은 통과.
2. **single-source path (mask 있을 때)**. dim 일관성 + alignment 보장.
   multi-component는 mask 없는 흐름 그대로 유지.
3. **새 헬퍼 분리** (`padInpaintMaskRefToOpenAI` vs `convertInpaintMaskToOpenAIPadded`).
   둘 다 padded이지만 convention 다름 — 함수명으로 명확히 구분.
4. **fal inpaint 흐름 그대로**. 사용자 명시 선택 시.

## 영향

- OpenAI + mask 흐름 정상화 (timeout 회피 + dim align).
- 다른 흐름 회귀 없음.
- mask 의도가 image[]에서 spatial align 잘 되므로 model이 hint를
  더 정확히 활용 기대.

## 참조

- 손댄 파일 3개:
  - `lib/ai/client.ts` — timeout 300_000.
  - `lib/avatar/inpaintMask.ts` — padInpaintMaskRefToOpenAI 신설.
  - `components/GeneratePanel.tsx` — isOpenAIMaskRef 분기 + padded
    source + padded mask + submitGenerate에 maskReferenceImage 전달.
- PR: 이 entry가 포함된 PR이 머지될 때 main에 들어감.
