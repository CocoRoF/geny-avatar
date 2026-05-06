# 2026-05-06 — Cubism: Pixi ticker priority + dynamicFlags IsVisible bit

## 진단 (사용자 console 캡처)

```
[Live2DAdapter] partToDrawables: 20 parts mapped (drawables=134, parts=24, native=true)
```

좋은 소식: native handle 잡았고, 20 part가 134 drawable로 매핑됨. 4 part는 leaf grouping이라 drawable 직접 안 가짐(자손 part 통해 갖긴 갖지만 그건 별도). 이론상 hide all이 마지막에 적용되어야 하는데 사용자 시각 검증에서 무효.

→ 즉 mutate가 일어나도 render에 반영 안 됨. 두 가설:

1. **타이밍**: 우리 RAF는 Pixi 자체 RAF 후에 호출되어 *다음* frame의 model.update가 우리 mutate를 즉시 덮어씀. 매 frame 같은 race, 매번 짐.
2. **opacity 한 채널만으론 부족**: Cubism Core renderer가 `dynamicFlags`의 IsVisible bit를 먼저 검사해서 hidden drawable을 skip. opacity만 0으로 만들고 flag 안 건드리면 그래도 그림 (alpha=0인 quad).

## 수정

### (1) Pixi `Ticker`에 `LOW` priority로 등록

기존: `requestAnimationFrame` 직접 사용. Pixi ticker가 자기 RAF에 model.update를 등록해 두면 우리 RAF 호출 순서가 어디인지 보장 없음.

신규: `AvatarAdapter` 인터페이스에 옵셔널 `attachToTicker(ticker)` 추가. `Live2DAdapter`가 `app.ticker`에 `UPDATE_PRIORITY.LOW` (-25)로 callback 등록. Pixi 표준 흐름:

- `UPDATE_PRIORITY.NORMAL` (0) — engine이 자기 update를 보통 여기 등록
- `UPDATE_PRIORITY.LOW` (-25) — 우리 mutate
- `UPDATE_PRIORITY.UTILITY` (-50)
- 그 다음 renderer.render() (Application이 SYSTEM priority로 등록)

따라서 매 frame: engine update → 우리 mutate → render. 완벽한 sandwich.

`usePuppet` 훅과 `/poc/dual` 페이지가 onMount 시점에 `adapter.attachToTicker?.(app.ticker)` 호출. 옵셔널이라 SpineAdapter는 미구현(필요 없음).

RAF는 ticker 못 받았을 때만 fallback으로 유지. ticker 등록되면 RAF cancel.

### (2) `dynamicFlags` IsVisible bit 클리어

Cubism Core의 native `drawables.dynamicFlags: Uint8Array`에서 bit 0 = `csmIsVisible`. clear → renderer가 해당 drawable을 skip → 픽셀 자체 안 그림. 이게 opacity multiplier보다 강력 (early-out).

`applyOverrides`가 매 frame 양쪽 모두 mutate:
- `opacities[d] *= multiplier` (0이면 alpha=0)
- `flags[d] &= ~0x01` (0이면 IsVisible=false → skip)

둘 중 어느 쪽이든 effect 보장. 다른 빌드/버전에서 한쪽이 reset돼도 다른 쪽 살아남음.

### (3) 즉시 한 번 추가 적용

`setLayerVisibility` 호출 후 그 자리에서 `applyOverrides()` 한 번 더 호출. 다음 ticker tick까지 기다리지 않고 즉시 1 frame UI feedback.

## 검증

- typecheck/lint/build 통과
- 사이즈 변동 미미

## 시각 + 콘솔 진단 (사용자)

이번엔 진짜로 hide all 시 캐릭터 가시 영역이 사라져야 함.

만약 그래도 안 되면:
- `partToDrawables: 0 mapped` → engine이 native handle을 또 다른 경로에 둠 (재진단)
- `partToDrawables: N mapped`이고 안 됨 → `drawables.dynamicFlags`도 view가 아닌 사본일 가능성. 그 경우 `coreModel._model.update()` 강제 호출 또는 engine 자체 hook 사용 필요.

## 다음

이번에 hide all 작동하면 → Phase 1.3 진입.
