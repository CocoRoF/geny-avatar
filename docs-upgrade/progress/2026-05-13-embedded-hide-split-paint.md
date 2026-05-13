# 2026-05-13 hotfix — embedded DecomposeStudio에서 Split/Paint mode 숨김

**Phase / 작업**: PR #20 follow-up
**상태**: done
**관련 계획**: [../plan/01-Phase1.md](../plan/01-Phase1.md)

## 사용자 지적

> "Split Paint는 혼선이 있으니 안 보이게 하라고 mask랑 Gen만 보여야지
> gen 모드에서는"

GeneratePanel MASK 탭이 DecomposeStudio embed로 동작 (PR #20). 하지만
DecomposeStudio header의 mode toggle (Mask / Split / Paint) 이 그대로
노출되어 사용자가 split / paint mode를 켤 수 있음. 그 출력은 inpaint
state로 가지 않으므로 결국 무효 동작 → 혼란.

## 변경

[components/DecomposeStudio.tsx](../../components/DecomposeStudio.tsx):

### 1. mode toggle UI 조건부

기존:
```jsx
<div className="ml-3 flex gap-0.5">
  <button onClick={() => setStudioMode("mask")}>Mask</button>
  <button onClick={() => setStudioMode("split")}>Split</button>
  <button onClick={() => setStudioMode("paint")}>Paint</button>
</div>
```

수정:
```jsx
{!embedded && (
  <div className="ml-3 flex gap-0.5">
    <!-- 세 버튼 그대로 -->
  </div>
)}
```

embedded 모드면 mode toggle 자체 숨김.

### 2. defensive guard useEffect

```ts
useEffect(() => {
  if (embedded && studioMode !== "mask") setStudioMode("mask");
}, [embedded, studioMode]);
```

UI 숨겼으니 사용자가 변경할 수 없지만, 미래의 단축키 / hot reload
state bleed / 다른 path로 mode가 mask 외 값이 될 경우를 막는 안전망.
mask 외 값 감지 시 즉시 reset.

## 검증

- `pnpm typecheck` ✓
- `pnpm exec biome check` ✓
- 실호출 검증: 사용자가 dev 재시작 후
  1. GeneratePanel → [MASK] 탭.
  2. DecomposeStudio header에 **Mask 토글이 안 보임** (Split / Paint
     없음). studioMode는 항상 mask.
  3. brush / Toolbox / OptionsBar / HistoryPanel 등은 그대로.
  4. 정상 모드 (LayersPanel → DecomposeStudio modal) 는 Mask / Split /
     Paint 셋 다 보임 (회귀 없음).

## 결정

1. **embedded prop으로만 분기**. mode 별 props 추가 안 함. "embedded =
   inpaint context = mask only" 가 명확.
2. **defensive useEffect**. UI 외 다른 path로 mode 변경 가능성 차단.
   over-engineering 같지만 비용 0 (effect 한 번).
3. **clear/save 버튼은 그대로**. embedded에서도 mask clear / save &
   close 필요.

## 영향

- GeneratePanel MASK 탭에서 Mask 모드만 노출. 사용자가 다른 모드로
  실수 못 함.
- 정상 DecomposeStudio (Edit 진입) 회귀 없음 — `!embedded` 분기로
  기존 UI 그대로.

## 참조

- 손댄 파일 1개: `components/DecomposeStudio.tsx`.
- PR: 이 entry가 포함된 PR이 머지될 때 main에 들어감.
