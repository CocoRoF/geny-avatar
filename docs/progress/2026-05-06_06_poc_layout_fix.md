# 2026-05-06 — PoC Sidebar Layout Fix

## 문제

브라우저 시각 검증 중 발견: `/poc/spine`의 슬롯 52개가 사이드바 자체를 vh 밖으로 밀어내고, **사이드바 전체가 페이지 스크롤**됨. 의도는 "사이드바 = 100vh 고정, 내부 슬롯 리스트만 스크롤".

## 원인

- `<body>`에 `min-h-screen` — 콘텐츠 합산 높이가 vh보다 크면 자라남
- `<main>`에 `h-screen`만 있고 `overflow-hidden` 없음 — grid/flex 자식의 자체 콘텐츠 높이가 부모를 강제로 늘림
- flex 자식의 기본 `min-height: auto`가 `overflow-y-auto` 컨테이너의 높이 제약을 깨뜨림 — 알려진 flexbox gotcha

## 수정

- `globals.css`: `html, body { height: 100% }` + 어두운 톤 스크롤바
- `app/layout.tsx`: body `min-h-screen` → `h-full`
- 모든 PoC 페이지 main: `h-screen` → `h-full overflow-hidden`
- aside / 캔버스 호스트 / 스크롤 ul에 `min-h-0` (flex 자식의 자체 콘텐츠가 부모를 늘리지 못하게)
- 사이드바의 콘텐츠 영역 분리:
  - 상단 패널들 (애니메이션, 메타, 검색·bulk): `shrink-0`
  - 리스트 (`<ul>`): `min-h-0 flex-1 overflow-y-auto`

## 부가 폴리시

같이 들어간 작은 UX 개선:
- 슬롯·part 검색 입력 + 필터 카운트 (`filtered/total`)
- "show all" / "hide all" bulk 토글 (검색 필터 적용된 항목 대상)
- 각 행 spacing 살짝 (`py-1` → `py-1.5`)
- 빈 검색 결과: "no match" 안내
- 다크 스크롤바 — 라이트 OS 기본과 충돌 없게

검색·bulk는 NIKKE visualiser 패턴 ([analysis/08](../analysis/08_competitive_reference.md))의 일부 — Phase 1의 LayersPanel에서도 같은 모양으로 가져갈 예정이라 미리 PoC에 둬도 비용 0.

## 검증

- typecheck: 0 errors
- lint: 0 errors (1 format auto-fix)
- build: 통과
  - `/poc/spine` 2.03 kB / 270 kB First Load
  - `/poc/cubism` 2.4 kB / 219 kB First Load
  - `/poc/dual` 1.49 kB / 270 kB First Load

## 다음

Phase 0 정적 검증 끝. 시각 검증도 spine PoC 정상 (사용자 캡처 확인). 이제 **Phase 1 진입**.

Phase 1 sub-step 1: 어댑터 인터페이스 (`lib/adapters/AvatarAdapter.ts`) + 데이터 모델 타입 (`lib/store/types.ts`) + 두 어댑터 클래스 추출 (PoC 코드의 핵심을 어댑터로 정리, PoC 페이지는 어댑터 사용 예시로 남김).
