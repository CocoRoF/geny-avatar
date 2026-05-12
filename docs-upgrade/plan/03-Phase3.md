# 03 — Phase 3 실행 계획

**목표**: "한 줄 적으면 알아서 편집되는" 헤드라인 UX를 완성한다. 인텐트
파서가 자연어를 구조화된 의도로 변환하고, 그게 tint path 또는 AI
오케스트레이터로 분기된다. 비-tint 그룹 편집은 순차 reference chaining
으로 처리.

**예상 기간**: 6–9주.

**선행 의존**: Phase 2 종료. 시맨틱 그룹과 tint path가 동작해야 함.

**분석 출처**:
- [docs-upgrade/04-multipart-problem.md](../04-multipart-problem.md) Architecture B
- [docs-upgrade/08-recommended-architecture.md](../08-recommended-architecture.md) "Generate orchestrator"
- [docs-upgrade/10-prompt-engineering.md](../10-prompt-engineering.md)
- [docs-upgrade/12-ux-flow.md](../12-ux-flow.md) Flow 3

## 작업 1 — 인텐트 parser

**왜**: 자연어 → 구조화 의도가 모든 새 UX의 진입점. 잘못 분류하면
이후 모든 단계가 오작동.

**손볼 파일**:
- `lib/ai/intent/parser.ts` (신설) — main entry.
- `lib/ai/intent/schema.ts` — Zod schema for `IntentRequest`.
- `lib/ai/prompts/intent_parser.v1.txt` — 시스템 프롬프트.

**구현 메모**:
- 모델: gpt-4o-mini 또는 gemini-flash 정도. 비싸지 않게.
- structured outputs / JSON mode 강제. 우리가 만든 schema에 맞춰서만
  응답.
- 응답에 confidence < 0.6면 UI에서 plan stage에 강조.
- 시스템 프롬프트와 schema 세부는 [10](../10-prompt-engineering.md)
  "Intent parser — system prompt".

**검증**:
- 50개 prompt eval set (`eval/intent/golden.json`) 작성.
  - 20개 tint, 15개 ai-multipart, 10개 ai-region, 5개 compound.
- 각 prompt에 expected intent + targetGroups 라벨.
- 파서 통과 = intent 일치 AND targetGroups 중 하나 이상 매치.
- 목표 95% 통과.

## 작업 2 — 인텐트 dispatcher

**왜**: 파싱된 intent를 적절한 path로 라우팅하는 디스패처. tint면 tint
path 호출, ai-multipart면 오케스트레이터 호출.

**손볼 파일**:
- `lib/ai/intent/dispatcher.ts` (신설).

**구현 메모**:
- 입력: `IntentRequest`. 출력: `Promise<EditCommit[]>`.
- 분기:
  - `tint` → `tintPath.apply(...)`.
  - `ai-region` → 단일 generate (기존 GeneratePanel 경로 재사용).
  - `ai-multipart` → `orchestrator.run(...)`.
  - `compound` → followups를 재귀로 dispatch.
  - `unsupported` → UX에 에러 메시지.

**검증**:
- 각 intent 타입 한 개씩 end-to-end smoke test.

## 작업 3 — Plan stage UI

**왜**: 사용자가 "이게 11번 호출하고 $0.20 들어요" 확인 후 시작하는
승인 단계. 비용 폭주 / 잘못된 의도 둘 다 막는 안전장치.

**손볼 파일**:
- `components/IntentBar.tsx` (신설) — 상단 입력 바.
- `components/IntentPlanModal.tsx` (신설) — 파싱 결과 + 실행 승인.

**UX**:
- 자세한 레이아웃은 [12-ux-flow.md](../12-ux-flow.md) Flow 3.
- 사용자가 "Edit plan" 누르면 target group / style prompt 수정 가능.
- 비용 추정 = (예상 호출 수) × (provider별 단가).

