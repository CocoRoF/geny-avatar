# #44 — 전신 레퍼런스 리스타일 파이프라인 (G3)

계획: [04-전신-리스타일.md](../04-전신-리스타일.md) §4-B
(로드맵 번호상 #47 이었으나 기반공사 #42-43 직후가 자연스러워 앞당김.
Paint 강화 #44-46 원안은 #45+ 로 밀림 — 05-실행-로드맵 갱신 필요.)

## 무엇을

"레퍼런스를 주면 캐릭터 전체 텍스처를 한 번에, 일관되게" — 헤더의 Restyle
버튼 → 페이지별 소스/결과 미리보기 → 적용. 페이지 오버라이드로 착지하므로
Layers 패널에서 페이지별 revert 가능, per-layer 오버라이드와 공존.

## 어떻게

- `lib/ai/restyle.ts`:
  - `bakeRestyleSources` — bakeAtlasPages 재사용으로 현재 합성 페이지 추출
    (페이지 오버라이드 인식 → 반복 리스타일 가능).
  - `prepareRestyleFrame` — 1024² 투명 프레임에 fit (offset 기억).
  - `postprocessRestyledPage` — 결과를 frame offset 으로 크롭 → 페이지 치수
    업스케일 → **소스 페이지 알파 하드 강제** (실루엣 불변 = UV 안전).
  - `composeRestylePrompt` — atlas-sprite-sheet 명시 scaffold (FLUX 실패
    모드 회피 노하우 이식), 스냅샷/refs/이전 페이지 슬롯 매핑.
- `components/RestylePanel.tsx`:
  - 열 때 페이지 베이크 → 소스 그리드. prompt + negative 입력.
  - 페이지 순차 제출 (OpenAI gpt-image) — refs(ReferencesPanel) + 전신 스냅샷
    동승, **페이지 N 결과가 N+1 의 스타일 앵커로 체이닝**.
  - 페이지별 부분 실패 허용, AbortController 취소(서버 취소까지 전파, #40
    인프라 재사용), 페이지별 apply / 일괄 apply & close.
- edit 페이지 헤더에 Restyle 버튼 (dynamic import).

## 검증

`pnpm typecheck` / `pnpm lint` 0 error. 실 AI 호출 검증은 사용자 키 필요 —
스모크 절차: Restyle 열기 → 베이크 미리보기 확인 → 프롬프트 입력 → 생성 →
결과 미리보기 → apply → 라이브 반영 → Layers 패널 revert.

## 남긴 것

- builtin 에디터 페이지에는 버튼 미장착 (IDB 영속과 refs 가 builtin 키로도
  동작하므로 장착은 쉬움 — 추후).
- 페이지 1024 다운스케일로 인한 디테일 손실은 1차 수용 (04 문서의 타일 분할
  고해상 경로는 후속).
- blend 슬라이더(부분 복구)는 후속 — 현재는 페이지 단위 apply/revert.
