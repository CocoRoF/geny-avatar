# 2026-05-10 — Phase 8.5: Expressions + Emotion map

[Phase 8 plan](../plan/09_editor_animation_tab.md) 다섯 번째 sprint. 표정 미리보기 + Geny 의 8 GoEmotions 기반 emotion → expression 매핑.

## 변경 surface

### `components/animation/ExpressionsSection.tsx` (신규)

상단 — expressions list:
- ▶ 버튼 → `adapter.setExpression(name)` 트리거 (8.4 에서 추가).
- 표정 이름 (mono).
- 우측: 그 표정에 매핑된 emotion 들 chip 형태 (역방향 인덱스).
- 헤더에 `clear` 버튼 — `setExpression(null)` (default 표정 복귀).

하단 — emotion 매핑 테이블:
- `EMOTION_KEYS` constant (8개): `neutral / joy / anger / disgust / fear / sadness / surprise / smirk` — Geny 의 model_registry.json 의 ellen_joe / mao_pro 와 동일한 셋.
- 각 행: `<emotion>` 라벨 + `→` + dropdown (puppet 의 expressions + `(none)` sentinel).
- dropdown 변경 시 즉시 preview (`setExpression`) 도 호출 — 사용자가 `joy → red` 선택하자마자 캔버스에 빨간 표정 적용 → 시각 검증 즉답.

### `EmotionMap` 타입

```ts
export type EmotionMap = Partial<Record<EmotionKey, string>>;
// 예: { joy: "red", anger: "black", surprise: "shock" }
```

매핑은 expression NAME 기준 — 모델의 expression 순서가 바뀌어도 안전. 8.8 (export) 에서 NAME → INDEX 변환해서 Geny 형식으로.

### `components/animation/AnimationPanel.tsx`

expressions placeholder 섹션 제거 → `<ExpressionsSection adapter meta />` 로 교체. unused `expressionCount` 변수 제거.

## 의도적 한계

- **emotion 매핑 IDB 영속 X**: 8.7 까지 in-memory. 페이지 reload 시 초기화.
- **`clear` 버튼은 expression 만**: motion 은 자동 idle 복귀라 별도 clear 불필요.
- **GoEmotions 8 셋 hardcoded**: `EMOTION_KEYS` constant. Geny 가 향후 셋 변경하면 본 array + buildModelZip 의 schemaVersion 동시 bump.
- **multi-emotion → 같은 expression 허용**: 한 expression 에 여러 emotion 매핑 가능 (예: `anger → black`, `disgust → black`). reverse map 으로 표시되어 사용자가 인지 가능.
- **자동 emotion guess X**: "joy 는 red 가 잘 어울려요" 같은 추천 X. 사용자가 직접 시청 + 결정.

## 검증

- `pnpm typecheck` 통과
- `pnpm lint` 통과 (assign-in-expression 1건 발견 → 분리)
- `pnpm build` 통과
- 시각 검증: `/edit/builtin/hiyori?tab=animation` → 표정 0개 (Hiyori 는 expressions 없음). 다른 puppet (예: ellen_joe upload) 으로 검증 — 표정 6개 list, ▶ 누르면 캔버스 즉시 변화. emotion dropdown 변경 → 즉시 preview.

## 다음 — 8.6

`components/animation/HitAreasSection.tsx` 신규. model 의 HitAreas 정의가 있을 때만 렌더 (Hiyori 처럼 `HitAreas: []` 면 hidden). 각 영역 별 motion group/index 매핑 dropdown.
