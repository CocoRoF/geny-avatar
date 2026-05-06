# 2026-05-06 — Sprint 1.3d: origin notes + Phase 1.3 close

Phase 1.3 마지막 sub-sprint. 자산 출처 메모 + 자산 다양성 회귀 가이드 + Phase 1.3 종합 마무리.

## 스코프

- **Origin 메모**: `/poc/upload`에 적당한 위치(헤더의 `saved` chip 클릭 또는 우측 패널 상단)에서 출처 라벨 입력 가능. 입력하면 `updatePuppet(id, { origin })`로 IndexedDB 갱신. `/poc/library` 카드에 출처 chip 표시.
- **자산 다양성 회귀 가이드**: `docs/analysis/` 또는 `docs/plan/`에 짧은 체크리스트 (어떤 모델을 어디서 받아 검증할지). 사용자가 자산 손에 들어왔을 때 그대로 따라가서 80% 통과 확인.
- **Phase 1.3 종합 progress** (이 파일이 그 역할).
- 홈 페이지의 Phase 0 PoC 카드 영역을 정리 — V1 시연에 가까워졌으니 핵심 흐름(`/poc/upload`, `/poc/library`)을 부각.

## 결정

### Origin 메모 UI — 미니멀

`AssetOriginNote`는 `source: 'live2d-official' | 'spine-official' | 'inochi2d-official' | 'community' | 'self-made' | 'unknown'` + 옵션 `url`/`notes`. PoC 단계라 입력 폼 깊게 만들지 않고:
- 라이브러리 카드에 inline edit (source dropdown + url textbox)
- 또는 카드 클릭 시 옆 슬라이드 패널

가장 단순: **카드 위에 inline source select 1개**. url/notes는 V2 또는 본격 LayersPanel sprint(1.4)에서. 정보의 가장 큰 가치는 source 분류라 그것만 일단.

### 회귀 가이드는 docs로

V1 acceptance 기준 (인터넷 자산 5종 80% 통과)을 사용자가 직접 검증할 때 어떤 자산을 어디서 받을지 — 일종의 "테스트 시드 가이드". `docs/analysis/10_test_assets.md` 새 파일. shiralive2d, dotgg.gg/nikke, Esoteric examples 등의 출처를 표 형태로.

## 진행 노트

### 19:10 — Library 페이지 origin select

각 카드 하단에 source dropdown (6 옵션: unknown / live2d-official / spine-official / inochi2d-official / community / self-made). 변경 시 `updatePuppet(id, { origin: { source } })` 즉시 IndexedDB 업데이트 후 refresh.

select의 `onClick`은 `stopPropagation`으로 카드의 navigation `<a>`가 트리거되지 않게.

### 19:20 — `docs/analysis/10_test_assets.md`

V1 acceptance(5종 80%) 검증용 시드 가이드:
- 목표 매트릭스 (Spine 4.0/4.1/4.2 × 2, Cubism 4/5 × 3)
- 출처 후보 (Esoteric examples, Live2D 공식, nizima, shiralive2d, CubismWebSamples)
- 7단계 검증 절차 (떠짐 / animations / toggle / library reload / origin)
- 흔한 실패 패턴 + 디버깅 가이드

`docs/analysis/INDEX.md`에 항목 10 추가.

### 19:30 — 검증

typecheck/lint/build 통과.

## 산출물

| 파일 | 역할 |
|---|---|
| `app/poc/library/page.tsx` | origin select dropdown + onOriginChange |
| `docs/analysis/10_test_assets.md` | V1 자산 다양성 회귀 가이드 |
| `docs/analysis/INDEX.md` | 항목 10 |

## Phase 1.3 종합 — 4 sub-sprint 합산

| sprint | 커밋 | 핵심 산출 |
|---|---|---|
| 1.3 kickoff | `1393db1` | sub-sprint 분할 + 학습 정리 |
| 1.3a | `be660a4` | fflate · parseBundle · /poc/upload-debug |
| 1.3b | `3394a55` | manifest/atlas blob rewrite · UploadDropzone · /poc/upload |
| 1.3c | `fe167a9` | Dexie persistence · savePuppet/loadPuppet · /poc/library |
| 1.3d | (이번) | origin select · test assets 가이드 |

### Phase 1.3 완료 조건 ([plan/07](../plan/07_phased_roadmap.md))

- [x] 드래그-드롭 업로드 (ZIP + 폴더)
- [x] 포맷 자동 감지 + 어댑터 라우팅
- [x] IndexedDB 영구 저장 + 자산 라이브러리
- [x] 업로드 자산이 어댑터를 통해 정상 동작
- [x] 자산 출처 메모(선택)
- [ ] 인터넷 무작위 자산 5종 80% 통과 — 사용자 자산 들어왔을 때 검증

### V1 시나리오 ([plan/01](../plan/01_north_star.md))

- 시나리오 A (Live2D 업로드) — drop → 미리보기 + part 토글 ✓
- 시나리오 B (Spine 업로드) — drop → 미리보기 + slot 토글 ✓
- 시나리오 C (포맷 전환) — library에서 다른 자산 선택 ✓

V1 "올리고 보고 토글까지" 단계 완료.

## 다음 — Phase 1.4

Phase 1 남은 항목:
- Zustand store + Immer (편집 상태의 single source of truth)
- 본 LayersPanel / ToolsPanel 컴포넌트
- Undo/Redo
- 내장 샘플 그리드

Phase 1.4 kickoff progress에서 sub-sprint 분할.
