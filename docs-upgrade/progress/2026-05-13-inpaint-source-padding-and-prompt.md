# 2026-05-13 hotfix — inpaint source를 neutral grey로 padding + prompt scaffold 강화

**Phase / 작업**: 사용자 보고 3번 (character hallucination) 처리
**상태**: done
**관련 계획**: [../plan/01-Phase1.md](../plan/01-Phase1.md)

## 사용자 보고

> "gen에서 전체 영역 마스크 (전체 영역 선택해야 하니) 이후 white
> hair로 gen — 전혀 이상하게 나오고 있음"

결과 image에 silhouette 안쪽에 **character 전체 (얼굴 / 눈 / 입 /
어깨)** 가 들어옴. mask 정확 (RGB white-on-black, silhouette 전체 =
edit zone), prompt도 정상 — model이 **isolated atlas crop을 character
thumbnail로 해석**하는 본질적 prior.

## 진단

fal-general/inpainting 입력 형식 분석:
- source: 머리 atlas crop (silhouette 안 = 머리 색, 외부 = transparent)
- mask: RGB white-on-black (silhouette = edit, 외부 = preserve)

silhouette 외부의 transparent 영역이 model 입장에서 "missing context".
silhouette만 보면 character의 외곽선처럼 보임 → "이 outline 안을
character로 채워라" 식 prior 작동.

해결 두 갈래:
- **A. source 입력 형식 변경**: transparent → neutral grey BG.
  silhouette이 "outline of character" 아니라 "texture embedded in a
  neutral frame" 으로 해석되게.
- **B. prompt scaffold 강화**: PR #13에서 flux-2/edit에 시도한
  character feature 금지 패턴을 inpainting에도 적용.

A + B 같이 진행 (서로 보완).

## 변경

### A. Source 전처리 (신설 `lib/avatar/inpaintSourcePrep.ts`)

```ts
export async function bakeTransparencyToNeutral(
  sourceCanvas: HTMLCanvasElement,
): Promise<Blob>
```

- 입력 source canvas와 동일 dim의 새 canvas 생성.
- 전체를 RGB(127,127,127) 50% grey로 fill.
- 그 위에 source 그림 (silhouette만 alpha=255, 그 외엔 grey가 살아남음).
- 마지막에 alpha 채널을 전부 255로 강제 (alpha를 soft mask로 해석
  하는 endpoint 호환 + grey BG를 solid로 보장).

50% grey 채택 — white/black은 색 방향을 bias. neutral grey는 model이
"안 칠해진 일반 frame" 으로 해석.

### B. composeInpaintingPrompt 강화 (`lib/ai/providers/falai.ts`)

기존 (약함):
```
preserve the existing region

Style: anime / illustration, soft cel shading. NOT photoreal. ...
```

신규 (4-layer scaffold):
```
The image is one drawable from a multi-part Live2D-style 2D rigged
puppet — an ISOLATED ATLAS TEXTURE REGION, NOT a portrait or character
thumbnail.

Repaint ONLY the masked region. DO NOT add face, eyes, mouth, body,
hands, accessories, or any character feature that is not already
present. The grey background outside the mask is just padding; do
not bleed colours into it and do not treat the silhouette as a
complete character to draw.

Edit instruction: <user prompt>

Style: anime / illustration, soft cel shading. NOT photoreal. NOT
3D. Keep the line weight and shading style of the original.
```

PR #13의 flux-2/edit 패턴을 inpainting에 동일하게 적용. "grey
background = padding" 명시로 source A 변환과 시너지.

### `GeneratePanel.tsx` onSubmit 분기

```ts
if (isInpaintingModel) {
  geminiSourceBlob = await bakeTransparencyToNeutral(sourceCanvas);
  console.info(`[generate] inpaint source: baked transparency to neutral grey (${size}B). ` +
    "Drops the 'character thumbnail' prior that hallucinates face/body inside the silhouette.");
  // ... mask 분기 그대로
} else {
  geminiSourceBlob = await canvasToPngBlob(sourceCanvas);  // 기존
  // ...
}
```

비-inpainting 흐름 (Gemini / OpenAI / flux-2/edit) 영향 없음 — 기존
`canvasToPngBlob` 그대로.

## 검증

- `pnpm typecheck` ✓
- `pnpm exec biome check` ✓
- 실호출 검증: 사용자가 dev 재시작 후
  1. GeneratePanel → [MASK] 탭 → 전체 silhouette mask 또는 일부 mask.
  2. [GEN] 탭 → fal.ai FLUX + flux-inpainting + "white hair" → generate.
  3. 콘솔 `[generate] inpaint source: baked transparency to neutral
     grey (...)` + `inpaint mask: user-painted ...`.
  4. 결과: silhouette 안에 character 없이 **머리만 흰색으로 redraw**.

## 결정

1. **두 fix를 같은 PR**. source padding + prompt scaffold는 서로
   보완 (source가 신호, prompt가 명시 확인). 분리하면 어느 게
   효과 줬는지 측정 어렵지만 두 fix 모두 표준 patterns이라 분리
   ROI 낮음.
2. **50% grey BG**. white/black 대신 perceptual neutral. 사용자
   의도 (예: "흰 머리") 와 BG 색이 충돌 안 함.
3. **inpainting model에만 적용**. flux-2/edit / Gemini / OpenAI는
   기존 흐름 — atlas-crop 시나리오에서 다른 model이 잘 작동하는
   경로 회귀 없음.
4. **alpha 강제 255**. soft alpha를 mask로 해석하는 endpoint도
   호환되게 보장. 우리 mask는 별 채널이므로 source alpha는 무관.

## 영향

- inpainting model에서 character hallucination 차단 기대 — 사용자
  검증으로 효과 측정.
- 다른 generate 경로 영향 없음.
- `inpaintSourcePrep.ts` 는 향후 character mask, accessory mask 등
  유사 use case에서도 재사용 가능.

## 추가 후속 (백로그)

- 만약 grey BG로도 character hallucination 잔존 → source padding
  을 더 키움 (canvas dim 자체 확장, silhouette을 작은 부분으로
  보이게).
- inpainting 결과 외곽선의 anti-alias bleeding은 그대로 — `applyOverrides`
  의 alpha-clip이 처리.

## 참조

- 손댄 파일 3개:
  - `lib/avatar/inpaintSourcePrep.ts` (신설)
  - `components/GeneratePanel.tsx` (onSubmit inpaint 분기 + import)
  - `lib/ai/providers/falai.ts` (composeInpaintingPrompt 강화)
- PR: 이 entry가 포함된 PR이 머지될 때 main에 들어감.
