# 2026-05-13 hotfix — embedded mask format을 inpaint convention으로 + UI 컨텍스트화

**Phase / 작업**: PR #20-#22 fix (사용자 분노 반영)
**상태**: done
**관련 계획**: [../plan/01-Phase1.md](../plan/01-Phase1.md)

## 사용자 보고

> "마스크 해서 보냈는데 제대로 나오지도 않고 ... 디컴포저를 내부에
> 들어온 것 자체는 좋은데 이걸 그냥 차용하는 것 뿐이지 ... decompose
> 코드를 복사해서 Gen/MASK 모드에 걸맞게 제대로 고도화를 하든지 ...
> MASK가 제대로 됐는지 파악도 안 되고"

두 가지 문제:
1. **결과 quality 매우 낮음** — mask 그리고 generate해도 결과가 거의
   동일.
2. **UI 컨텍스트 부족** — "decompose · v1" 헤더, "save & close" 버튼,
   "HOW (MASK)" 패널의 "마스크가 칠해진 픽셀이 최종 출력에서 숨겨
   집니다" 등 전부 hide-mask 컨텍스트.

## 심층 진단 — quality 문제

[components/DecomposeStudio.tsx](../../components/DecomposeStudio.tsx)
`onSaveMask` 함수 (line 1380-1394):

```ts
out.data[i] = 0;       // R = 0 (black)
out.data[i + 1] = 0;   // G = 0
out.data[i + 2] = 0;   // B = 0
out.data[i + 3] = effective;  // alpha = 255 (hide) or 0 (preserve)
```

DecomposeStudio가 출력하는 mask PNG는 **RGB 항상 black + variable alpha**.
이건 hide-mask 컨벤션 — `setLayerOverrides`가 alpha 채널을 보고
"erase this pixel from baked atlas"로 해석.

문제: fal-general/inpainting (FLUX.1 inpainting) 은 표준 diffusion
convention = **RGB white = regenerate, RGB black = preserve**. RGB
luma 기반. 우리 mask는 RGB 항상 0 (black) → fal이 보기엔 "전체가
preserve = 아무것도 그리지 마" → 결과가 거의 동일.

이게 root cause. 사용자가 본 "거의 동일한 결과"의 정확한 이유.

## 수정 A — embedded mask format을 inpaint convention으로

`onSaveMask` 안에서 출력 직전에 두 컨벤션 분기:

```ts
const inpaintConvention = !!onMaskCommit;  // embedded mode signal

for (let i = 0; i < srcData.data.length; i += 4) {
  // ... compute `effective` (combined threshold + mask alpha) ...
  if (inpaintConvention) {
    const v = effective >= 128 ? 255 : 0;
    out.data[i] = v;       // R = white(255) or black(0)
    out.data[i + 1] = v;   // G
    out.data[i + 2] = v;   // B
    out.data[i + 3] = 255; // alpha always opaque
  } else {
    out.data[i] = 0;       // standalone: original RGB-black + variable alpha
    out.data[i + 1] = 0;
    out.data[i + 2] = 0;
    out.data[i + 3] = effective;
  }
}
```

이제 embedded 모드 (`onMaskCommit` 존재) 출력:
- 사용자 brush "칠한" 픽셀 → RGB white → fal이 "regenerate"로 인식.
- "안 칠한" 픽셀 → RGB black → fal이 "preserve".
- alpha 항상 255 (opaque) — alpha-reading 컨벤션도 호환.

standalone (DecomposeStudio 본체 modal) 흐름은 변화 0 — RGB black +
variable alpha 그대로.

## 수정 B — UI 컨텍스트화

### Header 라벨

```tsx
{embedded ? "inpaint mask · v1" : "decompose · v1"}
```

추가로 embedded mode에 `edit zone` 배지:
```tsx
{embedded && (
  <span title="이 탭에서 그리는 마스크는 fal.ai flux-inpainting 의
  edit zone 입력으로 전송됩니다 (RGB white = AI 가 다시 그림, RGB
  black = 보존). Edit MASK 의 hide-mask 와 별개 채널.">
    edit zone
  </span>
)}
```

### "save & close" 버튼

```tsx
{embedded ? "save → GEN" : "save & close"}
```

title도 동기: "save mask → return to GEN tab".

### `fullscreen` / `close` 버튼

