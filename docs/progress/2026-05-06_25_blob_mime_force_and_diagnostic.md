# 2026-05-06 — Blob MIME 강제 덮어쓰기 + 진단 로그

## 사용자 보고 (24 후속)

24의 type 부여 fix 후 동일 자산 시도. 어댑터 load 자체는 진행 — 콘솔에 `partsMapped=75 nativeDrawables=true` (model3.json + moc3 매칭 + Cubism native 핸들 OK). 그러나 텍스처 fetch 단계에서:

```
PixiJS Warning: [Assets] blob:... could not be loaded as we don't know how to parse it
× 3 (3장의 텍스처 모두)
```

캐릭터는 화면에 안 뜸.

## 진단

24의 `ensureBlobType`은 type이 *비어있을 때만* 새 Blob으로 wrap. 가능성:
- IndexedDB의 **옛 자산**이 24 fix 이전에 저장됨. 이 시점의 unpackZip은 type 없는 Blob을 만들었음. IndexedDB가 Blob을 그대로 보존 → load 시 type 빈 그대로.
- 그러나 ensureBlobType은 빈 type일 때 wrap해야 하는데 — 어쩌면 IndexedDB가 type을 빈 string이 아닌 다른 default(예: `application/octet-stream`)로 deserialize?
- 그 경우 24의 `if (entry.blob.type) return entry;`이 falsy 검사라 비어있지 않으면 그대로 두고 wrap 안 함 → texture에 잘못된 type 남음.

## 수정

### `ensureBlobType` 강하게 — 항상 path 기반 덮어쓰기

```ts
function ensureBlobType(entry: BundleEntry): BundleEntry {
  const desired = mimeForPath(entry.path);
  if (entry.blob.type === desired) return entry;  // 정확히 같을 때만 skip
  return {
    ...entry,
    blob: new Blob([entry.blob], { type: desired }),
  };
}
```

이전: type이 truthy면 skip → 잘못된 type도 통과
이후: path 추론한 desired type과 다르면 무조건 wrap → 옛 IndexedDB 자산도 강제로 fix

### 진단 로그

`parseBundle`이 normalize 끝낸 직후 한 번:
```
[parseBundle] normalized N entries (M png) · sample: path1 → image/png | path2 → application/json | ...
```

png count가 0이면 mimeForPath나 ensureBlobType이 잘못 동작. sample로 첫 3 entry의 실제 type 확인 가능.

## 검증

typecheck/lint/build 통과. 사용자가 `/poc/upload?puppet=...`에 다시 진입하면 console에 진단 로그가 뜨고, 이번엔 텍스처가 정상 로드되어 렌더 성공해야 함.

만약 **진단 로그에서 png type이 정상이고도 여전히 fail**이면 — Pixi Assets의 detector가 blob URL의 fetch 응답 Content-Type을 안 보거나 Live2D 엔진이 우회 fetch를 하는 케이스. 그 경우 사용자 console 결과 들고 다음 단계 진단.

## 사용자 액션 가이드

```bash
git pull && pnpm dev
# /poc/library 에서 카드 클릭 → /poc/upload?puppet=...
# console 확인:
#   [parseBundle] normalized N entries (M png) · sample: ...
# 그 다음 [Live2DAdapter] patched internalModel.update ...
# 그 다음 PixiJS Warning이 또 뜨는지 / 캐릭터가 뜨는지
```

진단 로그 결과 알려주시면 다음 단계 결정.
