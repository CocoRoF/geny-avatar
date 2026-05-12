# 02 — Phase 2 실행 계획

**목표**: 시맨틱 그룹 추상화를 도입하고, 색만 바꾸는 의도 (전체 의도의
60%+)는 AI 없이 multiplyColor 한 줄로 끝내는 fast-path를 만든다.

**예상 기간**: 4–6주.

**선행 의존**: Phase 1의 canonical pose 렌더 / FLUX.2 provider가 들어와
있어야 깔끔하지만, Phase 1 모든 작업이 다 끝나야만 시작 가능한 건
아니다. **Phase 1 작업 1, 2가 끝나면 시작 가능.**

**분석 출처**:
- [docs-upgrade/03-live2d-anatomy.md](../03-live2d-anatomy.md)
- [docs-upgrade/04-multipart-problem.md](../04-multipart-problem.md) Architecture A (tint)
- [docs-upgrade/08-recommended-architecture.md](../08-recommended-architecture.md)
- [docs-upgrade/11-data-model-evolution.md](../11-data-model-evolution.md)

## 작업 1 — IDB v8 스키마 추가

**왜**: 시맨틱 그룹과 lock 플래그를 어딘가에 영구 저장해야 함. 새
스토어를 추가하는 형태로 (기존 스토어는 안 건드림) v7 → v8 마이그
레이션을 깐다.

**손볼 파일**:
- `lib/persistence/db.ts` (또는 IDB 스키마 정의 파일) — v8 upgrade
  handler 추가.
- `lib/persistence/schema.ts` — 새 스토어 타입 정의.

**새 스토어**:
- `semanticGroups` — `[puppetId, groupId]` 키
- `layerSemantics` — `[puppetId, layerId]` 키
- `editProvenance` — `[puppetId, layerId, generation]` 키
- `canonicalPoseRender` — `[puppetId, version]` 키 (Phase 1 작업 2와
  공유. Phase 1에서 메모리만 썼다면 여기서 IDB 영속화 추가)
- `migrationLog` — `[timestamp]` 키 (실패 기록용)

**구현 메모**:
- 각 스토어의 정확한 필드는 [11-data-model-evolution.md](../11-data-model-evolution.md)
  의 "Target state — IDB v8" 참조.
- 마이그레이션은 일방향. v7에서 v8로 가면 되돌아오지 않음.
- 기존 puppets / puppetAssets / layerOverrides는 절대 안 건드림.

**검증**:
- v7 DB가 있는 사용자가 v8 코드를 열었을 때 자동으로 마이그레이션
  되고, 기존 데이터로 puppet 정상 열림.
- 새 사용자는 v8로 바로 시작.

## 작업 2 — 시맨틱 그룹 분류기

**왜**: 사용자가 모든 drawable을 손으로 그룹에 넣게 하면 80개짜리
puppet 처음 열 때 죽는다. 자동 분류가 기본값이어야 함.

**손볼 파일**:
- `lib/avatar/groupClassifier.ts` (신설) — 메인 분류 함수.
- `lib/avatar/groupRules.ts` (신설) — 규칙 테이블.
- `lib/avatar/groupClassifier.types.ts` — `SemanticGroup` enum, 결과
  타입.

**분류 입력 (우선순위 순)**:
1. **파라미터 바인딩**. 이 drawable이 `ParamHair*`에 의해 변형되면
   거의 머리. `ParamMouth*`면 입. 정규식 매핑 테이블.
2. **부모 deformer 이름**. 일/중/영 패턴 다 잡음. ("髪" / "頭髮" /
   "hair" 등).
3. **drawable 이름**. 마지막 안전망. "ribbon", "ribbon_a", "ribbon_l"
   모두 hair_accessory 후보로.
4. **CLIP 임베딩** (옵션, 무거움). atlas crop을 임베딩하고 fixture set
   ("hair_front", "top_blouse" 등의 대표 패치)과 cosine similarity.
   Phase 2 안에서는 시간 되면 추가, 안 되면 일단 1–3만으로 충분.

