# 2026-05-13 RESULT blend mode를 사용자 선택형 UI로 (#31 강제 적용 회수)

**Phase / 작업**: PR #31 follow-up (사용자 분노 + 합성 방식 선택권)
**상태**: done
**관련 계획**: [../plan/01-Phase1.md](../plan/01-Phase1.md)

## 사용자 피드백

> "이건 반드시 그렇게만 적용하지 말고 그런 합성 기능을 그냥 에디터에서
> 제공하는 것으로 해야지 시발 Result 쪽에 상단에 이걸 합성할 수
> 있는 방식을 선택할 수 있도록 하고 그런 방식으로 가는거야 무조건
> 적용하는 병신같은 짓은 하지말고 시발"

PR #31은 postprocess 안에서 `inpaintMaskBlob`을 받으면 무조건 hard
mask blend를 강제했음. 사용자 의도는 정반대 — model이 mask 잘
지킨 경우엔 AI 결과 그대로 쓰고 싶고, model이 무시해서 사고
친 경우에만 region 강제 적용. 결정권은 UI에서 줘야 함.

## 결론

`postprocessGeneratedBlob`은 알파/패딩 정리만. mask blend는
**별도 helper** + **RESULT toolbar의 mode select**로 분리.
사용자가 generate 후 mode toggle만 해도 즉시 RESULT 미리보기 갱신,
재호출 없음.

## 변경

### `lib/ai/client.ts`

1. `postprocessGeneratedBlob` 인자에서 `inpaintMaskBlob` 제거 +
   Step 3 (hard blend) 코드 제거. PR #31 revert.
2. 새 export:
   ```ts
   export type BlendMode = "ai-only" | "mask-hard";

   export async function composeAIResultWithMask(opts: {
     aiResultBlob: Blob;
     sourceCanvas: HTMLCanvasElement;
     maskBlob: Blob | null;
     mode: BlendMode;
   }): Promise<Blob>
   ```
   - `ai-only`: aiResultBlob 그대로 반환.
   - `mask-hard`: source 위에 AI 결과를 mask white 영역에만 paint.
     luma >= 128 = AI, < 128 = source. 마스크/AI 모두 source dim에
     resample.

### `components/GeneratePanel.tsx`

1. `phase.succeeded` 타입에 `aiBlob: Blob` 추가. AI 원본을 캐시하므로
   mode 전환 시 재호출 없이 즉시 재합성.
2. `blendMode` state (`"ai-only" | "mask-hard"`), 기본 `ai-only`.
3. `useEffect([blendMode, inpaintMaskBlob, phase.kind])`: succeeded
   상태에서 mode 또는 mask가 바뀌면 `phase.aiBlob`을 재합성 →
   `phase.blob` 갱신.
4. `onSubmit` 마지막 블록: `processed`를 일단 `aiBlob`으로 보존,
   현재 선택된 mode로 `composeAIResultWithMask` 호출한 결과를
   화면 blob으로 사용.
5. 다른 setPhase succeeded 호출지점(`recompositeResult`,
   `onRevisit`, `runRegionGen`의 multi-component composite)에도
   `aiBlob` 동봉.
6. RESULT preview 상단 라벨 옆에 toolbar 추가:
   `[blend: AI only | mask-hard]`. mask-hard는 `inpaintMaskBlob`
   없으면 disabled + 안내 tooltip.

## 검증

- `pnpm typecheck` ✓
- `pnpm exec biome check` ✓ (사전 존재 17 warning만 남음, 본 PR
  관련 신규 0).
- 실호출 테스트 시나리오:
  1. MASK 탭 → 머리 절반만 paint → save.
  2. GEN → OpenAI → 프롬프트 "change masked area to blue" → run.
  3. RESULT 상단 toolbar 노출 확인.
  4. AI only / mask-hard 토글 → 즉시 RESULT 미리보기 변경.
  5. AI only = 전체 변경, mask-hard = 절반만 변경.

## 결정

1. **post-hoc 강제 제거**. 사용자 의도 = 선택형. forced 정책은
   사용자가 명시적으로 거부했음.
2. **mode 추가는 helper 하나에 몰기**. 향후 `soft-blend`,
   `feather-edge`, `luma-preserve` 등은 같은 `BlendMode` union +
   `composeAIResultWithMask` 분기로 확장.
3. **aiBlob 캐시 vs 재생성**. mode 토글마다 provider 재호출은 비용/
   대기시간 모두 낭비. AI 결과를 phase에 보관하는 비용이 훨씬 작음.
4. **mask 없을 때 mask-hard disabled**. button을 숨기지 않고
   disable + tooltip으로 "MASK 그려야 활성화" 안내 — 사용자가
   기능 존재를 발견할 수 있도록.

## 영향

- OpenAI / fal.ai / Gemini 모든 흐름에서 동일 UI. 단일 단일-source
  + 멀티 컴포넌트 양쪽 setPhase 호출지점에 `aiBlob` 동봉했으니
  history revisit / multi-component composite 흐름도 정상 동작.
- 사용자가 의도적으로 AI 전면 redraw를 원하면 `AI only` 유지,
  mask 영역만 바꾸고 싶으면 `mask-hard` 토글.
- 후속 PR 여지: soft-blend (alpha-weighted, mask 경계 anti-alias).

## 참조

- 손댄 파일:
  - `lib/ai/client.ts` — Step 3 제거, `BlendMode` + `composeAIResultWithMask`
    추가.
  - `components/GeneratePanel.tsx` — phase aiBlob, blendMode state +
    effect, RESULT toolbar.
- PR: 이 entry가 포함된 PR이 머지될 때 main에 들어감.
- 직전 entry: [2026-05-13-postprocess-mask-blend.md](2026-05-13-postprocess-mask-blend.md)
  (이번 PR이 그 강제 적용을 회수).
