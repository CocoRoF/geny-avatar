# 08 — Competitive Reference: NIKKE-DB Visualiser 분해

레퍼런스 [nikke-db.pages.dev/visualiser](https://nikke-db.pages.dev/visualiser)의 UI/UX와 내부 구현을 정리. 어디까지 따라가고 어디서 우리 길을 가는지.

## 화면 구성 (사용자 캡처 기준)

### 메인 뷰

- **좌측**: 캐릭터 검색 + 이름 리스트(체스트샷 + 이름). 무한 스크롤.
- **중앙**: 큰 라이브 미리보기. 배경 단색 그라디언트.
- **우측 도구 패널**:
  - 라디오 그룹: Aim / Cover / Full Body / Yap mode (애니메이션 상태 전환)
  - 체크: HQ Assets, Learn More
  - 버튼: Reset (z), Hide UI, Background Color
- **레이어 에디터** (별도 화면):
  - 우측에 attachment list — 각 행: small swatch, eye icon (visibility), checkbox, name (cap_1, gun, r_hair_9, ...)
  - 검색창 ("Search for an attachment name")
  - "Select results" / "Deselect results" 버튼 (검색 결과 일괄 처리)
  - **RGBA 슬라이더 4개** (0~255) — 선택된 attachment(들)에 색조 적용
  - "Apply modifications to selected layers" 버튼
  - "Fix broken animation" 버튼 (Spine deform 충돌 보정?)
  - "Export Layers" / "Import Layers" 버튼 (레이어 상태 저장/복원)

### 핵심 인터랙션

- 좌측에서 캐릭터 클릭 → 중앙 모델 교체.
- 우측 모드 라디오로 애니메이션 상태 전환.
- 레이어 에디터 진입 → attachment 토글로 옷/무기/모자를 끄거나 색을 바꿔서 다양한 fan-art 변종을 만든다.

## 추정 내부 구현

[`Nikke-db/spine-web-player-template`](https://github.com/Nikke-db/spine-web-player-template)와 [`Nikke-db.github.io`](https://github.com/Nikke-db/Nikke-db.github.io)에서:

- **프레임워크 없음**. 86.7% vanilla JS. 빌드 도구는 `package.json`에 있지만 SPA 프레임워크 미사용.
- **렌더러**: Esoteric Software의 `spine-player.js` (공식 임베디드 플레이어). 이 플레이어가 자체적으로 canvas + 컨트롤 + 애니메이션 셀렉터를 제공.
- **데이터 형식**: 각 캐릭터 디렉터리 — `*.atlas`, `*.png` (atlas pages), `*.skel` 또는 `*.json`. `animation_list.json`이 캐릭터별 메타데이터.
- **레이어 에디터**: Spine 런타임의 Skeleton API 위에 직접 UI 구현. `skeleton.findSlot(name)`, `slot.color.set(...)`, `slot.attachment = null` 같은 호출로 토글/색 변경.
- **Export Layers**: 현재 visibility/color 상태를 JSON으로 직렬화. **모델 자체를 변경하지 않음** — 상태 오버라이드만.
- **Spine 4.0/4.1만 지원**. 4.2+(physics)는 미지원.

## NIKKE visualiser가 잘하는 것

1. **즉시성**: 클릭 한 번에 캐릭터 교체, 렉 없음.
2. **레이어 검색**: attachment가 수백 개라도 검색으로 필터링 + bulk select.
3. **상태 export/import**: "이 모자만 끄고 옷 색만 빨강" 같은 변형을 JSON으로 공유.
4. **단순함**: 도구가 하는 일이 명확 — "보여주고 토글하고 색 입힌다." 그 이상은 안 한다.

## 우리가 빌려올 것

- **3-패널 레이아웃** (좌측 리스트 / 중앙 라이브 / 우측 도구·레이어).
- **레이어 검색 + bulk select**. 자산이 커지면 필수.
- **상태 직렬화** (visibility/color/생성된 텍스처 변형을 JSON으로 export).
- **vanilla 첫 인상**: 첫 페인트가 무거우면 안 된다. Pixi v8 + 우리 모델 1종이 첫 화면에 1초 안에 떠야 한다.

## 우리가 안 빌려올 것 (의도적으로 다른 선택)

- **vanilla JS**: NIKKE는 SPA 프레임워크가 없어서 좋은 단순성을 가졌지만, 우리는 **AI 워크플로 + 라이브러리 관리 + 사용자 자산 업로드 + 라이선스 메타데이터 처리**가 필요하다. Next.js + React가 적합.
- **NIKKE 자산 의존**: 우리는 NIKKE 게임의 저작권 자산을 데모/내장 자료로 쓰지 않는다 ([07 Sample Sources](07_sample_sources.md) 참조).
- **Spine 4.0/4.1 한정**: 우리는 Spine 4.2+ (physics)와 Live2D를 동시 지원이 목표.
- **단순 색조 토글**: 우리의 슬라이더는 NIKKE처럼 단순 RGBA 그 이상으로 — **AI 기반 텍스처 재생성**이 같은 패널에 자연스럽게 들어가야 한다.

## 페이지 비교 — 한 표

| 기능 | NIKKE-DB visualiser | geny-avatar (목표) |
|---|---|---|
| 좌측 캐릭터 리스트 | ✓ (NIKKE 캐릭터 풀) | ✓ (사용자/내장 자산 풀) |
| 중앙 라이브 프리뷰 | ✓ (Spine 4.0/4.1) | ✓ (Spine 4.2+ + Live2D) |
| 레이어 visibility/color 토글 | ✓ | ✓ |
| 레이어 검색·bulk select | ✓ | ✓ |
| 상태 export/import | ✓ (state JSON) | ✓ (state + AI-generated texture set) |
| **AI 텍스처 재생성** | ✗ | **✓ (핵심)** |
| **Atlas 분해 도구** | ✗ | **✓** |
| **사용자 자산 업로드** | ✗ (큐레이션됨) | ✓ |
| **라이선스 메타데이터 추적** | ✗ | ✓ |
| 페이스 트래킹 / VTubing | ✗ | ✗ (스코프 외) |
| 음성/립싱크 | "Yap mode"라는 라벨만 | ✗ (스코프 외) |

## 직접 inspection 필요한 것

이 문서를 더 정확하게 만들려면 다음을 직접 보면 좋다:

- [ ] 실제 visualiser의 DevTools에서 사용된 라이브러리·번들 사이즈 측정
- [ ] `spine-web-player-template`의 `change_current_animation.js` 코드 읽고 attachment 토글 패턴 확인
- [ ] `animation_list.json` 스키마 확인 — 우리 자산 메타와의 차이
- [ ] "Fix broken animation" 버튼이 정확히 무엇을 하는지 (Spine 4.0→4.1 마이그레이션 시 알려진 deform 이슈일 가능성)

이건 [09 Open Questions](09_open_questions.md)로 이어진다.
