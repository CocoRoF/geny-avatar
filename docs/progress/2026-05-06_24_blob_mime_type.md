# 2026-05-06 — Blob MIME type for upload pipeline

## 사용자 보고

mojibake fix(`4d5722c`) 후 같은 ZIP 다시 드롭. parseBundle이 정상 작동 (97 parts, 480 drawables, partsMapped=75, manifest 매칭 성공). 그러나 렌더 시점에:

```
PixiJS Warning: [Assets] blob:http://localhost:3000/... could not be loaded
                as we don't know how to parse it
× 3 (texture 3장 모두)

Uncaught TypeError: Cannot read properties of null (reading 'source')
    at Live2DModel.resolveTextureForRender
```

캐릭터 안 뜸.

## 원인

Pixi Assets는 어떤 parser를 쓸지 결정할 때:
1. URL 끝의 확장자 (`.png`, `.json`)
2. fetch 응답의 `Content-Type` 헤더

blob URL은 (1) 확장자 없음. (2)의 Content-Type은 *Blob 객체의 `type` 필드*가 그대로 박힘. 우리 fflate로 푼 Blob은 type 미설정 (`""`) → Pixi가 어떤 parser도 못 골라 → null 반환 → render에서 폭발.

manifest/atlas는 rewrite 함수에서 새 Blob 만들 때 이미 명시했지만(`application/json`, `text/plain`), unpackZip이 만든 raw 텍스처 Blob들이 type 없는 채로 모델에 흘러감.

## 수정

### `mimeForPath(path)`

확장자 → MIME 매핑:
- `.png` → `image/png`
- `.jpg`/`.jpeg` → `image/jpeg`
- `.webp` → `image/webp`
- `.json` → `application/json`
- `.atlas` → `text/plain`
- 그 외 → `application/octet-stream` (.moc3, .skel, .bin 등)

### `unpackZip` Blob 생성 시 type 부여

```ts
const blob = new Blob([new Uint8Array(bytes)], { type: mimeForPath(path) });
```

### `ensureBlobType` — 모든 entry의 type 보장

parseBundle 진입 즉시 각 entry의 Blob에 type이 비어있으면 path 추론으로 새 Blob에 wrap. 적용 대상:
- 폴더 드롭의 File (확장자 없는 binary는 File.type이 `""`)
- IndexedDB replay (이전 버전이 저장한 type-less Blob)

새 Blob wrap은 underlying memory 공유 — 비용 거의 0.

## 검증

typecheck/lint/build 통과. 사용자 자산 재드롭 시 텍스처가 정상 로드되어 렌더 가능 기대.

## 학습

mojibake 다음에 또 다른 silent failure. blob URL 사용은 default behavior가 다 다름:
- 디렉터리 의미 없음 (1.3b — manifest rewrite로 해결)
- Content-Type 없음 (이번 — Blob type으로 해결)

blob URL을 어댑터에 넘길 때 항상 두 channel 다 챙기는 게 default가 되어야 함.

## 파일 변경

- `lib/upload/parseBundle.ts` — `mimeForPath`, `ensureBlobType` 추가, `unpackZip`이 호출, parseBundle 진입에서 normalize
