# #48 — AI 플랜 오케스트레이터 (스마트 리스타일)

사용자 피드백: 페이지 통짜 리스타일이 실전에서 제대로 동작하지 않음 →
"AI가 판단하여 할 수 있게". [04-전신-리스타일 §4-C](../04-전신-리스타일.md) 참조.

## 무엇을 / 어떻게

- `lib/ai/restyleOrchestrator.ts`: 번호 콘택트 시트 빌더(현재 합성 기준,
  숨김 레이어 제외) + 플랜 요청 + 항목 실행기(per-layer 파이프라인 재사용).
- `app/api/ai/plan-restyle/route.ts`: vision chat (REFINER_MODEL 공유,
  response_format json_object, config.json 키 + .env fallback) → 플랜 JSON.
- RestylePanel 2-모드: **AI 플랜(기본)** — 플랜 생성 → 검토/수정(체크박스 +
  instruction 편집 + styleAnchor 편집) → 동시성 2 실행 → 라이브 반영 →
  "이번 실행 되돌리기"(실행 전 오버라이드 복원) / **페이지 통짜(실험적)**.
- aiJobs 히스토리에 regionSignature "restyle-orchestrator" 로 provenance 기록.

## 검증

typecheck/lint 0 error, build 성공. 실 호출 품질은 사용자 검증 필요 —
플랜 항목 수 상한 14, 항목당 이미지 1콜.
