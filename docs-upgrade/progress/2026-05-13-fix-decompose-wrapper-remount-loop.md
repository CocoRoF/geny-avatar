# 2026-05-13 hotfix — DecomposeStudio Wrapper 인라인 컴포넌트가 만든 무한 setState 루프

**Phase / 작업**: PR #20 hotfix (Maximum update depth)
**상태**: done
**관련 계획**: [../plan/01-Phase1.md](../plan/01-Phase1.md)

## 사용자 보고

```
Runtime Error
Maximum update depth exceeded. This can happen when a component
repeatedly calls setState inside componentWillUpdate or
componentDidUpdate. React limits the number of nested updates to
prevent infinite loops.

at DecomposeStudio.useCallback[setPreviewRef]
   (components/DecomposeStudio.tsx:157:5)
```

GeneratePanel을 열기만 해도 (또는 MASK 탭 진입 시점에) React가
무한 setState로 가드 발동.

## 심층 조사

콜백 ref 자체는 `useCallback(..., [])` 로 identity 안정. 정상이면
element가 mount/unmount될 때만 호출되어야 함:

```ts
const setPreviewRef = useCallback((el: HTMLCanvasElement | null) => {
  previewRef.current = el;
  setPreviewEl(el);
}, []);
```

그런데 무한 호출이라는 사실 = canvas DOM이 **매 render마다 새로
mount/unmount된다**는 뜻.

원인 추적 → PR #20에서 추가한 `<Wrapper>` 컴포넌트가 범인.

```ts
const Wrapper = embedded
  ? ({ children }) => <div ...>{children}</div>
  : ({ children }) => <div className="fixed inset-0 ..."> ... </div>;

return <Wrapper>{ ... body ... }</Wrapper>;
```

React 입장에서 `Wrapper`는 매 render마다 **새 함수 인스턴스**.
component type identity로 reconcile하는데 그 type이 매번 바뀌니
React는 "어 다른 컴포넌트로 교체됐네" 판단 → 전체 sub-tree를
**unmount + remount**. 그 안의 canvas도 새 DOM element로 매번 새로
attach. callback ref가 매번 호출 → `setPreviewEl` 호출 → state 변경
→ re-render → 또 새 Wrapper instance → 또 unmount + remount →
무한 루프.

추가 부작용: `useEffect`들도 매 render마다 재실행, BrushCursor가
canvas attach/detach 반복, 모든 mount-time 작업이 무한 재실행. 사용자
입장에선 빈 화면 + React 가드 에러만 보임.

이건 React의 잘 알려진 함정 — 컴포넌트 안에서 컴포넌트를 정의하면
안 되는 이유. 공식 문서 "[Optimizing Performance](https://react.dev/learn/you-might-not-need-an-effect#don-t-nest-components)"
에 같은 패턴이 anti-pattern으로 명시.

## 수정

[components/DecomposeStudio.tsx](../../components/DecomposeStudio.tsx)
의 Wrapper 정의 제거. body JSX를 `inner` const에 fragment로 묶고
return에서 ternary로 wrapping 분기:

```tsx
const inner = (
  <>
    <header ...>...</header>
    ...body...
  </>
);

return embedded ? (
  <div className="flex h-full min-h-0 w-full flex-col">{inner}</div>
) : (
  <div className="fixed inset-0 z-40 ...">
    <button aria-label="close" onClick={requestClose} ... />
    <div className="relative z-10 ...">{inner}</div>
  </div>
);
```

핵심:
- Wrapper 함수 정의 사라짐 — React는 매 render마다 같은 wrapping
  JSX type (`div`)을 보고 reconcile에 성공. DOM tree 안정.
- `inner` 변수는 JSX element 트리. 매 render마다 새 element 객체지만
  type identity (header / div / canvas 등) 동일 → React 가 동일 DOM
  유지.
- callback ref `setPreviewRef`는 canvas element가 실제로 변할 때만
  호출 → 무한 루프 해소.

## 검증

- `pnpm typecheck` ✓
- `pnpm exec biome check` ✓ (기존 unused-var 경고 3건은 손 안 댄
  곳).
- 실호출 검증: 사용자가 dev 재시작 후
  1. LayersPanel → DecomposeStudio 정상 modal로 진입 (standalone).
  2. GeneratePanel → [MASK] 탭 → DecomposeStudio inline embed.
  3. 두 경로 모두 무한 setState 없이 정상 mount, brush 동작.

## 결정

1. **인라인 컴포넌트 정의는 절대 사용 안 함**. 이번 PR로 명확히
   깨달음 — function 안에서 `const Foo = (props) => <jsx/>` 같은
   패턴은 React에서 매 render마다 새 type이라 무한 remount.
   ternary JSX 또는 module-level 함수만 사용.
2. **`inner` 변수 이름**. body가 변수 할당이면 가독성 향상. 두 wrap
   분기에서 동일 fragment 사용.
3. **컴포넌트 함수 안에 컴포넌트 정의 lint rule 검토**. 미래 회귀
   방지를 위해 `react/no-unstable-nested-components` 같은 룰을
   biome에 추가하면 좋음. 이번 PR 범위 외, 후속 백로그.

## 영향

- 사용자 환경에서 GeneratePanel 정상 동작 회복.
- DecomposeStudio standalone modal 영향 없음 (분기 둘 다 같은 inner
  사용, 같은 동작).
- PR #20/#21의 의도 (embedded mode + Split/Paint 숨김 + Mode guard)
  는 그대로 보존.

## 참조

- 손댄 파일 1개: `components/DecomposeStudio.tsx`.
- PR: 이 entry가 포함된 PR이 머지될 때 main에 들어감.
