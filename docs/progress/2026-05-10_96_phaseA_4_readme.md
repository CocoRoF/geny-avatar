# 2026-05-10 — Phase A.4: README "Geny 통합" 섹션

[Geny 의 GENY_AVATAR_INTEGRATION plan](https://github.com/CocoRoF/Geny/blob/main/docs/plan/GENY_AVATAR_INTEGRATION.md) 의 Phase A 네 번째. A.1~A.3 의 결과물 (Dockerfile · basePath · send-to-Geny) 을 사용자가 한 번에 이해할 수 있도록 README 에 한 섹션으로 통합.

## 변경 surface

### `README.md`

- "현재 상태" 섹션 갱신 — Phase 7 완료 + root UX 통합 완료 + 다음 작업이 Geny 통합임을 명시.
- "Geny 통합 (선택)" 섹션 신규 — A.1~A.3 의 결과를 사용자 시점에서 한 자리에:
  - 3개 환경 변수 (`NEXT_PUBLIC_BASE_PATH`, `NEXT_PUBLIC_GENY_HOST`, `GENY_BAKED_EXPORTS_DIR`) 표 + 단독 사용 시 동작.
  - 단독 / Geny 모드 / Docker 세 가지 빌드 명령어 예시.
  - Geny 측 plan 문서로 외부 링크.

## 의도적 한계

- **A.5 (tag) 는 별도 sprint**: README 까지만 본 sprint. 실제 git tag (`v0.2.0` 등) 는 A.5 에서 push.
- **별도 INTEGRATION.md X**: Geny 측에 이미 강력한 plan 문서가 있고, 이쪽은 사용자 시점 요약 + 외부 링크면 충분. 두 곳 동기화 부담 회피.
- **Docker 명령어 단순화**: 실제 Geny compose 셋업은 multi-stage volume / nginx / shared exports 가 다 얽혀서 복잡 — 본 README 는 docker build 한 줄만 보여주고 자세한 건 Geny plan 으로 위임.

## 검증

- typecheck 통과
- `pnpm build` 통과 (코드 변경 없음 — 문서만)
- 마크다운 표 / 링크 / 코드 블록 syntax 확인

## 다음 — Phase A.5

geny-avatar 에 git tag 부여 (예: `v0.2.0` — Geny submodule 의 pin target). A.1~A.4 의 작업이 모두 한 commit 위에 안정적으로 모인 시점에 tag → push.
