# 2026-05-12 Phase 1 — closure: 진행 요약, defer 결정, 검증 plan

**Phase / 작업**: Phase 1 마무리
**상태**: done (Phase 1 모든 결정 fix, 검증 plan 확정)
**관련 계획**: [../plan/01-Phase1.md](../plan/01-Phase1.md)

이 entry는 Phase 1 작업 1-7에 대한 최종 진행 요약 + 미진행 작업의
defer 결정 + 다음으로 사용자가 직접 수행해야 하는 검증 plan을 한
곳에 모아둔다. Phase 2 진입 전에 이 entry의 검증 plan을 한 번
훑는 것이 약속.

## 진행 요약

| 작업 | 제목 | 상태 | PR | 비고 |
|---|---|---|---|---|
| 1.1 | Alpha-enforce mask erosion | done | [#2](https://github.com/CocoRoF/geny-avatar/pull/2) | 코드 진입 지점이 계획과 달라 적응 (`postprocessGeneratedBlob` Step 2) |
| 1.2 | Canonical-pose snapshot ride-along | done | [#3](https://github.com/CocoRoF/geny-avatar/pull/3) | `app` prop drilling 한 단계 추가 |
| 1.3 | Canny silhouette를 image[4]에 | **defer** | — | 이 entry의 결정 섹션 참조 |
| 1.4 | fal.ai FLUX.2 [edit] provider | done | [#6](https://github.com/CocoRoF/geny-avatar/pull/6) | SDK 의존 0, raw fetch |
| 1.5 | Provider routing module | done | [#7](https://github.com/CocoRoF/geny-avatar/pull/7) | 모듈만 신설. GeneratePanel 연결은 Phase 3 |
| 1.6 | OpenAI prompt에 Cubism 컨텍스트 | done | [#4](https://github.com/CocoRoF/geny-avatar/pull/4) | style negation도 함께 |
| 1.7 | Multi-call progress UI | **defer (이미 충족)** | — | 이 entry의 결정 섹션 참조 |
| — | docs bootstrap + PR refs backfill | done | [#1](https://github.com/CocoRoF/geny-avatar/pull/1), [#5](https://github.com/CocoRoF/geny-avatar/pull/5) | |

## Defer 결정

### 작업 1.3 — Canny silhouette를 image[4]에 (optional)

**결정**: defer (Phase 1.x bonus로 진행하지 않음).

**사유**:

1. plan/01-Phase1.md 작업 3의 정의 자체가 "optional" + "효과 측정
   후 가치 없으면 제거". 효과 측정 인프라가 아직 없음.
2. image budget 4개 중 한 슬롯이 다음 단계에서 점점 비싸짐:
   image[1] source / image[2] canonical pose (Phase 1.2 적용) /
   image[3] anchor result (Phase 3) / image[4] 사용자 ref 또는
   recent prior. canonical pose가 들어가 있는 상태에서 Canny까지
   끼우면 user 업로드 ref가 들어갈 슬롯이 없다.
3. silhouette 보존은 Phase 1.1 mask erosion + Phase 1.6 prompt의
   "Keep [image 1]'s silhouette" 명시로 대체 가능한 영역.
4. 진짜 의미는 "다른 방법으로 silhouette 안 지켜진다는 증거"가
   나왔을 때 Canny 도입을 고려. 그 시점에 evaluation 인프라
   (Phase 2/3) 와 함께 진행이 깔끔.

**해제 조건**: Phase 3 eval에서 silhouette drift 측정 결과가 ≥10%
인 puppet 케이스가 발견되면 그때 image 슬롯 정책 재검토와 함께
Canny 도입 검토.

### 작업 1.7 — Multi-call progress UI

**결정**: defer (이미 충족, 추가 작업 불요).

**근거**:

코드 탐색 결과 GeneratePanel의 multi-region 흐름은 plan/01-Phase1.md
작업 7이 요구한 항목을 이미 모두 구현하고 있음:

| 작업 7 요구 | 현 상태 | 위치 |
|---|---|---|
| 각 호출의 상태 (queued/running/done/failed) | ✓ `RegionRunState.status` | [GeneratePanel.tsx:147](../../components/GeneratePanel.tsx#L147) |
| per-region tile 진행 표시 | ✓ tile에 ✓/`generating…`/`!` badge | [GeneratePanel.tsx:1601](../../components/GeneratePanel.tsx#L1601) |
| 실패 시 retry | ✓ `regenerateOneRegion` + retry 버튼 | [GeneratePanel.tsx:802](../../components/GeneratePanel.tsx#L802) |
| per-call 시간 측정 / 출력 | (선택) | 미구현 — `RegionRunState`에 timing 필드 추가하면 됨 |
| 별도 `ProgressStack.tsx` 컴포넌트 | (선택) | Phase 3에서 orchestrator UI와 함께 |

Phase 1 ship criteria에 "progress UI" 항목 없음 — 작업 7은 Phase 3
준비 목적. Phase 3 orchestrator UI 만들 때 같이 추출 + 정비.

**해제 조건**: Phase 3 시작 시 첫 작업으로 `ProgressStack.tsx` 추출.
그때 latency 표시도 함께.

## Phase 1 Ship Criteria 검증 plan

[plan/01-Phase1.md](../plan/01-Phase1.md) "Ship criteria — Phase 1
종료 조건" 5개 항목에 대해 어떻게 / 언제 검증할지 정리.

**검증은 코드 작성으로는 끝나지 않는다.** 실제 puppet 편집을 통해
사용자가 직접 측정해야 한다. 이 plan은 사용자 환경에서 수행할
작업 목록.

### Criterion 1 — Atlas 인접 seam 오염 비율 <1%

**무엇을 측정**: AI generate 결과가 atlas page에 composite된 후,
인접 island 영역의 픽셀 값이 변경됐는지.

**검증 절차**:

1. Hiyori 빌트인 모델 로드.
2. 머리 영역의 인접한 두 drawable 선택 (예: `ArtMesh_hair_front_a`
   와 `ArtMesh_hair_front_b`).
3. 첫 drawable 편집: "make this region pure red" prompt → apply.
4. 두 번째 drawable의 atlas 영역에서 첫 drawable의 빨강이 보이는지
   시각 확인 + (가능하면) atlas page export 후 픽셀 diff.
5. 20개 다른 drawable로 반복.
6. seam 오염 발견된 케이스 / 전체 케이스 × 100%.

**기준**: <1% (20개 중 0~1개).

**관측 도구**: brower devtools console에서 `[postprocess]
alpha-enforce: erode radius=Npx (shortSide=Spx)` 로그 — radius가
2~8 사이에서 silhouette 크기에 비례하는지 확인.

**측정 결과 기록**: 이 entry 하단 "측정 결과" 섹션에 entry 추가.

### Criterion 2 — Canonical pose render가 100% OpenAI 호출에 첨부

**무엇을 측정**: 모든 OpenAI generate 호출의 `referenceImages`
배열에 canonical pose blob이 포함됐는지.

**검증 절차**:

1. GeneratePanel 열기.
2. 다양한 케이스에서 generate 시도:
   - single-region (small layer)
   - multi-region (large layer with 5+ components)
   - 사용자 ref 0개 / 1개 / 3개 / 4개
3. 매번 console에서 `[generate] character-ref:` 로그 확인:
   - 0~3 user ref: `attached (...B, slot N)` 표시
   - 4 user ref: `skipped (refs budget=4, supportsRefs=true)` 표시
4. 4 user ref 케이스에서만 skipped, 나머지에선 attached여야 함.

**기준**: 모든 호출에서 정책대로 동작 (4 ref + 1 source = 5 이미지,
gpt-image-2 한도 정확히 일치).

**측정 결과 기록**: 이 entry 하단 "측정 결과" 섹션.

### Criterion 3 — FLUX.2 Edit provider가 picker에서 사용 가능

**무엇을 측정**: FAL_KEY 환경변수 세팅 후 GeneratePanel picker에
"fal.ai FLUX.2" 옵션 노출, 선택 시 실제 호출 동작.

**검증 절차**:

1. fal.ai 계정 생성 + API key 발급 (<https://fal.ai/dashboard/keys>).
2. `.env.local` 파일에 `FAL_KEY=<발급키>` 추가.
3. dev 서버 재시작 (env 반영 위해).
4. GeneratePanel 열기 → provider picker 드롭다운에 "fal.ai FLUX.2"
   가 "Available" 상태로 표시되는지.
5. fal.ai FLUX.2 선택 후 간단 prompt로 generate ("change this to red").
6. console에서 `[falai] POST...` `[falai] queued request_id=...`
   `[falai] completed in Xms` 로그 흐름 확인.
7. 결과 이미지가 정상 반환 + atlas에 정상 composite.

**기준**: 키 세팅만으로 GeneratePanel에서 정상 호출 / 정상 응답.

**측정 결과 기록**: 이 entry 하단 "측정 결과" 섹션. fal.ai 호출
실패 시 응답 본문 / 콘솔 에러 메시지 첨부.

### Criterion 4 — 기존 워크플로 깨지지 않음 (smoke test)

**무엇을 측정**: Phase 1 코드 변경이 기존 사용자 흐름을 회귀시키지
않는지.

**검증 절차**:

빌트인 샘플 + 보유 puppet 8개 정도로 다음 흐름 1회씩:

1. 모델 로드 → 정상 렌더되는지.
2. DecomposeStudio 열기 → mask 편집 → save.
3. GeneratePanel 열기 (OpenAI provider) → 단일 region → generate.
4. multi-region case → generate-all.
5. Apply → atlas 합성 정상.
6. 같은 layer 다시 generate → previous result로 chain 안정.
7. Variants 저장 / 적용.
8. 모델 export → 다른 환경에서 재로드.

**기준**: 8개 모델 × 8개 흐름 = 64 case 모두 회귀 없음.

**측정 결과 기록**: 이 entry 하단 "측정 결과" 섹션. 실패 시 console
trace + 모델명 + 어느 단계.

### Criterion 5 — OpenAI prompt가 v1 템플릿으로 통일

**무엇을 측정**: 모든 OpenAI generate 호출의 prompt가 [#4](https://github.com/CocoRoF/geny-avatar/pull/4)
의 새 구조 (slot map + edit instruction + preservation + style
negation + mask role + negative tail) 를 따르는지.

**검증 절차**:

1. GeneratePanel에서 OpenAI 선택, generate 시도.
2. 콘솔에 노출되는 `composed prompt: ...` 로그를 캡쳐.
3. 다음 섹션이 모두 포함됐는지 확인:
   - `[image 1] is the canvas to edit — it represents one drawable of a multi-part Live2D-style 2D rigged puppet...`
   - `Edit [image 1]: ...`
   - `Keep [image 1]'s silhouette and crop framing...`
   - `Style: anime / illustration. NOT photoreal. NOT 3D. NOT live-action.`
4. ref attached 케이스에선 추가로 ref 섹션 + "마지막 reference,
   when present, may be a full-character snapshot" 문구.

**기준**: 모든 호출에서 새 구조 적용.

**A/B 측정 (선택)**: 동일 source + 동일 user prompt로 PR #4 이전
(`d18c04d^`) vs 이후 결과 비교. 같은 prompt에 outline 충실도 / 색
충실도 / 스타일 일치도가 새 버전에서 더 나은지 사용자 인상 평가.
정량화 어려우면 정성 메모만.

**측정 결과 기록**: 이 entry 하단 "측정 결과" 섹션.

## Phase 2 진입 조건

다음이 모두 만족돼야 Phase 2 ([../plan/02-Phase2.md](../plan/02-Phase2.md))
착수:

- [ ] Criterion 1: seam 비율 측정 완료, <1% 만족.
- [ ] Criterion 2: canonical ref 부착 정책 확인 완료.
- [ ] Criterion 3: FLUX.2 실호출 검증 (사용자 키 발급 후).
- [ ] Criterion 4: smoke test 8 모델 × 8 흐름 회귀 없음.
- [ ] Criterion 5: prompt 구조 확인 (1회 콘솔 캡쳐).

검증 결과가 기준 미달이면:

- seam 비율 ≥1% → erosion radius 정책 재검토 (현재 `shortSide /
  100, clamp [2,8]`). 큰 모델에선 8px이 적을 수 있고, 작은 모델에선
  과침식일 수 있다.
- canonical ref 부착이 의도와 다른 동작 → GeneratePanel onSubmit
  로직 재점검.
- FLUX.2 호출 실패 → 응답 본문에서 API contract 재확인. WebFetch한
  문서가 최신 아닐 수 있음.
- smoke test 회귀 → 회귀 케이스 단위 PR로 hotfix.
- prompt 구조 누락 → [openai.ts:207](../../lib/ai/providers/openai.ts#L207)
  composePrompt 점검.

## 측정 결과 기록

(사용자가 검증 수행 후 아래에 한 줄씩 append. 형식: `- [Criterion N]
YYYY-MM-DD: 측정값 / 관찰 / 통과 여부.`)

> _아직 측정 안 됨._

## 다음 작업

이 entry가 머지된 후, 사용자가 검증 plan을 따라 측정 수행. 측정
결과를 위 "측정 결과 기록" 섹션에 append하는 cleanup PR (또는 직
push)로 갱신. 모든 기준 통과 시 Phase 2 진입.

## 참조

- 손댄 파일 1개: 이 entry 자체.
- PR: 이 entry가 포함된 PR이 머지될 때 main에 들어감.
