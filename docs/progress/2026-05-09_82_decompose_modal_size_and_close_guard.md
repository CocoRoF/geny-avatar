# 2026-05-09 — DecomposeStudio modal: bigger default + dirty close guard

사용자 보고:

```
모달 사이즈 자체가 너무 작아서 편집 모달을 사용하는 것 자체가 너무 불편해.
크기를 키우고 사용감을 아주 강력하게 개선해야만 해.
편집 도중 close나 밖을 클릭하면 꺼지는 것도 매우 불편해.
이 경우 반드시 저장되지 않은 정보가 사라질 수 있음을 사용자에게 경고하는 toast가 뜨든 뭘 하든 해야할거야.
```

## 수정 1 — 디폴트 사이즈 확대

이전:
```
fullscreen ? "h-screen w-screen" : "h-[90vh] w-[min(90vw,1100px)]"
```

이후:
```
fullscreen ? "h-screen w-screen" : "h-[95vh] w-[min(96vw,1800px)]"
```

- 높이: 90vh → 95vh
- 너비: min(90vw, 1100px) → min(96vw, 1800px)

수치 비교:
- 1080p (1920×1080): 1100 → 1800 (+64%) — 95% 폭 사용
- 4K (3840×2160): 1100 → 1800 (capped) — 더 키울 수 있게 fullscreen 토글
- ultra-wide: 1100 → 1800 (capped) — 너무 안 늘어나게

평소 작업에 충분히 큰 사이즈, fullscreen 은 끝까지 쓰고 싶을 때 토글.

## 수정 2 — dirty close guard

이전: header "close" / overlay backdrop click / Esc 모두 `close(null)` 직접 호출 → 작업 도중 실수 클릭 한 번에 paint / region / SAM mask 모두 사라짐. "save & close" 버튼 따로 누르지 않으면 silent loss.

이후: `requestClose` 헬퍼가 모든 dismiss path 의 게이트키퍼:

```ts
const requestClose = useCallback(() => {
  const isDirty = studioMode === "trim" ? dirty : splitDirty;
  if (!isDirty) {
    close(null);  // 깨끗하면 그대로 닫기
    return;
  }
  const ok = window.confirm(
    "You have unsaved changes — painted strokes, regions, or SAM masks haven't been saved.\n\n" +
      "Click OK to discard and close.\n" +
      "Click Cancel to keep editing (then use 'save & close' to keep your work).",
  );
  if (ok) close(null);
}, [studioMode, dirty, splitDirty, close]);
```

호출 지점:
1. **Header "close" 버튼** — 명시적 닫기
2. **Modal 외부 backdrop button** (`absolute inset-0`) — 모달 밖 click
3. **Esc 키** — `useEffect` 의 keydown listener

세 path 모두 동일 guard 거침. `dirty || splitDirty` 가 true 면 경고 dialog 띄우고 user 가 OK 해야만 닫힘. Cancel = 모달 유지.

저장 success 후 호출되는 `close(null)` (line 485, 755) 는 wrap 안 함 — save 가 dirty flag 비울 시점이라 어차피 빈 confirm. 직접 close 가 더 정확.

## 의도적 한계

- **window.confirm 은 native dialog**: toast 같은 인라인 UI 보다 거칠지만 hard block 효과 강력. 후속 polish 가능: 헤더 아래 인라인 banner + 3-way "save & close / discard / cancel".
- **두 모드의 dirty flag 분리**: trim 모드의 `dirty` 와 split 모드의 `splitDirty` 별개. 한 모드에서 변경 후 모드 토글하면 다른 모드 dirty 체크 안 들어감 — 하지만 mode 토글 자체는 close 가 아니므로 OK.
- **save & close 버튼은 wrap 안 함**: save handler 가 close(null) 직접 호출. 저장 성공 = dirty flag 가 다음 render 에 false 됨. wrap 시 동일 동작이지만 race 방지 위해 직접 close.
- **min(96vw, 1800px)**: ultra-wide / 4K 에선 1800 cap. 모니터 매우 크면 fullscreen 토글로 100% 사용. 일반 데스크탑은 96vw 가 dominant.

## 검증

- typecheck 통과
- biome 통과
- `next build` 통과

## 시각 검증 가이드

```bash
git pull && pnpm install && pnpm dev

# 1. layer → DecomposeStudio
# 2. 모달이 이전보다 훨씬 큼 (1080p 에서 거의 viewport 꽉)
# 3. trim 모드: brush 로 paint → unsaved 보임
# 4. close 클릭 → confirm dialog: "Click OK to discard and close..."
#    - Cancel: 모달 유지
#    - OK: paint 잃고 닫힘
# 5. esc 키 / 모달 밖 click 도 동일 confirm
# 6. save & close 누르면 confirm 없이 즉시 저장 + 닫힘
# 7. split 모드 변경 + paint → close → 동일하게 confirm
# 8. 변경 없을 때 close → confirm 없이 즉시 닫힘
```

## 남은 polish

- 인라인 toast / banner UX (window.confirm 보다 부드러움)
- "save & close 후 닫기" / "discard 후 닫기" 3-way 선택
- modal 사이즈 사용자 선호 저장 (localStorage 로 last-known)
