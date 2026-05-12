# 2026-05-12 Phase 0 — 폴더 부트스트랩

**Phase / 작업**: Phase 0 (셋업 / 인프라)
**상태**: done
**관련 계획**: [../plan/00-개요.md](../plan/00-개요.md)

## 변경

- `plan/` (geny-avatar 루트) → `docs-upgrade/plan/` 로 이동.
- `docs-upgrade/progress/` 신설.
- `docs-upgrade/plan/06-진행기록.md` 삭제 (역할이 progress/README.md로
  흡수됨).
- `docs-upgrade/plan/00-개요.md` 의 `06-진행기록.md` 참조를
  `../progress/` 참조로 갱신.
- plan 안 파일 6개에서 `../docs-upgrade/...` 경로를 `../...` 로 일괄
  갱신 (sed).
- `docs-upgrade/plan/05-공통기반.md` 의 깨진 링크 `[docs-upgrade](../docs-upgrade)`
  를 `[분석 문서들](..)` 로 수정.
- `docs-upgrade/progress/README.md` 신설 — entry 양식 / 운영 규칙.

## 검증

- `grep -l '\.\./docs-upgrade/' docs-upgrade/plan/*.md` → 없음.
- 폴더 구조:
  ```
  docs-upgrade/
    00-README.md ~ 13-failure-modes-and-eval.md (14개 분석)
    plan/      → 5개 실행 계획 문서
    progress/  → README.md + 이 entry
  ```

## 결정

- 진행 로그는 **파일 한 개에 누적**(이전 안)이 아니라 **작업 단위로
  파일 분리**로 가기로 결정. 이유:
  - 검색 / 비교 / 부분 인용이 쉬움.
  - 동시 PR에서 conflict 없음.
  - 시간 순서가 파일 이름에 박혀 있음 (정렬 자동).
- README.md 안의 인덱스 테이블만 매번 한 줄 append.

## 영향

- 이후 모든 작업은 `docs-upgrade/progress/YYYY-MM-DD-<slug>.md` 형태로
  시작·종료 로그.
- plan 문서들의 외부 링크가 새 경로 기준이므로 GitHub / IDE에서 클릭
  시 정상 동작.

## 참조

- 작업 1 (이 entry): geny-avatar 디렉토리 내 직접 작업, 커밋 미수행
  (사용자 승인 후 커밋 예정).
