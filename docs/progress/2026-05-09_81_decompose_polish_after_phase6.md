# 2026-05-09 — DecomposeStudio polish: hydration / auto-seed / region UX / fullscreen sharpness

Phase 6 닫은 후 사용자가 보고한 4가지 이슈 일괄 처리. DecomposeStudio.tsx 한 파일 변경.

## 사용자 보고

```
일단 FullScrean에서 texture의 해상도가 깨지는 버그가 존재.
또한 Region 설정의 UX가 더 강해지면 좋겠고
Region이 기본적으로 Gen에서 쓰는 것 (auto-detect)로 미리 Region이 나눠져 있고
불필요한 Region은 제거할 수 있는 기능도 제대로 제공해야만 함.
```

스크린샷: Next.js console error — "In HTML, `<button>` cannot be a descendant of `<button>`. This will cause a hydration error." at DecomposeStudio.tsx:989.

## 수정 1 — Hydration error: nested button

split mode 의 region tile 이 outer `<button>` (selection) 안에 `<input>` + inner `<button>` (delete ✕) 를 중첩 — invalid HTML, hydration mismatch 경고.

재구조: outer 를 `<div>` 로, child 들을 sibling 으로 배치:

```jsx
<div className="flex w-full items-stretch rounded border ...">
  <button onClick={selectRegion}>color swatch + selected ●</button>
  <input value={name} onChange={rename} onFocus={selectRegion} />
  <button onClick={confirmThenDelete}>✕</button>
</div>
```

selection 은 swatch 클릭 또는 input 포커스로 모두 트리거. delete 는 confirm dialog 거쳐야 동작 ("Delete region 'X'? Painted strokes / SAM masks for this region will be lost.").

## 수정 2 — Auto-detect on first split entry

이전엔 split mode 진입 후 사용자가 "auto-detect" 버튼 명시적으로 클릭해야 region 이 검출됐음. 이젠 처음 split 진입 시 (그리고 기존 region 0개 + persisted region 0개) `findAlphaComponents` 자동 실행해 region 자동 시드.

```ts
const splitAutoSeededRef = useRef(false);

useEffect(() => {
  if (!ready) return;
  if (studioMode !== "split") return;
  if (splitAutoSeededRef.current) return;
  if (regionEntries.length > 0) return;
  if (persistedRegions.length > 0) return;
  splitAutoSeededRef.current = true;
  autoDetectRegions({ silent: true });
}, [ready, studioMode, regionEntries.length, persistedRegions.length, autoDetectRegions]);
```

`splitAutoSeededRef` 가 mount 한 번만 fire 보장. 사용자가 region 을 모두 지우고 다시 split 진입해도 재시드 안 됨 (의도적 — 사용자가 이미 결정함).

`autoDetectRegions` 에 `silent: true` 옵션 추가 — component 0개일 때 alert 안 뜸.

## 수정 3 — Region 제거 UX 강화

3가지 변경:

1. **delete confirm**: 개별 region ✕ 클릭 시 confirm dialog. "Delete region 'X'? Painted strokes / SAM masks for this region will be lost." 잘못 클릭으로 작업 잃지 않게.
2. **clear all** 버튼: regions 헤더에 빨간 outline 의 "clear all" 추가 (region ≥ 1 일 때만 표시). 모든 region 일괄 삭제 confirm.
3. **delete 버튼 시각 강화**: ✕ 버튼이 hover 시 `bg-red-500/15 text-red-300` — 명확한 destructive 시그널. tooltip 에 region 이름 포함.

## 수정 4 — Fullscreen 해상도

Preview canvas backing 이 source dim (예: 1024×800) 이면 fullscreen modal (~1500×1200 display) 에서 CSS upscale 로 흐림. 사용자가 "해상도가 깨진다" 라고 표현.

Fix: fullscreen 일 때 backing 을 `source.dim × max(2, devicePixelRatio)` 로 bump → CSS 가 약간 downscale 만 하면 돼서 sharp. Default mode 는 1× backing 그대로 (메모리 절약).

```ts
const dpr = window.devicePixelRatio || 1;
const density = fullscreen ? Math.max(2, dpr) : 1;
const targetW = Math.round(source.width * density);
const targetH = Math.round(source.height * density);
```

`drawImage(source, 0, 0, preview.width, preview.height)` 로 source bitmap 을 preview backing dim 까지 high-quality upsample. `imageSmoothingQuality = "high"` 로 브라우저가 lanczos/cubic 같은 좋은 알고리즘 선택.

trim mode 의 pixel-level alpha 합성은 imageData 에서 → tmp canvas 거쳐 drawImage 로 scaled blit (putImageData 는 scaling 안 됨).

**Brush / SAM 좌표는 source-pixel-space 유지**: backing 이 늘어나도 region/mask canvas 는 source dim 이라 paint 가 backing 좌표로 들어가면 outside 됨. 모든 mouse 좌표 변환을 `* source.width` 로 통일 (이전 `* preview.width` 였음).

SVG point overlay 의 viewBox 도 source dim 기준 (preview backing 이 더 클 수 있음).

## 의도적 한계

- **fullscreen sharpness 가 완벽한 retina 는 아님**: 사용자 viewport 가 매우 큰 모니터면 2× backing 도 부족할 수 있음. ResizeObserver 로 display size 추적해서 backing 동적 조정하면 100% sharp — 향후 polish.
- **auto-detect on first entry 가 manual region 있으면 skip**: persisted region 이 IDB 에 있으면 hydrate 우선, auto-detect 안 함. 의도된 동작 (사용자 결정 보존).
- **delete confirm 항상 띄움**: 빈 region 삭제도 confirm. 빠른 정리엔 거추장스러울 수 있음 — paint 콘텐츠 없을 때만 silent delete 도 가능. 일단 단순화.

## 검증

- typecheck 통과
- biome 통과
- `next build` 통과
- hydration error 사라짐 (nested button 해결)

## 시각 검증 가이드

```bash
git pull && pnpm install && pnpm dev

# 1. 어떤 layer 든 → DecomposeStudio
# 2. console 에 hydration error 없는지 확인 (이전: button cannot be descendant of button)
# 3. split 모드 클릭 → 자동으로 region 들이 생성됨 (auto-detect 자동 발동)
# 4. region tile 의 ✕ 클릭 → confirm 띄움 → cancel 로 취소 가능
# 5. 헤더의 "clear all" 클릭 → 모든 region 일괄 삭제 confirm
# 6. fullscreen 클릭 → modal 화면 꽉 참 + texture 가 더 sharp (이전: bilinear blur)
# 7. fullscreen 에서 brush paint → 이전 좌표 어긋났던 게 정확히 source pixel 위치에 paint
# 8. SAM auto 모드 → fullscreen 에서도 fg/bg 점이 정확한 source 위치에 record
```

## 남은 polish 후보

- ResizeObserver 로 fullscreen 의 display 사이즈에 fully-fit backing
- region tile 의 drag-and-drop 순서 변경
- region 색깔 사용자 변경 (palette pick)
- empty region (paint 0px) 자동 prune 옵션
