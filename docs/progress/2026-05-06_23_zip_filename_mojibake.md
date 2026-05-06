# 2026-05-06 — ZIP 파일명 mojibake 수정

## 사용자 보고

중국어 파일명 (`免费模型艾莲/...`)이 포함된 Cubism 자산 ZIP을 `/poc/upload-debug`에 드롭했더니:
- 어댑터 detect는 정상 (`runtime: "live2d"`, `confidence: "high"`)
- 매니페스트 안의 `Moc: "免费模型艾莲.moc3"`는 정상 (JSON 표준은 UTF-8)
- 그런데 `entries`의 path는 `Ãå · ÑÅéÐ¦ ¬Ä~/black.exp3.json` 같이 mojibake
- 결과: `warnings (6): moc3 not found in bundle — left as-is …` (모든 sibling 미발견)

`/poc/upload`에 같은 자산 드롭 시 어댑터 로드 실패 (sibling URL이 안 잡힘).

## 원인 — fflate가 ZIP의 UTF-8 파일명을 Latin-1로 디코드

ZIP 스펙은 일반 목적 비트 11(EFS)이 set이면 UTF-8, 아니면 CP437(Latin-ish)로 파일명을 해석. 그러나 현실의 많은 도구(Windows Explorer 구버전, Chinese/Korean/Japanese OS의 일부 도구)가 **UTF-8 바이트를 그대로 쓰면서 비트 11을 set 안 함**. fflate는 비트 11 안 set이면 Latin-1로 디코드 → UTF-8 → Latin-1 mojibake.

매니페스트 파일은 *내용*이 UTF-8 JSON이라 정상 파싱되지만, ZIP entry path가 mojibake → manifest 안의 정상 string과 매칭 실패.

## 수정 — `recodeZipName` 헬퍼

`unpackZip`에서 fflate가 반환한 path를 받아:
1. ASCII만이면 그대로 반환 (대부분의 case 빠른 패스)
2. 비-ASCII가 있으면 charCodeAt으로 byte array 추출 (각 char가 0~255라 가정)
3. 다음 인코딩 순으로 fatal mode TextDecoder 시도:
   - `utf-8` (대부분의 mojibake 원인)
   - `gbk` (Simplified Chinese)
   - `shift_jis` (Japanese)
   - `euc-kr` (Korean)
4. 첫 번째로 invalid bytes 안 던지고 `�` 안 포함하는 결과 채택
5. 다 실패하면 원본 그대로 반환 (어차피 못 고침)

UTF-8 fatal mode가 잘못된 byte sequence를 reject하니, byte가 정말 UTF-8이면 정상 디코드 + 일치 확인. GBK 등은 사용자가 native encoding으로 ZIP을 만든 케이스 대응.

## 검증

- typecheck/lint/build 통과
- 사용자 자산으로 시각 검증 필요 — `/poc/upload`에 같은 ZIP 다시 드롭하면 entries에 정상 중국어 path가 보이고 warnings 사라져야 함

## 학습

- 라이브러리가 zip metadata를 어떤 인코딩으로 디코드하는지 가정으로 두지 말 것. mojibake는 침묵 실패의 전형.
- 해결책 — ASCII fast-path + 인코딩 순회 fallback. JS에 TextDecoder가 있는데 안 쓰면 손해.

## 파일 변경

- `lib/upload/parseBundle.ts` — `recodeZipName` 헬퍼 추가, `unpackZip`이 호출.
