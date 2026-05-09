# 2026-05-10 — DecomposeStudio aspect-ratio fix (canvas stretching in fullscreen / wide modal)

## 사용자 보고

```
화면이 커지거나 좌우 폭이 늘어나면 (풀스크린 하거나)
텍스처를 강제로 좌우로 늘려서 렌더링을 해버리면 어떻게 하냐
```

스크린샷: 정상이면 둥근 모양인 face/hair 텍스처가 fullscreen / 확장된 모달에서 좌우로 늘어진 타원 형태로 렌더링됨.

## 근본 원인

[`82 decompose_modal_size_and_close_guard`](2026-05-09_82_decompose_modal_size_and_close_guard.md) 의 모달 사이즈 확대 + [`81 decompose_polish_after_phase6`](2026-05-09_81_decompose_polish_after_phase6.md) 의 fullscreen backing dim 2× bump 후 발견.

canvas wrapper:
```jsx
<div className="relative inline-flex max-h-full max-w-full">
  <canvas className="max-h-full max-w-full ..." />
</div>
```

CSS 동작:
- canvas 의 intrinsic dim = backing dim (source × density). fullscreen + density=2 면 4k+ 사이즈.
- parent 의 가용 영역이 modal 안 split mode 사이드바 빼면 1700×900 정도.
- `max-w-full` cap → 1700, `max-h-full` cap → 900.
- 양 축 모두 cap 활성화 시 브라우저가 W 와 H 를 **각자** parent 한도에 맞춤. 둘 다 cap 활성화 = aspect 무시 + stretch.
- 결과: canvas element box 가 4096:2048 (2:1) 인데 1700:900 (1.89:1) 으로 squashed → bitmap drawImage 도 box 따라 stretch.

(canvas 의 intrinsic dim 이 한 축만 cap 넘으면 aspect-ratio: auto 추론으로 OK. 양축 모두 cap 활성화될 때 이 logic 깨짐.)

## 수정

source bitmap 의 aspect ratio 를 모달이 ready 될 때 state 에 캡처:
```ts
const [sourceAspect, setSourceAspect] = useState<number | undefined>(undefined);

// in load effect, after sourceCanvasRef.current = extracted.canvas:
if (extracted.canvas.width > 0 && extracted.canvas.height > 0) {
  setSourceAspect(extracted.canvas.width / extracted.canvas.height);
}
```

canvas wrapper 에 explicit `aspect-ratio` + `height: 100%; width: auto` 적용:
```jsx
<div
  className="relative max-h-full max-w-full"
  style={
    sourceAspect
      ? {
          aspectRatio: `${sourceAspect}`,
          height: "100%",
          width: "auto",
        }
      : undefined
  }
>
  <canvas className="block h-full w-full ..." />
  <svg className="absolute inset-0 h-full w-full" />
</div>
```

브라우저 layout 흐름:
1. wrapper 의 `height: 100%` → parent height 까지 fill (max-h cap 안 걸리면 그대로)
2. `aspect-ratio: A` → width = height × A
3. 그 width 가 `max-w-full` 넘으면 → width cap 적용 + height = width / A 재계산
4. 결과: parent 안에 fit 하면서 source aspect 정확히 보존

inner canvas 와 svg 는 `h-full w-full` 로 wrapper fill — wrapper aspect 가 정확하니 stretching 없음.

`inline-flex` 제거 (필요 없어짐 — wrapper 가 이제 explicit dim 가짐).

## 의도적 한계

- **fullscreen 의 backing 2× bump 유지**: aspect 보존 fix 와 별개. backing 이 커지면 sharp display 효과는 그대로. 동시 동작.
- **source 가 0×0**: theoretical 케이스. setSourceAspect 호출 가드 (W>0 && H>0). undefined 면 fallback 으로 max-w/h-full 만 — stretch 위험 있지만 0×0 source 는 어차피 안 보임.
- **레이아웃 추가 이펙트 X**: source 변경 시 한 번만 setSourceAspect. 같은 모달 안에서 layer 가 변하지 않으므로 충분.

## 검증

- typecheck 통과
- biome 통과
- `next build` 통과

## 시각 검증 가이드

```bash
git pull && pnpm install && pnpm dev

# 1. layer (예: 얼굴 — face) → DecomposeStudio
# 2. 일반 모달 → texture aspect 정확
# 3. fullscreen 토글 → modal 화면 꽉 → texture stretch X, aspect 보존
# 4. 모달 사이즈가 가로로 매우 넓어도 (3000+px wide 모니터) texture squashed 안 됨
# 5. brush paint 시 좌표가 화면 위치와 일치 (aspect 변경 없음 ⇒ click→source mapping 정확)
# 6. SAM auto 모드의 점 표시도 정확한 위치 (SVG viewBox 가 source dim, wrapper aspect 가 source aspect 매치)
```

## 남은 polish (이전 backlog 그대로)

- ResizeObserver 로 fullscreen display dim 추적 → backing dim 동적 조정 (현재 source × max(2,dpr) static)
- region drag-drop 순서
- region 색깔 사용자 변경
- empty region auto-prune
