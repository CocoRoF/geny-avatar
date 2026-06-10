# #37 — Paint 모드 정합 + 뷰포트/도구 결함 수정

결함: E1 E2 E3 E4 E5 E6 E7 E10 ([02-결함목록](../02-결함목록.md))

## 무엇을 / 어떻게

- **E1**: bucket/wand 의 flood 소스를 paint 모드에서 작업 중인 paint 캔버스로
  분기 (기존엔 항상 pre-edit 소스 추출본 → 이번 세션에 칠한 픽셀 무시).
  paint 모드의 bucket 은 sampleMode 도 alpha→rgb 로 — 색이 있는 픽셀 위에서
  색 기준으로 채우는 게 페인트 버킷의 의미론.
- **E2**: `extractCurrentLayerCanvas` 가 texture override 합성 시 라이브 경로
  (`compositeTexture`)와 동일하게 클립→와이프→draw. 지운 픽셀이 재진입 시
  되살아나고 재저장 때 ghost 로 베이크되던 문제 해소.
- **E3**: "clear" 가 스토어를 즉시 쓰지 않음 — 로컬 캔버스 클리어 + 히스토리
  entry 만. 스토어 반영은 save 시점에 "전부 빈 마스크 → null 저장(row 제거)"
  으로 일원화. clear 의 undo 가능해짐, 미저장 paint 작업 파괴 없음.
- **E4**: 깨진 `zoomAtClient` 구현 제거, 올바른 `zoomAroundPoint` 를 그 이름으로
  공개 (소비자 무변경). 줌 도구 클릭이 커서 앵커 유지.
- **E5**: 뷰포트 상태를 `viewRef` + `applyView` 단일 쓰기 경로로 — setter 안의
  setter side effect 제거 (StrictMode pan 2배), 연속 wheel 의 stale pan 도 해소.
- **E6**: `requestClose` 가 embedded 모드에서 `onClose` 로 dismiss — GEN MASK
  탭에서 Esc 가 죽은 듯 보이던 문제 해소.
- **E7**: `isToolAvailable(tool, mode)` 를 tools.ts 에 신설해 Toolbox 필터·단축키
  핸들러·모드 전환 리셋이 공유. 보이지 않는 활성 도구 불가능해짐.
- **E10**: floodFillClient worker onerror 시 terminate + null — 다음 클릭이 새
  worker 를 lazy 생성. pointer-down 의 bucket/wand 호출에 `.catch` 부착
  (unhandled rejection 제거).

## 검증

`pnpm typecheck` / `pnpm lint` 통과 (warning 17 기존 동일).

## 남긴 것

- E17 의 wand stale-closure 병합 / spaceHeld blur 고착은 #39.
- bucket 의 paint 모드 rgb 샘플링은 tolerance 의미가 알파 기준과 다름 —
  기본 tolerance(0-128) 그대로 두고 사용감은 추후 조정.
