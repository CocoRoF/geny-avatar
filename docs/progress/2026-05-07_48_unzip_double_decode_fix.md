# 2026-05-07 — Fix: parseBundle 더블 디코드 (CJK puppet 이름)

## 증상

CJK 이름 (`免费模型艾莲`) 을 가진 Cubism puppet을 편집 → `export model` 로 zip 다운로드 → 다시 `/poc/upload`에 드롭 시 모든 텍스처 / moc3 fetch가 404, manifest 참조가 `M9!救ｲ/...` 같은 mojibake로 굴러감.

```
[parseBundle] normalized 18 entries (3 png) · sample: M9!救ｲ/black.exp3.json
[Live2DAdapter] preload texture failed (免费模型艾莲.4096/texture_00.png)
warnings (6): moc3 "免费模型艾莲.moc3" not found in bundle — left as-is
TypeError: Failed to construct 'URL': Invalid URL
```

## 원인

`recodeZipName` (parseBundle.ts:192) 의 잘못된 가정.

- 우리가 export하는 zip은 **fflate가 UTF-8 EFS 비트를 세팅한** 표준 zip.
- 다시 import 시 `unzipSync`가 EFS 플래그 보고 정상 UTF-8 디코드 → `name` 이미 올바른 유니코드 (`免费模型艾莲/...`).
- 하지만 `recodeZipName`은 "fflate가 latin-1로 디코드했다"고 무조건 가정 → `charCodeAt(i) & 0xff` 로 8비트 byte 배열을 만듬.
- `免` (U+514D, 0x4D = 'M'), `费` (U+8D39, 0x39 = '9'), `模` (U+6A21, 0x21 = '!') ... 와 같이 **하위 8비트만 남고 정보 손실**.
- UTF-8 fatal 디코드는 실패 (0x8B 같은 byte는 valid UTF-8 시작 byte 아님).
- shift_jis fatal 디코드가 우연히 통과: `0x8B 0x7E` → `救`, `0xB2` → `ｲ`. 결과: `M9!救ｲ`.

원래 외부 puppet zip은 EFS 비트 없는 게 많아 (Windows Explorer pre-2018 등) 이 recoder가 정확하게 mojibake를 복구해줬다. 하지만 EFS 있는 zip을 입력으로 받으면 거꾸로 mojibake를 만들어버림.

## 패치

`recodeZipName`이 입력 codepoint > 0xFF 면 **이미 정상 유니코드**로 인정하고 그대로 반환:

```ts
for (let i = 0; i < name.length; i++) {
  const c = name.charCodeAt(i);
  if (c > 127) allAscii = false;
  // Codepoint > 0xff means fflate already decoded the EFS-flagged
  // path as proper Unicode. Re-decoding would lose the high byte.
  if (c > 0xff) return name;
}
```

이 한 줄 가드로:
- EFS 있는 zip (우리 export 포함, 모던 도구 다수) → 그대로 반환 ✓
- EFS 없는 zip (외부 mojibake) → 기존 latin-1 → UTF-8/GBK/shift_jis/EUC-KR 복구 경로 그대로 ✓

## 영향

- ASCII-only 파일명 puppet (대부분의 영문 puppet) → 영향 없음 (allAscii early return)
- 한 번 export된 CJK puppet의 round-trip → 정상 작동
- 외부 도구가 EFS 없이 압축한 CJK 파일명 zip → 기존대로 복구
- 외부 도구가 EFS 있게 압축한 CJK 파일명 zip → **기존엔 깨졌으나 이번 fix로 살아남음** (의도치 않은 보너스)

## 검증

- typecheck 통과
- biome 통과
- 시각 검증은 사용자가 export model + re-upload round-trip으로 확인

## Phase 3 hotfix처럼 doc 자체로 회귀 가능

이 fix는 단일 함수 수정. 향후 mojibake 사례가 다시 발견되면 [Phase 3 hotfix pass](2026-05-07_40_phase3_hotfix_pass.md)와 같은 방식으로 추가.