**구현 메모**:
- 규칙 우선순위는 정해두되, 모든 규칙이 score를 매겨 합산하는
  방식이 디버깅 쉬움. ex) ParamHair 매치 = +50, parent deformer
  match = +30, name match = +20. threshold = 60 → 분류 확정,
  미만이면 "other".
- `confidence` = (best_score - second_best_score) / best_score.
  0.3 미만이면 UI에서 review modal에 강조.

**검증**:
- 빌트인 5개 puppet에서 사람 손으로 라벨링한 ground truth 작성
  (`eval/groundtruth/{puppet}.json`).
- 분류기 돌려서 F1 측정. primary 그룹 (hair_*, face_*, top, bottom)
  ≥90%, secondary (accessory 등) ≥75% 목표.

## 작업 3 — 분류기 마이그레이션 훅

**왜**: 기존 puppet을 v8 코드로 처음 열 때 분류기가 자동으로 돌고,
결과가 `layerSemantics` 스토어에 들어가야 함.

**손볼 파일**:
- `lib/persistence/migrations/v7_to_v8.ts` (신설).
- puppet load 진입점 (puppet open 시 한 번).

**구현 메모**:
- 마이그레이션은 puppet 단위 lazy. 50개 puppet 가진 사용자 한 명이
  앱 켜자마자 50번 돌리지 않음. 그 puppet을 처음 열 때 1회.
- 마이그레이션 도중 실패해도 부분 결과는 유지 (idempotent).
- `migrationLog` 스토어에 실패 layer만 기록.
- 끝나면 `sessions.shouldShowGroupReviewModal = true` 세팅.

## 작업 4 — Group review modal

**왜**: 분류 결과를 사용자가 검토 / 수정할 수 있어야 함. 자동 분류
에러는 사용자 수정이 가장 빠른 해결책.

**손볼 파일**:
- `components/GroupReviewModal.tsx` (신설).
- LayersPanel 또는 puppet open 직후 mount 지점에서 첫 진입 시 표시.

**UX**:
- 자세한 레이아웃은 [12-ux-flow.md](../12-ux-flow.md) "Flow 2".
- low confidence (⚠) 행은 위로, 확정 행은 아래로.
- "Skip" / "Save & continue" 두 액션.

**검증**:
- Hiyori, Mao Pro 두 puppet에서 modal이 분류기 결과 그대로 표시되는지.
- 드롭다운으로 reassign하면 `layerSemantics` 스토어가 즉시 업데이트
  되는지.

## 작업 5 — LayersPanel Groups 탭

**왜**: 그룹 단위 작업의 UI 진입점. 기존 LayersPanel에 탭만 추가.

**손볼 파일**:
- `components/LayersPanel.tsx` — Tabs 컴포넌트 추가, 기존 layers
  리스트가 "Layers" 탭이 되고 "Groups" 탭이 옆에 생김.
- `components/GroupsList.tsx` (신설).

**구현 메모**:
- 그룹은 클릭하면 expand해서 멤버 drawable이 보이게.
- 각 그룹 행에 `[tint]` / `[lock]` 액션 버튼.
- 그룹 lock 토글 시 `semanticGroups.locked` 갱신.

## 작업 6 — multiplyColor / screenColor adapter API

**왜**: 모든 후속 tint 작업이 이 API를 호출. 어댑터 안에 일급 메서드로
존재해야 함.

**손볼 파일**:
- `lib/avatar/Live2DAdapter.ts` — `setMultiplyColor(partIndex, rgb)`,
  `setScreenColor(partIndex, rgb)` 추가.
- `lib/avatar/SpineAdapter.ts` — 동일 인터페이스. Spine은
  `slot.color.set()`로 동등 구현. ([VERIFY] Spine에서 multiply / screen
  모두 표현 가능한지 — 안 되면 Phase 2 tint는 Live2D 한정으로
  시작하고 Spine은 후속.)
- 어댑터 공통 타입 `AvatarAdapter` 인터페이스에도 추가.

**구현 메모**:
- Cubism SDK: `Live2DCubismCore.CubismModel.drawables.multiplyColors`
  슬라이스 직접 쓰기. ([03](../03-live2d-anatomy.md)
  "multiplyColor" 참조)
- 리셋: `setMultiplyColor(idx, [1,1,1,1])`.