**구현 메모**:
- 첫 진입에선 plan stage **필수**. 세션 내 "skip plan for next 10
  minutes" 토글은 옵션. 비용 보호 디폴트 우선.

## 작업 4 — AI 오케스트레이터

**왜**: 그룹 멤버 N개에 순차 generate 호출을 돌리고 reference를 체이닝
해서 cross-drawable palette / style 일관성을 만드는 핵심 컴포넌트.

**손볼 파일**:
- `lib/ai/orchestrator.ts` (신설) — `run(group, style, refs)` 메인.
- `lib/ai/orchestrator.types.ts` — 결과 / 진행 이벤트 타입.

**알고리즘**:
1. `rankByVisualProminence(layersInGroups(targetGroups))` — UV area
   + face-relative position + parameter 결합도. 가장 큰 / 정면의
   drawable이 anchor 후보 1순위.
2. Anchor 생성: image[1]=crop, image[2]=canonical pose, prompt=style.
3. Anchor 결과에서 palette 추출 (k-means n=5).
4. 후속 drawable에 대해 image[3]=anchor, image[4]=most-recent prior,
   prompt=style + palette anchor + highlight description.
5. 호출 결과를 `layerTextureOverride`로 일단 메모리에만 저장.
6. 모든 drawable 처리 후 사용자에게 review surface 표시.

**구현 메모**:
- per-call provider 라우팅 = Phase 1 router 룰의 발전판:
  - anchor + first 3 = gpt-image-2 (literal).
  - 그 다음 fan-out = fal-flux2-schnell.
  - 마지막 settle (옵션) = gpt-image-2.
- 실패 한 개가 체인 전체를 죽이지 않게: 실패 drawable은 skip,
  retry 가능 상태로 표시.
- 진행 이벤트는 EventEmitter / observable 형태로 UI가 구독.

**검증**:
- "change hair to wet leather" on Hiyori → 모든 hair drawable이 같은
  팔레트로 나오는지. CIEDE2000 분산 ≤15.
- 실패 시뮬레이션 (mock provider 에러 던지기) → 나머지 drawable 정상
  처리되는지.

## 작업 5 — Palette extractor + 프롬프트 임베딩

**왜**: 오케스트레이터의 핵심 일관성 lever. anchor의 dominant color를
이후 호출 prompt에 명시.

**손볼 파일**:
- `lib/ai/paletteExtractor.ts` (신설).
- `lib/ai/prompts/edit_template.v2.txt` — palette anchor 슬롯 채워서
  v1에서 한 단계 진화.

**구현 메모**:
- k-means(n=5)를 RGB 또는 Lab. Lab가 perceptual하게 더 안정.
- 결과는 weight 순으로 top 3 hex + percent 출력.
- hex는 gpt-image-2가 직접 매치하진 않지만 *방향*으로 작용. 그 정도로
  충분.

## 작업 6 — Highlight describer

**왜**: 재질 일관성 (gloss 위치 / 색)이 sequential drift에서 가장 잘
깨지는 항목. 명시적으로 prompt에 박아 넣으면 drift 감소.

**손볼 파일**:
- `lib/ai/highlightDescribe.ts` (신설).

**구현 메모**:
- anchor 이미지에서 Lab L* 상위 5% 픽셀 추출 → centroid 위치 →
  "top-left" / "top" / "top-right" / ... 9개 zone 중 하나.
- coverage = (해당 픽셀 수) / (anchor 픽셀 수).
- color = 평균 hex.
- 출력 예: "top-left, white #FFFFFF, ~5% coverage".

**검증**:
- 같은 모델로 anchor / fan-out 5장 만들고 highlight position이 일관된지.

## 작업 7 — Reference rotation policy

**왜**: gpt-image-2는 image budget 4개. 어떤 ref를 넣고 빼는지의 policy.

**손볼 파일**:
- `lib/ai/orchestrator/refs.ts` (신설).

