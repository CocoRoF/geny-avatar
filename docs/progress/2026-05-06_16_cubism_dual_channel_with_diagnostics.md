# 2026-05-06 — Cubism: dual-channel override + diagnostic logs

## 사용자 피드백

지난 15(`beforeModelUpdate` 단일 채널 + setPartOpacity)도 시각 무효. 사용자가 콘솔에 어떤 로그도 안 떠서 어디서 끊기는지 알 수 없다고 명시.

## 처음부터 다시 — 가능한 끊김 지점 매핑

1. **클릭이 setLayerVisibility까지 도달 안 함** — React state는 갱신되지만 adapter 호출 누락
2. **`beforeModelUpdate` 이벤트가 fire 안 됨** — 엔진의 update 경로가 d.ts와 다를 수 있음
3. **`setPartOpacity`가 호출되지만 모델이 무시** — 이 모델 (Hiyori)이 part level binding을 안 쓰고 drawable opacity를 parameter로 직접 묶었을 가능성 — Cubism Editor에서 흔한 워크플로
4. **propagation이 안 일어남 / 다른 곳에서 덮어씀** — race 가설

## 해결 — 진단 + 두 채널 동시 적용

이번엔 추측 그만하고 콘솔에 모든 단계를 출력 + 가능한 두 mutation 채널을 동시에 적용:

### 진단 로그

```
[Live2DAdapter] hooked beforeModelUpdate · parts=24 drawables=134 partsMapped=20 nativeDrawables=true hasSetPartOpacity=true
[Live2DAdapter] setLayerVisibility(ly_..., false) → partIdx=12     ← 매 클릭마다 (24번)
[Live2DAdapter] hook fire #1, applying 24 overrides                ← 첫 frame
[Live2DAdapter] setPartOpacity verify part[12]: want=0, read-back=0  ← 이게 0이 아니면 setPartOpacity 자체가 무력
[Live2DAdapter] drawable mutate verify: part[12] → drawable[57] opacity now=0  ← 이게 0이 아니면 drawable mutate가 무력
```

각 로그가 어느 줄에서 끊기느냐로 정확히 어디 문제인지 진단 가능.

### Channel 1 — `setPartOpacity` (Cubism 의도된 방법)

엔진의 `beforeModelUpdate` 이벤트 안에서 호출. propagation이 직후 일어나면 우리 part opacity가 drawable로 흘러감. **단**, 모델 정의에 따라 part-drawable binding이 없으면 효과 없음.

### Channel 2 — drawable opacity Float32Array 직접 mutate (모델 무관)

같은 hook 안에서, 우리 partToDrawables 매핑을 통해 각 part 산하 drawable의 opacity Float32Array entry에 곱셈. 이 Float32Array는 native `Live2DCubismCore.Model.drawables.opacities` view라 mutate가 즉시 다음 propagation 또는 render에 반영. **모델 정의 무관하게 작동해야 함.**

`beforeModelUpdate` 시점:
- motion이 parameters에 다 썼다 (afterMotionUpdate 후)
- 우리가 (1) setPartOpacity로 part 값 강제 + (2) 현재 drawable opacities에 곱셈
- 직후 엔진이 propagation 실행: parameters → parts → drawables (우리 part 값 반영, drawable 값은 새로 계산 = 우리 channel 2 mutate가 덮어쓸 수도 있음 → next frame은 channel 1이 잡음)
- 또는 propagation이 부분적이라 우리 channel 2 mutate가 그대로 남음

어느 시나리오든 **둘 중 하나는 작동.** 둘 다 무력하면 모델 자체가 specially configured (parameter-driven only) — 그 경우 verify 로그로 즉시 식별됨.

## 검증

typecheck/lint/build 통과.

## 사용자 액션 필요

```bash
git pull && pnpm dev
# /poc/cubism 진입 → console 열고 → hide all 클릭
# 다음 정보 알려주세요:
# (a) "[Live2DAdapter] hooked beforeModelUpdate" 줄의 hasSetPartOpacity 값
# (b) hide all 클릭 시 "[Live2DAdapter] setLayerVisibility(...)" 줄이 24번 뜨는가
# (c) "[Live2DAdapter] hook fire #1, applying ..." 줄이 뜨는가
# (d) "setPartOpacity verify ... read-back=" 의 read-back 값
# (e) "drawable mutate verify ... opacity now=" 의 값
# (f) 캐릭터가 시각적으로 사라지는가
```

이 6개 데이터 포인트로 정확히 어느 채널이 어디서 막히는지 한 번에 파악 가능. 추측을 끝낼 수 있음.
