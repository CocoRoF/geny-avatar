# 06 — UI / UX

화면이 어떻게 생기고 어떤 흐름으로 움직이는가. 비주얼 레퍼런스는 [analysis/08](../analysis/08_competitive_reference.md)의 NIKKE visualiser, 단 우리 도구는 편집기.

## 스크린 — 두 개

1. **Landing (`/`)**: 내장 샘플 그리드 + 사용자 puppet 업로드.
2. **Editor (`/edit/[avatarId]`)**: 메인. 3-패널 레이아웃.

V1은 이 두 스크린만. 그 외는 모달.

## Editor 레이아웃 — 3-패널 (NIKKE 스타일)

```
┌────────────────┬─────────────────────────────────┬────────────────────────┐
│                │                                  │ Tools                  │
│  Asset Library │                                  │  ○ Idle / Wave / ...   │
│  (좌측)         │                                  │  ☐ HQ Assets           │
│  - 검색         │        Live Preview              │  [Reset]               │
│  - 캐릭터 썸네일│        (Pixi canvas)             │  [Hide UI]             │
│  - 업로드 +     │                                  │  [Background]          │
│                │                                  ├────────────────────────┤
│                │                                  │ Layers                 │
│                │                                  │  - 검색                 │
│                │                                  │  [Select] [Deselect]   │
│                │                                  │  ▢ 👁 cap_1            │
│                │                                  │  ▢ 👁 cap_2            │
│                │                                  │  ▣ 👁 gun              │
│                │                                  │  ...                   │
│                │                                  │  [R] [G] [B] [A]       │
│                │                                  │  [Apply]               │
├────────────────┴─────────────────────────────────┤ [Generate] [Decompose] │
│ Status bar: license · 변경 횟수 · undo/redo · save│ [Export] [Import]      │
└──────────────────────────────────────────────────┴────────────────────────┘
```

좌측 너비: 280px / 우측 너비: 360px / 가운데: 가변 (>= 600px). 1280px 미만에서는 좌측 collapse → 햄버거.

## 패널 내 상호작용

### Asset Library (좌측)

- 상단: 검색창 (이름·태그).
- **드래그-드롭 영역** — 좌측 패널 전체가 드롭존. ZIP 또는 폴더(File System Access API) 모두 받음. day-1 핵심 흐름.
- 그리드:
  - 내장 샘플 (Live2D 공식 1종 + Spine 공식 1종 + 자체 제작 1종) — 클릭 즉시 로드.
  - 사용자 업로드 자산 — IndexedDB에 저장된 puppet들. 64×64 thumbnail (첫 미리보기 자동 캡처) + 이름 + 포맷 뱃지(`Spine 4.1` / `Cubism 5`).
- 하단: "+ Upload puppet" 버튼 (드래그-드롭의 fallback. 클릭 시 파일 다이얼로그).
- 지원 포맷:
  - Spine: `.skel + .atlas + 페이지 PNG`, 또는 `.json + .atlas + 페이지 PNG`. ZIP 또는 폴더. 버전 3.8 / 4.0 / 4.1 / 4.2.
  - Cubism: `.model3.json + .moc3 + 텍스처 + (.physics3.json) + (.cdi3.json) + (.motion3.json들)`. ZIP 또는 폴더. 버전 4 / 5 (2 / 3은 best-effort).
- 클릭 시 즉시 전환 — 단, 변경사항이 있으면 확인 모달 ("저장하지 않은 변경이 있습니다").

**업로드 진행 표시**:
- 드롭 → 압축 해제 → 포맷 감지 → 어댑터 로딩 → 첫 페인트의 4단계를 하단에 progress bar.
- 감지 실패 시 모달: "포맷을 자동 감지할 수 없습니다. 어떤 포맷인가요?" + Spine / Cubism 선택 + 어떤 파일이 진입점인지 사용자가 지정.
- 로딩 실패 시 명확한 오류 메시지 — 예: "Spine 3.8 형식인데 우리 런타임은 4.0+만 받습니다. Spine Editor에서 4.0+로 마이그레이션하세요."

### Live Preview (중앙)

- Pixi 캔버스 단일.
- 마우스 휠: zoom (0.25x~4x).
- 드래그: pan.
- 더블클릭: zoom reset.
- 좌하단 미니바: "Idle ▾" (애니메이션 셀렉터), 재생/정지 토글, 속도 슬라이더 (0.25x~2x).
- "Hide UI" 클릭 시 모든 사이드패널 숨김 → 미리보기 풀스크린 (스크린샷 모드).

### Tools (우측 상단)

NIKKE 그대로:
- 라디오: 애니메이션 모드 (idle/wave/aim/...). 모델별로 동적 — Spine track, Live2D motion group.
- ☐ HQ Assets — V1에서는 placeholder. (Spine 4.2+ physics 토글 등 후속에서 의미 부여)
- [Reset (z)]: 모든 working overrides 제거 → defaults로.
- [Hide UI]: 사이드패널 토글.
- [Background Color]: 캔버스 배경 색 변경.

### Layers (우측 메인)

- 검색창 (이름 부분일치).
- Bulk: [Select results] / [Deselect results].
- 리스트 — 각 행:
  - 32px 썸네일 (region 잘라낸 PNG)
  - 👁 visibility 토글
  - ☐ 선택 체크
  - 이름 (긴 경우 ...)
  - 우측 드래그 핸들? — V1에서는 drawOrder 변경 안 함, 핸들 없음.