**구현 메모**:
- 우선순위:
  1. image[1] = 현재 drawable crop (필수).
  2. image[2] = canonical pose (필수).
  3. image[3] = anchor result.
  4. image[4] = most-recent prior result (있을 때).
- 사용자 업로드 reference가 있으면 image[3] / image[4] 슬롯과 경합.
  policy는 default "anchor 우선" but 사용자가 GeneratePanel처럼 수동
  override 가능.

## 작업 8 — 오케스트레이터 진행 UI

**왜**: 길어야 5분짜리 작업. 사용자가 멍하니 바라보는 동안 이게
진행되고 있다는 confidence를 줘야 함.

**손볼 파일**:
- `components/OrchestratorProgress.tsx` (신설) — Phase 1 작업 7의
  ProgressStack 발전판.
- live composite preview (각 drawable 완료 시마다 character render
  갱신).
- per-drawable abort / regen.

**UX**:
- 레이아웃 상세는 [12-ux-flow.md](../12-ux-flow.md) Flow 3
  "progress view".

## 작업 9 — Per-group review surface

**왜**: 오케스트레이터 결과를 사용자가 그룹 단위로 accept / regen / edit
할 surface. 모든 결과를 일괄 commit하지 않고 그룹 단위 의사결정.

**손볼 파일**:
- `components/OrchestratorReview.tsx` (신설).

**UX**:
- 그룹별 thumbnail + 액션 버튼. 자세한 건 [12](../12-ux-flow.md) Flow 3 "review".
- 사용자 액션:
  - Accept: 해당 그룹의 모든 drawable override를 commit + provenance.
  - Regen: 해당 그룹만 다시 오케스트레이터 호출 (negative anchor로
    prior result 사용).
  - Edit: 그룹 멤버를 per-layer GeneratePanel / decompose studio로
    open. 기존 surface 그대로 재사용.

## 작업 10 — IDB intentRequests 스토어

**왜**: 인텐트 단위 metadata 영속화. 비용 / 시간 / provenance 추적의
핵심 엔티티.

**손볼 파일**:
- `lib/persistence/db.ts` — v9 upgrade (또는 v8.x minor) — `intentRequests`
  스토어 추가.
- `lib/persistence/intentRequests.ts` (신설) — 쓰기 / 읽기 유틸.

**구현 메모**:
- Schema 정의는 [11-data-model-evolution.md](../11-data-model-evolution.md)
  "Phase 3 schema additions".
- `editProvenance.intentRequestId`로 linkage.
- "이 'school uniform' 호출에 얼마 들었나?" = `providerCalls`의
  `costEstimate` 합산 한 쿼리.

## 작업 11 — 비용 추적 / 표시

**왜**: 인텐트마다 cost feedback toast 띄우는 게 사용자 신뢰의 핵심.
세션 누적도 표시.

**손볼 파일**:
- `components/CostBadge.tsx` (신설) — 상단 status bar 옆에 sticky.
- `lib/ai/costEstimator.ts` (신설) — provider별 단가 테이블 + 추정.

**구현 메모**:
- 단가 테이블은 코드에 hard-code. (provider 가격 자주 안 바뀜.)
- 세션 누적은 메모리만, 새 세션마다 리셋.
- $5 default 캡. 초과 시 토스트로 경고, 명시적 확인 받음.

## 작업 12 — Compound intent 분리

**왜**: "make hair red and give her glasses" 같은 복합 의도를 정상 처리
하려면 dispatcher 단에서 followups를 재귀.

**손볼 파일**:
- 작업 2 dispatcher 내부에 재귀 로직.
- UI: plan stage에서 followups를 펼쳐 보이기.

**검증**:
- compound prompt 5개에 대해 각 followup이 개별 dispatch되고, 결과가
  순서대로 commit되는지.

## 작업 13 — Failure handling 강화