## 작업 7 — Baseline HSV 캐싱

**왜**: tint 수학은 "원본 dominant hue를 target hue로 매핑"하는 방식.
"원본 dominant hue"가 매번 다시 계산되면 안 됨. import 때 한 번
계산해서 캐싱.

**손볼 파일**:
- `lib/avatar/baselineHsv.ts` (신설) — atlas crop의 k-means(n=3)로
  dominant HSV 추출.
- puppet load 흐름 — 분류기와 같이 한 사이클로 돌리면 효율적.

**구현 메모**:
- Worker로 빼는 게 좋음. 80개 drawable 한번에 돌리면 메인 쓰레드 멈춤.
- 결과는 메모리에 `Layer.baselineHsv`. IDB에는 persist 안 함 (재현
  가능하므로).

## 작업 8 — HSV → multiplyColor 수학

**왜**: 사용자가 슬라이더로 HSV를 조정하면, 그게 어떤 multiplyColor
값이 되어야 하는지 결정해야 함. "단순 RGB multiply"로는 검은 음영이
같이 색이 들면서 깨짐.

**손볼 파일**:
- `lib/avatar/tintMath.ts` (신설) — `hsvToTint(target, baseline)` 함수.

**구현 메모**:
- 핵심: multiplyColor만으로는 채도 끌어올리는 게 한계. 밝기를 더해야
  하면 screenColor도 같이 씀.
- 알고리즘 (v0):
  1. target HSV - baseline HSV = delta.
  2. multiply = vec3(1,1,1) * (target.value / baseline.value).
  3. hue 회전은 RGB 공간에서 회전 행렬로 다시 multiply에 합성.
  4. saturation 조정은 grayscale로의 blend로 표현.
- 한 색이 아니라 gradient hair (검정 그라데이션) 케이스는 v0가
  실패할 수 있음. fallback path 필요 (작업 11).

**검증**:
- 단색 머리 (Hiyori 류) 12개 색 회전에서 결과 dominant hue가
  target hue ±15° 안에 들어오는지.
- 빌트인 5개 puppet × 6개 hue = 30개 케이스 자동 테스트.

## 작업 9 — Tint panel UI

**왜**: 위의 수학을 사용자가 만질 surface.

**손볼 파일**:
- `components/TintPanel.tsx` (신설). LayersPanel의 Groups 탭에서
  `[tint]` 클릭 시 열림.
- Hue / Sat / Val 세 슬라이더.
- preview는 실시간 (multiplyColor 값만 바뀌므로 매 frame 무료).
- `[reset]` / `[revert]` / `[commit]` 액션.

**구현 메모**:
- preview / commit 분리가 중요. 슬라이더 만지는 동안엔 multiplyColor만
  세션 메모리에서 갱신, IDB는 안 건드림. commit 누르면 그때
  `editProvenance` + `semanticGroups.lastEditAt`을 씀.
- commit 후의 multiplyColor 값은 어디 저장? → `layerSemantics`나
  `editProvenance`가 아니라 새 store가 필요할 수 있음. 또는
  `semanticGroups`에 그룹 단위 tint 상태 저장. Phase 2 첫 PR에서 결정.

## 작업 10 — Lock 플래그 UI / 강제

**왜**: 사용자가 hand-paint한 drawable을 AI / tint가 덮어쓰지 않게
하는 안전장치.

**손볼 파일**:
- LayersPanel — 레이어 행마다 lock 아이콘 추가.
- TintPanel / 향후 orchestrator — 모든 group-level 작업은 `groupLocked`
  체크 후 skip.
- `lib/avatar/locks.ts` (신설) — lock 체크 유틸 통일.

**검증**:
- lock 체크된 drawable이 tint 적용 시 multiplyColor가 (1,1,1) 그대로
  남는지 (테스트로).

## 작업 11 — Tint fallback path (gradient 케이스)

**왜**: 작업 8의 단순 multiply 수학은 단색 머리엔 통하지만, gradient
머리에선 잘못 매핑된다. fallback이 필요.

**손볼 파일**:
- `lib/avatar/tintFallback.ts` (신설). per-pixel HSV shift를 worker
  에서 수행 → texture override로 출력.

