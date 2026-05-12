# progress/

geny-avatar 업그레이드 작업의 진행 로그가 누적되는 폴더.

- 분석 본문: 옆 폴더 `..` (docs-upgrade)의 14개 문서.
- 실행 계획: 옆 폴더 [`../plan/`](../plan/)의 5개 문서.
- 이 폴더(`progress/`): **실제로 한 작업의 흔적**을 작업 단위로 남긴다.

## 파일 명명 규칙

```
progress/
  README.md                 ← 이 파일 (가이드 + 인덱스)
  YYYY-MM-DD-<slug>.md      ← 작업 단위 entry
```

- 한 entry = 한 작업 (커밋 1~수 개, PR 1개 정도).
- 날짜는 작업 시작일 기준 (KST).
- `<slug>`는 짧은 영문 / 숫자 / 하이픈. 예: `phase1-1-mask-erosion`.
- 같은 날 여러 entry면 suffix로 구분: `2026-05-12-phase1-1-mask-erosion.md`,
  `2026-05-12-phase1-2-canonical-pose.md`.

## entry 양식

각 파일 안에 다음 항목을 채운다. 길게 쓰지 말고 3–8줄 요약.

```markdown
# <YYYY-MM-DD> Phase<N>.<task#> — <짧은 제목>

**Phase / 작업**: Phase N 작업 #
**상태**: in-progress | done | blocked
**관련 계획**: [plan/0X-PhaseN.md](../plan/0X-PhaseN.md) 작업 #

## 변경
- 손댄 파일 / 주요 변경 사항 (한두 줄씩).

## 검증
- 무엇으로 확인했는지. 측정값이 있으면 숫자.

## 결정
- 도중에 결정한 사항. 계획 문서와 어긋났으면 명시.

## 영향
- 이후 작업 / 다른 Phase에 끼치는 영향.

## 참조
- 커밋 hash / PR 링크 / 외부 자료 등.
```

## 운영 규칙

- **작업 시작 직후** entry 파일을 만든다. 상태 `in-progress`.
- **작업 종료 시** 같은 파일을 갱신. 상태 `done` 또는 `blocked`.
- entry 안에 분석 / 회고를 길게 쓰지 않는다. 회고 / 의사결정 본문은
  필요 시 [`../`](..) 의 분석 문서를 업데이트한다.
- 진행 로그는 **append-only**. 잘못 적어도 다음 entry로 정정한다.
  이전 entry를 사후에 다시 쓰지 않는다.
- blocked 된 작업은 막힌 이유를 entry에 명시하고, 해제 후 새 entry로
  follow-up.

## 인덱스 (최신이 위)

작업이 추가되면 여기 한 줄씩 추가.

| 날짜 | 파일 | Phase | PR | 상태 |
|---|---|---|---|---|
| 2026-05-12 | [2026-05-12-phase1-closure.md](2026-05-12-phase1-closure.md) | 1 (closure) | (이 PR) | done |
| 2026-05-12 | [2026-05-12-phase1-5-router.md](2026-05-12-phase1-5-router.md) | 1.5 | [#7](https://github.com/CocoRoF/geny-avatar/pull/7) | done |
| 2026-05-12 | [2026-05-12-phase1-4-falai-provider.md](2026-05-12-phase1-4-falai-provider.md) | 1.4 | [#6](https://github.com/CocoRoF/geny-avatar/pull/6) | done |
| 2026-05-12 | [2026-05-12-phase1-6-cubism-prompt.md](2026-05-12-phase1-6-cubism-prompt.md) | 1.6 | [#4](https://github.com/CocoRoF/geny-avatar/pull/4) | done |
| 2026-05-12 | [2026-05-12-phase1-2-canonical-pose.md](2026-05-12-phase1-2-canonical-pose.md) | 1.2 | [#3](https://github.com/CocoRoF/geny-avatar/pull/3) | done |
| 2026-05-12 | [2026-05-12-phase1-1-mask-erosion.md](2026-05-12-phase1-1-mask-erosion.md) | 1.1 | [#2](https://github.com/CocoRoF/geny-avatar/pull/2) | done |
| 2026-05-12 | [2026-05-12-bootstrap.md](2026-05-12-bootstrap.md) | 0 (셋업) | [#1](https://github.com/CocoRoF/geny-avatar/pull/1) | done |
