# #46 — Restyle 패널 내장 레퍼런스 업로드

## 무엇을

Restyle 패널이 사이드바 References 패널에 의존해 패널 안에서 레퍼런스를
추가할 방법이 없었음 (사용자 피드백). 패널 안에 업로드/삭제 스트립 추가.

## 어떻게

- `useReferences` 의 기존 `upload`/`remove` 재사용 — 같은 IDB 행이므로
  사이드바 References 패널과 양방향 공유 (per-layer Gen 에도 동일하게 동승).
- 썸네일 스트립 (hover 시 × 삭제) + multiple 파일 업로드 + 빈 상태 안내.
  실행 중에는 업로드/삭제 비활성.
- 썸네일 objectURL 은 references 변경 시 이전 목록 것만 revoke (새 memo 가
  새 URL 을 발급하므로 안전).

## 검증

`pnpm typecheck` / `pnpm lint` 0 error.