**구현 메모**:
- 진짜 마지막 카드. multiplyColor가 안 되는 케이스를 자동 검출:
  baseline HSV의 saturation 분산이 큰 경우, 또는 multiply 결과의
  dominant hue가 target에서 멀리 떨어진 경우.
- 결과는 `layerTextureOverride`로 들어감 (AI 결과와 같은 슬롯).
  provenance source = "tint" (그래도).

## 작업 12 — Provenance 기록 통합

**왜**: 모든 edit이 이 store에 기록되는 게 글로벌 원칙. Phase 2에서
처음으로 `editProvenance`에 쓰는 코드가 실제로 등장.

**손볼 파일**:
- `lib/persistence/provenance.ts` (신설) — `writeProvenance(...)`
  유틸.
- tint commit, AI commit, paint commit, mask commit 모든 진입점에서
  호출.

**구현 메모**:
- 필드 정의는 [11-data-model-evolution.md](../11-data-model-evolution.md)
  의 "Provenance write shape".
- generation counter는 `[puppetId, layerId]`별 max(generation) + 1.

## 작업 13 — Provenance 배지 UI

**왜**: 사용자가 어떤 drawable이 AI / paint / tint로 손댔는지 한눈에
보이는 게 lock 정책 / 디버깅 / 신뢰의 핵심.

**손볼 파일**:
- LayersPanel — 각 layer 행 옆에 `[AI]` / `[paint]` / `[tint]` 같은
  작은 배지.
- 클릭 시 provenance pane으로 이동 (Phase 3에서 본격 사용).

## Ship criteria — Phase 2 종료 조건

- [ ] 분류기가 50개 골든 모델에서 primary 그룹 F1 ≥0.90.
- [ ] Hiyori / Mao Pro / 외부 3개 모델에서 머리 색 변경이 슬라이더
      한 번 → 10초 안에 완료.
- [ ] Tint commit이 export → re-import 사이클에서 메타데이터 손실
      없이 보존됨.
- [ ] Lock 플래그가 group-level 작업에서 실제로 honoured됨 (테스트
      통과).
- [ ] v7 DB가 자동으로 v8로 마이그레이션되고 기존 데이터 보존됨.

## 위험 / 차단 요소

| 위험 | 대응 |
|---|---|
| Spine 어댑터에서 multiply + screen 모두 표현 불가 | Phase 2 tint는 Live2D 한정. Spine은 추후 PR |
| Tint 수학이 gradient에서 실패 | fallback per-pixel HSV (작업 11)가 안전망 |
| 분류기 정확도가 75% 미만 | review modal로 보완. 분류기 자체는 후속 polish |
| pixi-live2d-display의 multiplyColors slice 접근 불가 | Cubism SDK direct call로 우회 (예제 코드 [03](../03-live2d-anatomy.md) 참조) |
| 마이그레이션 도중 사용자 puppet 깨짐 | one-way migration이지만 puppetAssets는 안 건드리므로 복구 가능. migrationLog로 디버깅 |

## 작업 순서 권장

1. 작업 1 (IDB v8 스키마) — 다른 모든 작업의 기반.
2. 작업 6 (adapter API) — 작업 8 의존성.
3. 작업 2 (분류기) — 작업 4 / 마이그레이션 의존성.
4. 작업 3 (마이그레이션 훅).
5. 작업 7 (baseline HSV).
6. 작업 8 (HSV 수학) + 작업 9 (TintPanel) — 같이 묶어 PR.
7. 작업 5 (LayersPanel Groups 탭).
8. 작업 4 (group review modal).
9. 작업 10 (lock UI / 강제).
10. 작업 12 (provenance write) + 작업 13 (배지) — 같이 묶어 PR.
11. 작업 11 (tint fallback) — 시간 남으면.

## 다음 단계로 가기 전 점검

Phase 2 종료 시:

- 분류기 F1 측정값 기록.
- 시간 측정: import → review modal 완료까지 사용자가 손댄 시간.
- Tint 수학이 fallback 없이 처리한 비율 (gradient 모델 비율).
- Phase 3 인텐트 parser에 넘길 그룹 enum 최종 형태가 확정됐는지.