**왜**: 오케스트레이터는 N개 호출 중 한두 개 실패해도 진행해야 함.
사용자는 어떻게 retry하는지 명확해야 함.

**손볼 파일**:
- 오케스트레이터 내부에 try/catch + 실패 메타데이터.
- Review surface에서 실패 drawable에 `[retry]` 버튼 노출.
- 작업 4의 EventEmitter에서 `drawableFailed` 이벤트 발행.

**구현 메모**:
- retry는 가장 최근 성공 drawable을 새 anchor로 잡고 실패한 drawable만
  다시 시도. 실패가 chain 시작점이었으면 (anchor 자체 실패) 전체 그룹
  재시도.

## 작업 14 — 그룹 단위 undo

**왜**: 오케스트레이터로 11개 drawable 편집한 걸 한 번에 undo하고
싶음. 개별 undo도 가능해야 하지만 default는 atomic.

**손볼 파일**:
- `lib/persistence/history.ts` — 기존 history 구조에 그룹 단위 entry
  추가.
- `layerOverrides.isAtomicWithGroup` 필드 사용. 오케스트레이터 run마다
  group id 발급.
- UI: History panel에 그룹 entry는 collapse / expand 가능.

## Ship criteria — Phase 3 종료 조건

- [ ] 50-prompt eval set에서 intent parser 95% 통과.
- [ ] "change hair to wet leather" on Hiyori이 ≤2분 안에 일관된 결과
      produce.
- [ ] "give her a school uniform" 시나리오가 ≤5분 안에 완료, 그룹별
      review surface로 부분 accept 가능.
- [ ] Cross-drawable palette CIEDE2000 분산 ≤15 (eval).
- [ ] 그룹 단위 undo가 한 entry로 묶이고, 펼쳐서 individual undo도
      가능.

## 위험 / 차단 요소

| 위험 | 대응 |
|---|---|
| Sequential drift가 4호출 이후 누적 | settle pass 추가 (anchor 마지막에 재생성). 또는 4호출마다 anchor 재추출 |
| 인텐트 파서가 unsupported intent를 잘못 분류 | confidence 낮으면 plan stage에서 강조. unsupported도 명확한 reason 출력 |
| 비용이 예상보다 빠르게 누적 | session 캡 $5 default. 초과 시 명시적 확인 |
| 오케스트레이터 도중 사용자 puppet 닫음 | 진행 중 인텐트 isRunning 플래그. 닫을 때 "진행 중인 작업이 있습니다. 중단하시겠습니까?" |
| 실패 drawable이 절반 이상이면 review가 무의미 | 실패율 30% 초과 시 자동 중단하고 "재시도하시겠습니까?" 모달 |
| Plan stage가 사용자 흐름을 끊는 느낌 | "skip plan" 토글 첫 세션에선 비활성, 1회 익숙해진 후 활성화 |

## 작업 순서 권장

1. 작업 1 (intent parser) + 작업 10 (intentRequests 스토어) — 같이 묶어
   PR.
2. 작업 2 (dispatcher) — 기본 분기만 먼저.
3. 작업 5 (palette extractor) + 작업 6 (highlight describer) + 작업 7
   (refs policy) — 오케스트레이터 의존 부품.
4. 작업 4 (오케스트레이터) — 위 모듈 합쳐 단일 호출 → N개 호출 확장.
5. 작업 3 (Plan stage UI) + 작업 8 (진행 UI).
6. 작업 9 (review surface).
7. 작업 11 (비용 추적).
8. 작업 12 (compound).
9. 작업 13 (failure handling 강화) + 작업 14 (그룹 undo).

## 다음 단계로 가기 전 점검

Phase 3 종료 시:

- 50-prompt eval 통과율 측정값.
- "school uniform" 시나리오의 평균 latency / 비용 / palette 분산
  실측.
- 사용자 (나)가 일주일 정도 직접 사용한 정성적 평가.
- Phase 4 spike에 대한 go / no-go 의사결정.
