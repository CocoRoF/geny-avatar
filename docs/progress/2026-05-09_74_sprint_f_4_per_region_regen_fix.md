# 2026-05-09 — Sprint F.4: Per-region regenerate bug fix + diagnostics

사용자 보고: 6 region layer (胸) 에서 region 1 ↻ 클릭 → "failed" 표시. tooltip 외엔 이유 안 보이고 어떻게 해야할지 모름.

## 근본 원인

[`73 sprint_f_pre_phase6_polish`](2026-05-09_73_sprint_f_pre_phase6_polish.md) 에서 ↻ button 의 `regenDisabled` 가드가 prompt 체크를 빼먹음. main "generate" button은 `submitDisabled` 에 `!prompt.trim()` 가드가 있어서 빈 상태엔 disabled, 하지만 ↻ 는 그 가드 없이 enabled → click 가능 → API route 의 `prompt.trim().length === 0` 검증에 걸려 400 → throw → status: failed.

추가로 발견: `runRegionGen` 이 panel-level `prompt` 를 그대로 `submitGenerate.prompt` 필드에 보냄. COMMON CONTEXT 비우고 per-region textarea 만 채워서 ↻ 눌러도 server route 가 prompt 비어있다고 여전히 400. UX 의도 (region별 독립 프롬프트로 생성 가능) 와 안 맞음.

## 변경 surface

### `components/GeneratePanel.tsx`

#### regenDisabled 에 prompt 가드 추가

```ts
const regionHasPrompt =
  prompt.trim().length > 0 ||
  (componentPrompts[idx] ?? "").trim().length > 0;
const regenDisabled = ... || !regionHasPrompt;
```

prompt가 어디에도 없으면 ↻ disabled. tooltip:

> "type a prompt (common context or this region's textarea) before regenerating"

#### regenerateOneRegion 에 fail-fast guard

API 호출 전에 prompt 비어있으면:
- `regionStates[idx].status = "failed"`
- `failedReason = "type a prompt before regenerating — either in COMMON CONTEXT or this region's textarea"`
- early return (네트워크 호출 X)

가드가 ↻ disabled 로 막아주지만, race / programmatic 호출 대비 이중 안전.

#### runRegionGen 의 empty-common fallback

panel-level prompt 가 비고 per-region 만 있을 때:
- `submitGenerate.prompt` 필드에 per-region 텍스트를 raw prompt 로 보냄
- `refinedPrompt` 에는 region-descriptor 포함된 composed 텍스트
- server route 가 prompt 검증 통과
- provider 의 composePrompt 는 refinedPrompt 우선 사용 → 모델은 structured 텍스트 본다

Logic:
```ts
const rawPromptForRoute =
  prompt.trim().length > 0 ? prompt : perRegion.length > 0 ? perRegion : "";
```

#### inline failure reason

region tile 에 status: failed 시 textarea 아래 빨간 inline panel 추가:

```jsx
{isRegionFailed && regionState?.failedReason && (
  <div className="rounded border border-red-500/30 bg-red-500/10 px-1.5 py-1 text-[10px] text-red-300">
    {regionState.failedReason}
  </div>
)}
```

tooltip 만으로는 발견 어려운 사용자 발견 패턴 해결.

#### per-region clear (✕)

각 tile 의 ↻ 옆에 ✕ 버튼:
- region 의 prompt textarea → 빈 문자열
- `regionStates[idx].status = "idle"`, failedReason = undefined
- running 중이면 disabled

failed 또는 막막한 region 을 빠르게 reset.

## 의도적 한계

- **server route 변경 X**: option 으로 server 가 refinedPrompt 만 받고 prompt 비어도 OK 하게 할 수도 있지만, API contract 변경 보다 client side fallback 이 단순. 다른 호출자 (Gemini path 등) 도 raw prompt 를 항상 채우는 invariant 유지.
- **clear 가 prompt 만 reset**: resultBlob (현재 composite 기여) 은 그대로. status 만 idle. 만약 사용자가 "이 region 을 완전히 원본 으로 되돌려" 하려면 clear → 다시 generate 안 함 → composite 에 마지막 generated blob 남아있음. `resultBlob` 도 isolated source 로 reset 하면 더 깨끗하지만 이 sprint 범위 밖. 향후 polish.
- **panel-level partial-fail banner X**: per-tile inline error 가 충분하다고 판단. 모든 tile 동시 실패 같은 case 만 panel-level error로 (이미 onSubmit 의 `allFailed` throw).

## 검증

- typecheck 통과
- biome 통과
- `next build` 통과

## 시각 검증 가이드

```bash
git pull && pnpm install && pnpm dev

# 케이스 1 — empty prompt 가드
# 1. 6 region 胸 layer 진입
# 2. COMMON CONTEXT 비움, 모든 per-region textarea 도 비움
# 3. region 1 ↻ → disabled (회색), hover 시 "type a prompt..." tooltip
# 4. region 1 textarea 에 "round soft volume" 입력
# 5. region 1 ↻ → enabled, click → running → succeeded (다른 region 그대로)
#    이때 panel-level prompt 비어있어도 OK (per-region 이 raw prompt 로)

# 케이스 2 — failed inline reason
# 1. (앞 케이스에서 어떤 이유로 실패한 경우)
# 2. tile 의 ✕ ! 빨간 배지 + textarea 아래 빨간 panel 에 reason 명시 ("type a prompt..." 등)
# 3. 사용자가 reason 보고 prompt 입력 → ↻ 다시 → 성공

# 케이스 3 — per-region clear (✕)
# 1. region 2 에 prompt 입력 후 ↻ → succeeded
# 2. region 2 의 ✕ click → prompt 비워짐, status idle (✓ generated 표시 사라짐)
# 3. 다시 다른 prompt 로 ↻ 가능

# 케이스 4 — empty common, per-region only
# 1. COMMON CONTEXT 비움
# 2. region 3 textarea: "lace trim white"
# 3. region 3 ↻ → 정상 호출 (prompt 필드에 "lace trim white" 가는 거 dev 콘솔 [openai] 로그에서 확인 가능)
```

이걸로 ↻ 가 사용자가 본 그 layer 에서도 정상 동작. failure 시 reason 명확히 표시. Phase 6 진입 unblocked.
