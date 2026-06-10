# #36 — 수명주기/데이터 위생 일괄 수정

결함: R6 R7 R8 R10 D1 D2 D3 D4 D5 D6 ([02-결함목록](../02-결함목록.md))

## 무엇을 / 어떻게

- **R6**: hydrate 실패 시에도 `hydratedKeyRef` 를 설정 — 실패가 세션 전체의
  저장을 무언 중단시키던 것을, 현재 스토어 상태 기준 스냅샷으로 복구.
- **R7**: `usePuppet` 에 run-once `destroyApp` + 항상 호출 가능한
  `destroyAdapter` 도입. Pixi Application 이중 destroy throw 제거. adapter
  destroy 는 의도적으로 양쪽(cleanup + cancelled 분기)에서 호출 — load 도중
  unmount 시 늦게 생성된 모델을 두 번째 호출이 해제 (adapter destroy 는 멱등).
- **R8**: Spine 은 load 시 등록한 Assets alias 2개, Live2D 는 preload 한
  texture URL 들을 destroy 에서 `Assets.unload` — puppet 열고 닫을 때마다
  GPU 텍스처/비트맵이 글로벌 캐시에 누적되던 누수 차단.
- **R10**: `computeBaseFactor` 를 `measureBaseSize`(마운트 1회) +
  `fitBaseFactor`(스크린 의존)로 분리, host 에 ResizeObserver — 리사이즈 시
  fit 재계산 + 재중심. 마운트 시점 크기를 ref 로 고정해 "스케일 적용된
  display.width 재측정 → 피드백 루프" 함정 회피. 유저 zoom/pan 보존.
- **D1**: `deletePuppet` 이 10개 테이블 전부를 한 트랜잭션으로 캐스케이드 삭제.
- **D2**: `saveAIJob` 에 per-(puppet,layer) 캡 20 + 초과분 prune. db 첫 접근 시
  `navigator.storage.persist()` 요청 (Safari eviction 대비).
- **D3**: 홈 업로드에서 `tryRestoreGenyAvatarZip` throw 를 잡아 일반 번들
  파서로 fall-through. avatar.json 이 우연히 든 외부 zip 이 업로드를 brick
  하던 문제 해소. 둘 다 실패 시 두 사유 병기.
- **D4**: `updatePuppetThumbnail` 신설 (updatedAt bump 없음, publish 트리거
  없음) — 에디터 열기만 해도 re-bake/re-POST 하던 churn 루프 차단.
- **D5**: `_triggerSyncPush` 가 `builtin:` 키를 조기 skip — doomed publish 제거.
- **D6**: `onOriginChange` 가 기존 origin 의 url/notes 를 머지 보존.

## 검증

`pnpm typecheck` / `pnpm lint` 통과 (warning 17 기존 동일).

## 남긴 것

- D2 의 히스토리 캡은 20 하드코딩 — 설정화는 필요해질 때.
- 라이브러리 catch-up 의 localStorage 북킹(D11)은 P2 로 보류.