embedded면 hide. 부모 (GeneratePanel) 가 close 처리 (GEN/MASK 탭
토글 통해).

### HOW 패널

embedded면 `<MaskHelp>` 대신 신설 `<InpaintMaskHelp>`. 텍스트:

```
How (Inpaint Mask)
- 마스크가 칠해진 영역만 AI 가 다시 그립니다 (white = regenerate).
  칠하지 않은 영역은 원본 그대로 보존.
- B 브러시 = edit zone 확장, E 지우개 = preserve 영역으로 되돌림.
  X 로 빠른 전환
- G 버킷 / W 매직 셀렉터로 컴포넌트 일부를 한 번에 선택 → AI
  재생성 영역으로 지정
- 마스크가 비어 있으면 source 알파 전체를 자동 edit zone 으로 사용
  (= 컴포넌트 전체 재생성)
- save → GEN 버튼: 마스크를 inpaint 채널 (RGB white-on-black) 로
  baked → GEN 탭으로 돌아옴
- Edit MASK 의 hide-mask 와 완전히 별개 — 상호 영향 없음
```

MaskHelp는 그대로 유지 (standalone 진입 시).

## 검증

- `pnpm typecheck` ✓
- `pnpm exec biome check` ✓ (기존 unused-var 3건 손 안 댄 곳).
- 실호출 검증: 사용자가 dev 재시작 후
  1. GeneratePanel → [MASK] 탭.
  2. 헤더 "inpaint mask · v1 · 前髪 · edit zone" 노출.
  3. 우측 HOW 패널이 "How (Inpaint Mask)" 로 바뀌고 컨텍스트 설명.
  4. 마스크 그리기 + "save → GEN" 클릭.
  5. GEN 탭으로 자동 복귀.
  6. provider fal.ai + model flux-inpainting + "white hair" → generate.
  7. **결과 머리 색이 실제로 흰색으로 바뀜** (mask convention 수정의
     직접 효과).
  8. 콘솔 `[generate] inpaint mask: user-painted in MASK tab (NNNB)`.

## 결정

1. **재사용 + 분기로 즉시 quality 회복**. 사용자는 "복사 OR 분리"
   둘 다 OK라고 했음. 이번 PR은 재사용 + props 분기 (작은 변경).
   진정한 분리 (별도 `GenMaskEditor` 컴포넌트)는 별 PR로 후속 검토 —
   이 PR로 quality 정상화부터 우선.
2. **inpaint convention = `onMaskCommit` 존재 여부**. 별도 prop을
   추가하지 않고 콜백 유무로 자연스럽게 분기.
3. **alpha threshold = 128** (binary). 향후 soft mask 필요 시 grayscale
   유지 가능 (FLUX inpainter는 soft mask도 받음). 첫 버전은 binary로
   단순화.
4. **MaskHelp는 그대로 유지**. standalone 진입 흐름 회귀 없음.
   `InpaintMaskHelp`는 별 컴포넌트로 신설.

## 영향

- MASK 탭 mask가 실제 inpaint 채널에서 동작 — quality 정상화.
- UI가 inpaint 컨텍스트로 정렬. 사용자가 "AI 가 다시 그릴 영역" 으로
  명확히 인식.
- DecomposeStudio standalone 흐름 (LayersPanel → decompose modal)
  회귀 없음.

## 후속 (백로그)

- **`GenMaskEditor` 별도 컴포넌트로 분리**. 사용자 명시 의도. 큰
  refactoring (DecomposeStudio mask mode 본체 추출 + 공통 hook 정리).
  결과 quality는 이번 PR로 회복됐으니 분리는 시급도 낮아짐. 향후
  Phase 3 작업 시 함께.
- **mask preview를 GEN 탭에서도 mini-view로**. 사용자가 mask 그렸는지
  GEN 탭에서 시각적으로 확인 가능하게.
- **mask convention 검증**. fal-general/inpainting이 RGB luma vs
  alpha 어느 쪽을 보는지 첫 호출 결과로 확정. 양쪽 다 inpaint
  컨벤션 채워두면 안전.

## 참조

- 손댄 파일 1개: `components/DecomposeStudio.tsx` (onSaveMask 분기 +
  header / 버튼 / HOW 패널 embedded 분기 + InpaintMaskHelp 신설).
- PR: 이 entry가 포함된 PR이 머지될 때 main에 들어감.
