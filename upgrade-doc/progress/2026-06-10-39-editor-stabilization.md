# #39 — 에디터 안정화

결함: E8 E9 E11 E12 E13 E14 E17 ([02-결함목록](../02-결함목록.md))

## 무엇을 / 어떻게

- **E8**: HD-edge 토글이 dirty 상태에서 confirm 요구 (`requestHighDpiMask`) —
  무경고 스트로크/히스토리 파기 차단. in-place 리샘플은 추후 과제로 명시.
- **E9**: region IDB hydrate 가 `splitDirtyRef` 가드로 늦은 resolve 시
  auto-seed/사용자 스트로크를 클로버하지 않음.
- **E11**: useHistory 에 바이트 예산(256MB) 추가 — 카운트 캡(30)과 OR 조건,
  초과분은 baseline 으로 fold. 최소 1 entry 보장.
- **E12**: split 모드 Ctrl+Z 차단 — 보이지 않는 mask/paint 캔버스 변조 제거.
- **E13**: SAM 후보 썸네일 URL 을 useMemo + cleanup revoke 로, existingMask
  복원 경로의 URL 도 onload/onerror 에서 revoke.
- **E14**: GL 컴포지터 region 상한 8→12 (WebGL2 보장 16 텍스처 유닛 내,
  source/mask/paint/thresh 4 + region 12). 12 초과는 기존처럼 GL 미리보기
  한정 비표시 (편집 데이터는 영향 없음).
- **E17**: wand 연속 Shift+클릭 stale-closure 를 `wandSelectionRef` 로 해소,
  StrokeEngine 의 raw 샘플 추가 스탬프 제거 (spacing 보간만 — 고주파 펜에서
  density 스파이크 제거, 잔여 거리는 leftoverDist 가 이월), spaceHeld 가
  window blur 시 해제.

## 검증

`pnpm typecheck` / `pnpm lint` 0 error (warning 13 — 전부 기존 noNonNullAssertion 류).

## 남긴 것

- E20 (devicePixelRatio 모니터 이동, 딥줌 백버퍼) — P2 보류.
- GL region 12 초과 시 사용자 안내 문구는 split UI 정비 때 함께.
