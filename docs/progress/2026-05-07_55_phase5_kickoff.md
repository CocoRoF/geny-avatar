# 2026-05-07 — Phase 5 Kickoff: gpt-image-2 Framework 정공

## 컨텍스트

Phase 4 (Variant + Export) 완전 종료. V1 시나리오 A·B·C 모두 시연 가능. 다음은 **AI 품질 강화** — 같은 puppet에서 여러 layer를 재생성해도 톤이 어긋나지 않게 하는 것.

[`07 phased_roadmap`](../plan/07_phased_roadmap.md)의 Phase 5는 원래 IP-Adapter / LoRA / 자체 ComfyUI를 묶었지만 사용자 결정으로 **gpt-image-2 cloud API 단독**으로 정공 진행 → 안정화 후 ComfyUI는 Phase 5.5 또는 6에 별도 추가.

## 새로 알게 된 gpt-image-2 능력 (docs 확인 후 결론)

- `/v1/images/edits`가 **`image[]` 배열로 다중 이미지 입력 지원**. 핵심 활용 포인트.
- 다중 이미지 중 **첫 번째에만 mask 적용** → 우리 layer source가 [0]번, reference들이 [1...]번
- 추가 이미지는 "character/style reference"로 작동
- `quality: low/medium/high/auto` 옵션 (현재 omit해서 default `auto`)
- `transparent` background는 gpt-image-2 미지원 (현재도 white pad 쓰니까 OK)
- Responses API의 `previous_response_id`로 iterative refinement 가능 (향후 후속)

이 한 가지 (`image[]` 다중 입력) 가 **IP-Adapter 없이 gpt-image-2만으로 캐릭터 일관성을 잡는 핵심 메커니즘**.

## Phase 5 sub-sprint 분할

각 sprint은 atomic PR — 사용자 검증 후 다음 진입.

### Sprint 5.1 — Per-puppet reference image store

새 IDB 테이블 + UI 패널.

- **IDB v7**: `puppetReferences` store — `{ id, puppetKey, blob, name?, createdAt, weight? }`
- **`useReferences(puppetKey)` 훅** — 기존 `useVariants` / `useLayerOverridesPersistence` 패턴 재사용
- **`ReferencesPanel` 컴포넌트** — Variants/Layers 패널과 같은 사이드바에 작은 섹션:
  - 썸네일 그리드
  - "+ upload" — 파일 선택 → IDB 저장
  - 행별 삭제 + (선택) "anchor" 토글
- 페이지 와이어링: 3개 edit 페이지 모두

이 sprint 자체로는 generation에 영향 X. UX 인프라 구축.

### Sprint 5.2 — OpenAI provider multi-image input

`lib/ai/providers/openai.ts` 변경:

- `ProviderGenerateInput`에 `referenceImages?: Blob[]` 추가
- 요청 빌드: `form.set("image", ...)` → `form.append("image[]", source)` + 각 ref도 `image[]` append
- 프롬프트 합성에 ref 힌트 추가 — 예: 추가 이미지가 있으면 "Match the visual style and character identity shown in the reference images." 자동 prepend
- mask는 그대로 (첫 번째 image[]에 적용됨)
- 진단 로그에 `references=N` 표시

`lib/ai/client.ts`는 ref blob을 그대로 통과시키도록 시그니처 확장.

### Sprint 5.3 — GeneratePanel reference selection UX

- ReferencesPanel과 별개로 GeneratePanel 내부에 "active references" 섹션:
  - 사용 가능한 ref 썸네일 + 체크박스 (기본 모두 체크)
  - 체크된 것만 generate 호출에 포함
- **"Use this as reference"** 액션 — history row의 generation 결과 / 현재 source preview를 ref로 승격
- "Pin as canonical style" — 한 ref를 강제 활성으로 잠그기 (선택)

### Sprint 5.4 — Prompt template library

자주 쓰는 작업을 1-click chip으로:

- `outfit recolor` — "Recolor this <slot> to <color>, preserving fabric and detail."
- `style transfer` — "Repaint with the visual style of the reference images."
- `detail enhance` — "Add fabric and surface detail without changing silhouette."
- `outfit swap` — "Replace the <slot> with <description>, preserving pose and lighting."

GeneratePanel에 chip row 추가. chip 클릭 → 프롬프트 input에 템플릿 자동 채움 (변수 슬롯 `<color>` 등은 사용자가 인라인 편집).

(선택) chip별로 권장 `quality` 자동 설정 — 예: detail enhance는 quality=high.

### Sprint 5.5 — Generation comparison viewer

History 패널 강화:

- 두 history row를 **multi-select** → "compare" 버튼 → side-by-side 모달
- 같은 layer / 다른 prompt-ref 조합 비교
- (선택) 간단 메트릭: alpha coverage 비율, dominant color delta-E, 파일 크기 차이

품질 회귀 테스트 자동 셋업이 아니라 **사용자가 직접 비교**할 수 있는 도구. 자동 회귀는 별도 sprint로 분리 가능.

### Sprint 5.6 — (deferred) Self-hosted ComfyUI 또는 다른 provider

지금은 미진입. 5.5까지 끝낸 후 사용자 결정에 따라:
- ComfyUI Cog deploy on Replicate
- 또는 자가호스팅 컨테이너
- IP-Adapter / LoRA 제대로 진입

## 예상 산출물

5.1~5.5 끝나면:
- 같은 puppet 안에서 layer A를 generate → 자동으로 character ref로 등재 → layer B generate 시 그 ref 같이 들어감 → 톤 일관성
- prompt template으로 새로운 사용자도 빠르게 사용
- before/after 비교로 ref 효과 직접 확인

이게 V1 가치 제안 ("같은 캐릭터의 여러 layer를 재생성해도 톤이 어긋나지 않는다") 의 진짜 시연 가능한 형태.

## 의도적 한계

- **gpt-image-2 비용**: ref 이미지 N개 추가 → 입력 토큰 N배 → 비용 증가. 사용자 결정 사항. UI에 ref 활성 개수 표시.
- **속도**: 다중 이미지 처리 시 응답 지연 가능. 폴링 timeout 그대로 유지.
- **ComfyUI / LoRA / IP-Adapter**: 명시적 deferred. Phase 5 끝난 후 별도 phase.
- **previous_response_id 활용**: 이번 phase에 미진입. 후속 sprint에서 iterative refine 워크플로 가능 시 추가.

## 다음 단계

Sprint 5.1부터 시작 — IDB 인프라 + ReferencesPanel. 이게 모든 후속 sprint의 baseline.

## 진행 추적

| Sprint | 주요 작업 | 상태 |
|---|---|---|
| 5.1 | Per-puppet reference image store + UI | 대기 |
| 5.2 | OpenAI provider multi-image input | 대기 |
| 5.3 | GeneratePanel reference selection UX | 대기 |
| 5.4 | Prompt template library | 대기 |
| 5.5 | Generation comparison viewer | 대기 |
| 5.6 | (deferred) ComfyUI 등 | 미정 |