- 행 클릭 = 선택. Shift/Ctrl 다중 선택.
- 선택된 layer가 1개+ 일 때 하단 슬라이더 활성:
  - R / G / B / A (0~255)
  - [Apply modifications to selected layers]
- 선택된 layer가 1개일 때 하단에 **[Generate Texture] [Decompose Region]** 버튼.

### Generate (모달 또는 우측 슬라이드 패널)

레이어 1개 선택 + Generate 클릭 시:

```
┌────────────────────────────────────────┐
│ Generate Texture — layer "outfit_top"  │
│                                         │
│  ┌──────────────┐                       │
│  │ current.png  │  [Replace] [Variant]  │
│  └──────────────┘                       │
│                                         │
│  Prompt:                                │
│  ┌──────────────────────────────────┐  │
│  │ white tank top with red ribbon    │  │
│  └──────────────────────────────────┘  │
│  Negative:                              │
│  ┌──────────────────────────────────┐  │
│  │ (default 자동)                    │  │
│  └──────────────────────────────────┘  │
│                                         │
│  ▾ Advanced                             │
│    Seed: [random]                       │
│    Reference image: [drop]              │
│    LoRA overrides: ...                  │
│                                         │
│  [Cancel]              [Generate ▶]    │
└────────────────────────────────────────┘
```

- "Replace": 결과를 working override로 즉시 적용.
- "Variant": 결과를 별도 Variant에 추가 (현재 layer만의 alternate).
- 진행 중 토스트로 jobId 표시. 완료 시 자동 적용 + "↶ Revert" 버튼 5초 노출.

### Decompose (전용 화면 또는 큰 모달)

- 입력: 선택된 layer 1개.
- 좌측: region 원본 PNG 큰 화면.
- 우측: 마스크 도구
  - [Auto (SAM)] — 자동 마스크 후보 N개 제안. 클릭으로 선택.
  - 브러시 / 지우개 / 라쏘.
  - opacity 50% 마스크 오버레이.
- 하단: [Cancel] / [Save mask] / [Save & Generate].

V1에서는 결과 마스크가 "이 layer의 alpha override"로 저장됨. 어댑터가 그리기 전에 alpha를 곱.

## 상태 bar (하단)

- 좌: Origin chip — 자산 출처 짧은 라벨 ("Live2D Sample" / "Self-uploaded" / "Inochi2D Sample"). 클릭 시 출처 메모 + URL 표시. **차단·동의 모달 없음** ([analysis/07](../analysis/07_sample_sources.md)의 hobby 정책).
- 중: 변경 사항 수 ("3 layers modified · 1 new texture").
- 우: [↶] [↷] 버튼 + [Save (auto)] 표시.

## 저장 / Export / Import

- **자동 저장**: 모든 변경이 IndexedDB로 즉시. 수동 저장 버튼은 없음.
- **Export**: 메뉴에서 — `*.geny-avatar.zip` 파일 다운로드 ([04 데이터 모델 구조](04_data_model.md) 참조).
- **Import**: 같은 ZIP을 받아 동일 상태로 복원. Asset Library에 추가됨.

## Undo / Redo

- 단축키: Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z.
- 단위 — 의미적 액션 1개:
  - layer visibility 토글
  - color 적용
  - texture override 추가/제거
  - variant 활성화 변경
- AI 생성 자체는 undo-able이지만 비용 발생을 피하기 위해 redo 시 캐시(IndexedDB)에서 재사용.

## 빈 상태 / 오류 / 학습

- **첫 진입**: Editor 우측에 "1) layer를 선택하세요. 2) Generate를 누르세요." 같은 짧은 hint 카드. 사용자가 한 번 액션하면 사라짐.
- **AI 실패**: 토스트 + "Retry" 버튼. 비용 발생 안 함.
- **Export 시**: 자산 출처가 ZIP의 `LICENSE.md`에 자동 기록됨. 차단·동의 흐름 없음.

## 디자인 — 톤

- **다크 모드 default**, NIKKE 톤 (검정 배경 + 청록색 강조).
- **dense layout**, 카드 chrome 최소. 테이블처럼 정보 밀도 우선.
- 데코 이모지·뱃지 없음. 정보 위계는 글자 크기·굵기로.
- 폰트: Inter (UI), Pretendard (한글).

## 키보드

| 키 | 동작 |
|---|---|
| `z` | Reset all overrides |
| `space` | Play / pause animation |
| `1`~`9` | 첫 9개 layer 토글 (선택 후) |
| `Cmd/Ctrl+Z` / `+Shift+Z` | undo/redo |
| `g` | Generate (선택된 layer로) |
| `d` | Decompose |
| `e` | Export |
| `?` | 단축키 모달 |

## 모바일 / 작은 화면

V1에서는 명시적으로 비대상. ≤1024px 폭에서 "데스크톱에서 열어주세요" 안내 페이지. (V2+에서 반응형)

## 예외적 흐름

- 사용자 puppet 업로드 시 포맷 자동 감지 실패 → "Spine / Live2D / 기타" 선택 모달.
- 같은 캐릭터를 다시 업로드 → "기존 작업 위에 적용" vs "새로 시작" 선택.
- AI 생성 결과를 사용자가 4번 연속 거절 → "다른 base model을 시도해보시겠어요?" 안내.
