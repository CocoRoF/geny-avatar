# 2026-05-07 — Sprint 5.2: OpenAI multi-image input

[`56 sprint_5_1`](2026-05-07_56_sprint_5_1_reference_store.md) 의 ref store가 IDB까지 들어왔으니, 이번 sprint 가 **그걸 실제 generate 호출 흐름에 흘려넣는** 단계.

## gpt-image-2 의 multi-image 능력

[OpenAI docs](https://developers.openai.com/api/docs/guides/image-generation) 에 따르면 `/v1/images/edits` 가 `image[]` 배열 노테이션을 받음:

```bash
curl -X POST "https://api.openai.com/v1/images/edits" \
  -F "image[]=@source.png" \
  -F "image[]=@reference1.png" \
  -F "image[]=@reference2.png"
```

다중 이미지 중 mask 는 **첫 번째에만 적용**됨. 나머지 entry 는 character / style reference 로 작용. 이게 cloud API 단독으로 캐릭터 일관성을 잡는 길.

## 변경 surface

### `ProviderCapabilities.supportsReferenceImages` (`lib/ai/providers/interface.ts`)

새 boolean. provider 가 `image[]` 같은 multi-input 을 지원하는지 표시:

- **OpenAI**: `true` (gpt-image-2 family)
- **Gemini Nano Banana**: `false` — 검증 안 됨
- **Replicate SDXL**: `false` — IP-Adapter 없으면 부적합. ComfyUI roadmap 의 일부

`ProviderGenerateInput` 에 `referenceImages?: Blob[]` 도 추가. 순서 보존 — 첫 번째 ref 가 가장 강한 anchor.

### `OpenAIProvider` (`lib/ai/providers/openai.ts`)

#### Form 빌드: `form.set("image", ...)` → `form.append("image[]", ...)`

```ts
form.append("image[]", input.sourceImage, "source.png");
refs.forEach((ref, idx) => {
  const ext = blobExtension(ref);
  form.append("image[]", ref, `reference-${idx}.${ext}`);
});
if (input.maskImage) form.set("mask", input.maskImage, "mask.png");
```

Source 가 항상 [0] 번 (mask 가 적용되는 슬롯). Refs 가 [1...n] 번.

`blobExtension(blob)` 헬퍼는 mime → 확장자 변환 (PNG/JPG/WebP/GIF). Provider 들은 파일 이름 자체는 신경 안 쓰지만 OpenAI 가 multipart entry 에 합리적 이름을 기대해서 명시.

#### Prompt 합성 — refs 가 있을 때 anchor 문장 자동 prepend

```ts
private composePrompt(input): string {
  const parts: string[] = [input.prompt.trim()];
  const refs = input.referenceImages ?? [];
  if (refs.length > 0) {
    parts.push(
      `Use the additional ${refs.length} image(s) purely as character and style reference for the masked region of the first image: match the silhouette, palette, lighting, and identity shown there. Do not blend reference content into the result outside of style.`
    );
  }
  if (input.negativePrompt?.trim()) {
    parts.push(`Avoid: ${input.negativePrompt.trim()}`);
  }
  return parts.join("\n\n");
}
```

핵심 가드: "match style, do not blend content." 없으면 gpt-image-2 가 reference 의 객체를 결과에 합성해 버림 (예: 얼굴 ref 를 줬는데 결과에 추가 얼굴이 등장). 검증 후 필요시 templates (Sprint 5.4) 가 prompt 의 우선순위 조정.

#### Diagnostic 로그

`[openai] POST ... refs=N (sizeA,sizeB,...) promptLength=...` — 한 줄에 ref 개수와 각 byte size 노출. cost / latency tracking 용.

### Client `submitGenerate` (`lib/ai/client.ts`)

`SubmitGenerateInput` 에 `referenceImages?: Blob[]` 추가. Form 에 같은 key `referenceImage` 로 다중 append:

```ts
input.referenceImages?.forEach((ref, idx) => {
  form.append("referenceImage", ref, `ref-${idx}`);
});
```

`ProviderAvailability.capabilities.supportsReferenceImages` 도 추가 → provider 능력을 client 가 알 수 있음.

### API route `/api/ai/generate`

```ts
const referenceImages: Blob[] = form
  .getAll("referenceImage")
  .filter((v): v is File => v instanceof File);

// strip refs for providers that don't support them
const supportsRefs = provider.config.capabilities.supportsReferenceImages;
const forwardedRefs = supportsRefs ? referenceImages : [];
```

순서 유지 (`getAll` is 삽입순). 지원 안 하는 provider 는 server-side 에서 drop + diagnostic 로그.

### `GeneratePanel` 와이어링

```ts
const { references } = useReferences(puppetKey);
const supportsRefs = provider?.capabilities.supportsReferenceImages === true;
const activeRefBlobs = supportsRefs ? references.map((r) => r.blob) : [];

await submitGenerate({
  ...,
  referenceImages: activeRefBlobs.length > 0 ? activeRefBlobs : undefined,
});
```

#### UI hint: ref summary box

generate 버튼 위에:

- **OpenAI 선택 + ref 있음**: "N reference image(s) will ride along — Sent as `image[]` after the layer source — gpt-image-2 uses them as character / style anchors."
- **다른 provider 선택 + ref 있음**: "N reference image(s) stored, but {provider} doesn't accept multi-image input — they'll be ignored for this generation."
- **ref 없음**: 안 보임

## 의도적 한계 (Sprint 5.3 이후 처리)

- **모든 ref 가 자동 활성**: 사용자가 끄거나 일부만 선택 X. 5.3 이 active checkbox + history → ref 승격
- **이전 generation 결과를 ref 로 (iterative)**: 5.3
- **Prompt template 우선순위 / chip**: 5.4
- **Quality comparison viewer**: 5.5
- **Gemini multi-image 지원**: 검증 후 별도 sprint

## 검증

- typecheck 통과
- biome 통과
- `next build` 통과

## 시각 검증 가이드

```bash
git pull && pnpm install && pnpm dev

# 1. Reference 1~2장 업로드된 puppet 로 진입 (Sprint 5.1 이미 검증)
# 2. layer 에 gen 클릭 → GeneratePanel 열림
# 3. provider 가 "OpenAI gpt-image" 인 상태에서:
#    - prompt input 위에 ref summary box 등장
#    - "1 reference image will ride along — Sent as image[]..." 식 텍스트
# 4. provider 를 Gemini 로 바꾸면:
#    - "stored, but {provider} doesn't accept multi-image input — they'll be ignored"
# 5. 다시 OpenAI 로 → prompt 입력 → generate
# 6. 콘솔에서:
#    - [GeneratePanel] submit: provider=openai model=gpt-image-2 refs=N
#    - [openai] POST ... refs=N (sizeA,...) promptLength=...
# 7. 응답 받으면 result 가 user 의 ref 의 character / style 따라가는지 확인
#    - ref 와 결과 이미지를 나란히 봐서 톤 / 라인 / 팔레트 일치 여부
# 8. ref 없는 puppet 으로 돌아가서 generate → ref summary box 안 보이고 동작 그대로
# 9. 같은 layer 두 번 generate → 두 결과가 ref 의 anchor 덕에 톤 어긋나지 않는지 확인 (V1 가치 제안)
```
