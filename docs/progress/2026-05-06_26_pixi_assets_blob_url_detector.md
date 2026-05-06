# 2026-05-06 — Pixi Assets는 blob URL 확장자를 못 본다

## 진단 — 결정적 단서

사용자 console (25 fix 후):
```
[parseBundle] normalized 18 entries (3 png) · sample: 免费模型艾莲/black.exp3.json → application/json | 免费模型艾莲/idle.motion3.json → application/json | 免费模型艾莲/idle2.motion3.json → application/json
```

- 18 entries 정상 normalize
- **3 png** ← png 파일 type이 image/png로 정확히 박혔다는 명백한 signal
- (sample은 첫 3개라 png 안 보일 뿐)

그런데도 여전히 fail:
```
PixiJS Warning: [Assets] blob:... could not be loaded
```

→ **type 부여는 다 맞는데 Pixi가 그걸 무시함**.

## 원인

Pixi v8의 `Assets` loader 흐름:
1. `Assets.load(url)` 호출
2. 등록된 detectorParsers (detectImage, detectJson, ...)를 순회
3. **각 detector는 URL string의 확장자만 검사** — fetch 응답의 Content-Type은 안 봄
4. 매칭 안 되면 어떤 parser도 안 골라 → null + warning

```js
// Pixi v8의 detectImage 대략:
detectImage = {
  test: async (url) => {
    const ext = path.extname(url).slice(1).toLowerCase();
    return validImageExtensions.includes(ext);
  }
};
```

blob URL은 `blob:http://localhost:3000/<uuid>` — 확장자 없음. detectImage는 false 반환. → 어떤 parser도 매칭 안 됨.

Blob에 type 박는 건 **fetch 후의 Content-Type 응답을 위한 것**이지만 Pixi의 detector는 **fetch 전의 URL 검사** 단계에서 이미 떨어짐.

## 해결 — Live2DAdapter에서 텍스처를 명시적 loadParser로 미리 등록

`Live2DModel.from(manifestUrl)` 호출 전에:
1. manifest를 직접 fetch + parse
2. `FileReferences.Textures` 안의 각 URL을 `Assets.load({ src, loadParser: 'loadTextures' })`로 미리 로드
3. 이러면 Pixi가 detector를 우회하고 명시된 parser 직접 사용 → cache에 텍스처 등록됨
4. 이후 engine이 같은 URL로 `Assets.load`를 호출하면 cache hit → detector 안 거침

```ts
private async preloadTextures(manifestUrl: string): Promise<void> {
  const res = await fetch(manifestUrl);
  const manifest = JSON.parse(await res.text());
  const refs = manifest.FileReferences?.Textures ?? [];
  for (const ref of refs) {
    if (typeof ref !== "string") continue;
    await Assets.load({ src: ref, loadParser: "loadTextures" });
  }
}
```

`Live2DAdapter.load()`에서 `Live2DModel.from` 직전에 호출.

## 학습

이번 텍스처 fail은 4단계 layer:
1. blob URL 자체 (디렉터리 의미 없음) → manifest rewrite [1.3b]
2. Blob type 미설정 → mimeForPath [24]
3. 옛 IndexedDB save가 잘못된 type을 갖고 있을 가능성 → 강제 덮어쓰기 [25]
4. **Pixi detector가 URL 확장자만 본다** → loadParser 명시 [이번]

각 layer가 다른 fail mode. blob URL을 외부 라이브러리에 넘기는 건 hidden default가 4중 4중. 다음에 비슷한 상황 — 어댑터에서 직접 Assets.load + loadParser가 default 패턴.

## 검증

- typecheck/lint/build 통과
- 콘솔에 새로 뜨는 로그: `[Live2DAdapter] preloaded N/M textures`
- N=M이면 모든 텍스처 정상 등록 → render 성공 기대
- N<M이면 일부 텍스처 fetch 실패 (blob URL이 깨졌거나)

## 사용자 액션

```bash
git pull && pnpm dev
# /poc/upload 또는 /poc/library에서 자산 다시 시도
# console에 다음 줄들이 떠야:
#   [parseBundle] normalized ... (3 png) · ...
#   [Live2DAdapter] preloaded 3/3 textures      ← 이게 정상 신호
#   [Live2DAdapter] patched internalModel.update ...
# 그리고 화면에 캐릭터가 정상으로 떠야 함
```
