# 2026-05-13 mask-soft (feathered) blend 모드 추가

**Phase / 작업**: PR #32 follow-up (mask 경계 hard-cut 개선)
**상태**: done
**관련 계획**: [../plan/01-Phase1.md](../plan/01-Phase1.md)

## 사용자 피드백

> "마스크 로직이 너무 구린데 좀 개선하자."

PR #32에서 `mask-hard`만 노출했더니 luma≥128 binary cut이라
머리카락 silhouette을 mask 경계에서 칼같이 잘라 어색했음
(스크린샷: 머리 가닥 흐름이 mask 라인에서 단절). 사용자는 "경계
soft blend (feather)" 한 항목만 우선순위 1로 선택.

## 변경

### `lib/ai/client.ts`

1. `BlendMode` union에 `"mask-soft"` 추가.
2. `composeAIResultWithMask` 분기:
   - `mask-soft` 선택 시 mask를 그릴 canvas에 `ctx.filter =
     "blur(Npx)"` 적용해서 mask를 흐리게 만든 뒤,
     `result = source * (1-w) + ai * w` 로 alpha-weighted lerp.
     w = blurred mask luma / 255.
   - `mask-hard`는 기존 binary 분기 유지.
3. `defaultFeatherRadiusPx(w, h)`:
   - `round(min(w,h) * 0.015)`, `[3, 32]` clamp.
   - 512px → ~8px, 1024px → ~15px. 가닥 경계 staircase 죽이기에
     충분하면서 mask 의도 벗어나 번지지는 않는 크기.
4. caller가 원하면 `featherRadius` 인자로 override 가능.
   (아직 UI slider는 없음 — 후속.)

### `components/GeneratePanel.tsx`

1. RESULT toolbar에 `mask-soft` 버튼 추가:
   `[ AI only | mask-soft | mask-hard ]`.
2. tooltip 갱신 — mask-soft는 머리카락 같은 자연 가장자리에 권장,
   mask-hard는 직선/사각 영역에 권장이라고 명시.
3. mask 없으면 두 mask-* 버튼 모두 disable + 안내 tooltip (이미
   PR #32 시점에 mask-hard에 있던 패턴 그대로 적용).

## 검증

- `pnpm typecheck` ✓
- `pnpm exec biome check components/GeneratePanel.tsx lib/ai/client.ts` ✓
- 실행 시나리오:
  1. MASK 탭에서 머리 오른쪽 절반 paint → save.
  2. GEN → OpenAI → "change masked area to blue ocean color" run.
  3. RESULT 상단 toolbar에서 mask-soft 토글.
  4. 콘솔 로그: `[compose] mask-soft (feather=Npx): mean weight …`.
  5. 결과: mask 경계가 자연스럽게 fade. 머리카락 가닥이 mask 라인
     에서 갑자기 끊기지 않고 부드럽게 색이 섞임.

## 결정

1. **default `ai-only` 유지**. mask 없는 사용자가 GEN 첫 결과를
   원본과 비교하는 흐름을 깨고 싶지 않음. mask 그렸으면 본인이
   mask-soft 누르도록.
2. **feather radius 자동 (canvas dim 기준 1.5%)**. PR이 비대해질까봐
   UI slider는 후속으로 미룸. 자동값이 "구려" 보이면 그때 slider
   PR.
3. **Gaussian blur via canvas `ctx.filter`**. 브라우저 native라
   빠르고 화질 충분함. WebGL/manual conv 안 함.
4. **alpha도 lerp 대상에 포함**. 사실 silhouette은 postprocess
   Step 2에서 source alpha로 clip되어있으므로 source/ai의 alpha가
   silhouette 안에서는 둘 다 255라 lerp 결과도 255. silhouette
   바깥은 둘 다 0이라 0. 결과적으로 silhouette 보존됨.

## 영향

- mask-hard와 mask-soft 둘 다 노출 → 사용자가 영역 모양에 맞춰
  선택. 머리/털 → soft, UI/배지/사각 → hard.
- 기본값 `ai-only`라서 mask 안 그린 흐름은 회귀 없음.
- 후속 PR 여지:
  - feather radius slider.
  - RESULT 위에 mask outline overlay (사용자가 그린 영역
    시각 확인).
  - mask 영역만 crop해서 AI 입력으로 보내기 (model을 mask에 집중
    시키는 더 근본적인 개선).

## 참조

- 손댄 파일:
  - `lib/ai/client.ts` — BlendMode union, soft 분기, default feather.
  - `components/GeneratePanel.tsx` — toolbar 3-button, mode doc.
- PR: 이 entry가 포함된 PR이 머지될 때 main에 들어감.
- 직전 entry: [2026-05-13-blend-mode-selectable.md](2026-05-13-blend-mode-selectable.md)
  (mode select UI 기반).
