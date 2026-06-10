# progress — 작업 로그 (append-only)

docs-upgrade/progress 와 같은 운영 규칙: 작업 단위(≈PR)당 파일 1개,
`YYYY-MM-DD-제목.md`, 사후 수정 금지(정정은 새 entry). 양식:

- **무엇을** — 결함 ID / 계획 문서 참조
- **어떻게** — 핵심 결정과 코드 위치
- **검증** — typecheck/lint + 수동 확인 내용
- **남긴 것** — 알게 된 사실, 다음으로 미룬 것
