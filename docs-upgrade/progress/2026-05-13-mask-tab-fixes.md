# 2026-05-13 hotfix — MASK 탭 색감 + GEN 탭 재렌더링 두 버그

**Phase / 작업**: PR #17 사용자 피드백 (2건의 버그)
**상태**: done (fix 적용, 사용자 재검증)
**관련 계획**: [../plan/01-Phase1.md](../plan/01-Phase1.md) +
[2026-05-13-generate-mask-tab.md](2026-05-13-generate-mask-tab.md)

## 사용자 지적

1. "Gen이랑 MASK랑 색감이 다른 이상한 현상 존재."
2. "MASK모드 -> GEN 모드로 돌아가는 경우 GEN 모드에 제대로 렌더링
   되지 않는 문제 발생."

## 문제 1 — MASK 탭 색감

원인: GenerateMaskEditor의 display 캔버스 composition이 잘못 설계
됐다. 기존 흐름은:

```js
ctx.globalAlpha = 0.35;
ctx.drawImage(source, 0, 0);      // 흐릿한 source
ctx.globalAlpha = 0.55;
ctx.drawImage(mask, 0, 0);        // white mask를 source-over로 위에
```

source-over로 white mask를 0.55 alpha로 덮으면 source 색감이 거의
다 지워져 회색으로 보임. 컴포넌트가 paint(edit zone)일 때 사용자가
"흰 머리"로 본 이유.

**수정**: source를 full opacity로 그리고 mask는 multiply blend로
overlay. white pixel = source 그대로, black pixel = darken (= preserve
영역이 어둡게 표시). 그리고 mask가 opaque이라 silhouette 밖에 검은
halo 생기는 걸 막기 위해 destination-in으로 source alpha 다시 enforce.

```js
ctx.globalCompositeOperation = "source-over";
ctx.globalAlpha = 1;
ctx.drawImage(source, 0, 0);
ctx.globalCompositeOperation = "multiply";
ctx.globalAlpha = 0.85;
ctx.drawImage(mask, 0, 0);
ctx.globalCompositeOperation = "destination-in";
ctx.globalAlpha = 1;
ctx.drawImage(source, 0, 0);
ctx.globalCompositeOperation = "source-over";
```

결과: MASK 탭에서 source가 정상 갈색으로 표시되고, erase한 영역만
어두워지면서 "AI가 안 건드림" 가시화.

## 문제 2 — GEN 탭 remount 시 source canvas 빈 상태

원인: activeTab 토글로 GEN body가 conditional render (mount/unmount)
된다. MASK → GEN 전환 시 GEN body의 `<canvas ref={sourceRef}>` 가
새 DOM 요소로 mount. 그런데 source를 그리는 useEffect의 deps가
`[ready, focusedRegionIdx, components]` — 이 값들이 안 변했으니 다시
fire 안 함. 새 canvas는 빈 상태로 남음.

RESULT 캔버스도 같은 문제.

**수정**: 두 useEffect의 deps에 `activeTab` 추가. GEN 탭 돌아올
때마다 새 canvas DOM에 다시 그림. biome가 "extra dep"이라고 잡지만
의도이므로 `// biome-ignore` 주석.

```ts
// biome-ignore lint/correctness/useExhaustiveDependencies: activeTab is intentional — forces redraw when the GEN body remounts after a MASK-tab visit
useEffect(() => {
  ...
}, [ready, focusedRegionIdx, components, activeTab]);
```

## 검증

- `pnpm typecheck` ✓
- `pnpm exec biome check` ✓
- 실호출 검증: 사용자가 dev 재시작 후
  1. GeneratePanel 열기 → SOURCE에 정상 갈색 머리 표시.
  2. [MASK] 탭 → 정상 갈색 머리 (이전엔 회색이었음).
  3. erase로 일부 paint → 그 영역만 어두워짐. 나머지는 갈색 그대로.
  4. [GEN] 탭 클릭 → SOURCE / RESULT 정상 표시 (이전엔 빈 사각형).
  5. 다시 [MASK] → [GEN] 반복해도 정상.

## 결정

1. **multiply blend가 mask visualisation 표준**. white = pass through,
   black = darken. 사용자 직관 ("preserve 영역은 어둡게 = AI 안
   건드림") 과 일치.
2. **destination-in으로 source alpha 재인장**. mask는 PNG로 silhouette
   외부도 알파 255 (opaque). multiply 후 silhouette 밖이 검은 halo로
   남는 걸 mask off.
3. **mount/unmount 그대로 두고 deps 추가**. visibility 토글 (display:
   none) 도 옵션이지만, GEN body가 큰 컴포넌트라 매 mount cost가 있고
   layout 복잡함. deps만 추가하는 게 최소 변경.
4. **mask state 보존**: GenerateMaskEditor 자체는 항상 conditional
   mount이지만 mask blob state는 GeneratePanel의 inpaintMaskBlob
   useState에 보관 → 탭 전환해도 보존.

## 영향

- MASK 탭 사용성 정상화: source 색감 보이고 edit/preserve 영역이
  시각적으로 구분됨.
- GEN ↔ MASK 자유 전환 가능. source/result canvas 재렌더링 정상.
- 다른 effect (history 로드, prompt refinement 등) 영향 없음 —
  activeTab 의존하지 않는 deps.

## 참조

- 손댄 파일 2개:
  - `components/GenerateMaskEditor.tsx` (display compose 수정)
  - `components/GeneratePanel.tsx` (source/result effect deps에 activeTab)
- PR: 이 entry가 포함된 PR이 머지될 때 main에 들어감.
