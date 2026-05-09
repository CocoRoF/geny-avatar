# 2026-05-07 — Sprint 5.5: Generation comparison viewer

[`55 phase5_kickoff`](2026-05-07_55_phase5_kickoff.md)의 마지막 atomic sprint. 5.1~5.4가 references / multi-image / iterative anchor / LLM-refined prompt를 깔았으니, 사용자가 두 generate 결과를 직접 side-by-side로 보고 어떤 prompt / ref / refine 조합이 더 잘 들었는지 검증할 수 있는 도구.

## 변경 surface

### `GeneratePanel` history 영역 — multi-select

- 새 state: `comparisonIds: string[]` (max 2, 가장 오래된 게 자동 drop), `comparisonOpen: boolean`
- 각 history row 좌측에 체크박스 추가 — 클릭하면 comparisonIds 토글
- row 본문 클릭 흐름은 기존 그대로 (revisit) — 체크박스만 별도 hit-target
- selected row는 accent-색 border + 살짝 tint된 배경
- comparisonIds.length > 0 일 때 history 헤더 아래에 "N/2 selected · [compare] · [clear]" 컨트롤 노출
- history 변경 시 `useEffect`로 더 이상 존재하지 않는 selection은 자동 정리

### `ComparisonModal` 컴포넌트

GeneratePanel과 같은 full-screen overlay 형태:

- 헤더: "compare · M of 2" + close 버튼 (Esc도 dismiss)
- 본문: `grid-cols-2` 로 두 row를 side-by-side
  - 각 column: slot A/B 라벨 + 상대 시간
  - max-h-full max-w-full object-contain 으로 두 결과를 같은 크기로 정렬 — 시각 비교 직접 가능
  - 메타 dl: provider · model / prompt / negative (있으면) / 결과 byte size
- row 1개만 선택 시 slot B 자리에 "pick a second history row" 안내 dashed-border placeholder

`useEffect`로 모든 row의 blob URL을 useState에 모은 뒤 unmount 시 revoke. row 변경 시 이전 URLs 해제.

## 의도적 한계

- **자동 quality 메트릭 X**: alpha coverage / dominant-color delta-E / 픽셀 diff 같은 건 안 띄움. 사용자 시각 비교가 일차 검증 수단. metric 자동화는 미래 polish.
- **2개만 비교**: A/B 둘만. 3+ slot grid는 화면 좁음 — 2개로 충분히 의도 검증됨. 필요시 grid-cols-3으로 확장 쉬움.
- **prompt diff 표시 X**: 두 row의 prompt를 나란히 보여주지만 diff highlighting은 안 함. 사용자가 두 본문을 직접 읽음. 짧은 prompt는 충분, 긴 prompt에선 추가 sprint.
- **history → ref pin은 별도**: 비교 결과 마음에 드는 쪽을 ref로 다시 끌어올리는 액션은 안 들어감. 5.1~5.3의 last-result anchor + ReferencesPanel 업로드로 우회 가능.

## Phase 5.6 — ComfyUI deferred (placeholder marker)

사용자 결정:
> comfyui는 현재 버전에서는 일단 그냥 모양만 (TODO로 남길것)

이미 [`Sprint 3.2`](2026-05-07_39_phase3_complete.md)의 Replicate stub이 같은 long-running-job 폴링 메커니즘을 모양으로 깔아둠. ComfyUI 통합 시 그 인프라 재사용 예정. 별도 신규 stub 추가 X — 한 번에 한 종류만 돌리면 됨.

deferred 작업 (Phase 5.6+):
- IP-Adapter 통합 (캐릭터 ref 더 강력)
- 사용자 LoRA 업로드 + 적용
- ComfyUI 워크플로 self-host (Replicate Cog 또는 자가호스팅)
- previous_response_id 이용한 정밀 iterative refine (gpt-image-2 Responses API 통합)

## Phase 5 진행 종합

- ✅ 5.1 Per-puppet reference image store
- ✅ 5.2 OpenAI multi-image input (`image[]`)
- ✅ 5.3 Active references + iterative anchor
- ✅ 5.4 Structured prompt + vision-enabled LLM refinement
- ✅ **5.5 Generation comparison viewer**
- ⏳ 5.6 (deferred) ComfyUI / IP-Adapter / LoRA — Replicate stub 재사용 예정

V1 가치 제안 ("같은 캐릭터의 여러 layer를 재생성해도 톤이 어긋나지 않는다") 시연 가능한 형태로 정리됨. 사용자가 단일 puppet에서 ref 1~3장 업로드 → 한국어 prompt 입력 → 자동 영어 refine → gpt-image-2가 image[] 다중 입력 + concrete design transfer → 결과 압축 비교.

## 검증

- typecheck 통과
- biome 통과
- `next build` 통과

## 시각 검증 가이드

```bash
git pull && pnpm install && pnpm dev

# 1. 같은 layer로 2~3번 generate (ref / prompt / refine 토글 조합 다르게)
# 2. 각 generate를 apply 또는 dismiss → IDB history에 entry 누적
# 3. history 영역에서 두 row의 체크박스 ON
# 4. 헤더 아래에 "2/2 selected" + [compare] [clear] 컨트롤 등장
# 5. compare 클릭 → 모달 열림
#    - 두 결과가 같은 크기로 side-by-side
#    - slot A / slot B 라벨 + 상대 시간
#    - provider/model/prompt/(negative)/size 메타
# 6. esc 또는 close → 닫힘
# 7. 한 row 만 선택 시 → 모달 우측에 "pick a second" placeholder
# 8. clear → 선택 모두 해제
# 9. history 변경 (apply 후 자동 reload) → 사라진 row의 selection은 자동 정리
```
