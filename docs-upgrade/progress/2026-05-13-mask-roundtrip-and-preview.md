# 2026-05-13 hotfix — mask roundtrip + GEN 탭 mask preview

**Phase / 작업**: PR #23 follow-up (사용자 보고 3건 중 1+2번)
**상태**: done
**관련 계획**: [../plan/01-Phase1.md](../plan/01-Phase1.md)

## 사용자 보고 (3건)

> "1. 걍 아무것도 안하고 save → Gen 누른 뒤 다시 mask 탭으로 가면
>    전체 마스크 되어있는 이상한 현상 발생
>  2. mask를 한 뒤 save → Gen 했을 때 Gen 모드에서 마스크 된 영역을
>    볼 수 없어서 UX 구림
>  3. 결과물도 씨발 병신같음 텍스처를 제대로 바꾸는게 안 되는데"

이 PR은 1번 + 2번 처리. 3번 (character hallucination) 은 root cause
가 다른 영역 (model 자체의 atlas-crop 해석) 이라 별 PR로 분리.

## 1번 — Mask roundtrip 버그

### 원인

PR #23로 embedded 모드에서 `onSaveMask` 출력을 inpaint convention
(RGB white = edit, RGB black = preserve, alpha=255 전체)으로 변환.
이게 `inpaintMaskBlob` → GeneratePanel state로 들어감.

MASK 탭 재진입 시 GeneratePanel이 `maskBaseline={inpaintMaskBlob}`
으로 DecomposeStudio 다시 마운트. DecomposeStudio의 mask load effect
(line 398 부근):

```ts
const img = new Image();
img.onload = () => {
  ctx.drawImage(img, 0, 0, mask.width, mask.height);  // naive load
  ...
};
img.src = URL.createObjectURL(existingMask);
```

`drawImage`는 RGB + alpha를 그대로 복사. DecomposeStudio의 mask
canvas는 **알파 채널을 mask 신호로 사용** — alpha=255 전체이면 전체
프레임이 mask 표시.

→ embedded inpaint convention PNG가 alpha=255 전체이므로, 재진입 시
**전체가 mask 된 것처럼 보임**.

### 수정

mask load effect에 embedded 분기 추가. drawImage 직후 RGB luma →
alpha 채널로 재인코딩:

```ts
if (embedded) {
  const data = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < data.data.length; i += 4) {
    const luma = (data.data[i] + data.data[i+1] + data.data[i+2]) / 3;
    data.data[i] = 0;
    data.data[i+1] = 0;
    data.data[i+2] = 0;
    data.data[i+3] = luma >= 128 ? 255 : 0;
  }
  ctx.putImageData(data, 0, 0);
}
```

- Inpaint convention PNG에서 RGB white (luma 255) → alpha 255 (mask 표시).
- RGB black (luma 0) → alpha 0 (preserve, mask 표시 없음).
- 사용자가 그렸던 영역만 mask로 정확히 복원.

빈 mask 저장 후 재진입도 정상: 모든 픽셀이 RGB black → alpha 0 →
mask 없음.

## 2번 — GEN 탭 mask preview

### 추가

GeneratePanel의 SOURCE 라벨 옆에 mask thumbnail + 클릭 가능한 버튼:

```tsx
{inpaintMaskPreviewUrl && (
  <button onClick={() => setActiveTab("mask")}
          title="inpaint mask preview — click to edit in MASK tab.
                 white = AI redraws, black = preserved.">
    <img src={inpaintMaskPreviewUrl} ... />
    <span>mask · edit</span>
  </button>
)}
```

- `inpaintMaskPreviewUrl` 은 `inpaintMaskBlob`에서 `createObjectURL`
  로 derive, 매 변경 시 정확히 revoke.
- mask 그려졌으면 작은 thumbnail (20×20) + "mask · edit" 텍스트
  표시. 클릭 시 MASK 탭으로 즉시 이동.
- mask 없으면 표시 안 됨.

이로써 GEN 탭에서 한눈에:
- mask 상태 (있음/없음)
- mask 시각화 (작은 미리보기)
- 수정 진입점 (클릭 → MASK 탭)

## 검증

- `pnpm typecheck` ✓
- `pnpm exec biome check` ✓
- 실호출 검증:
  1. MASK 탭 → 그대로 save → GEN → MASK 재진입 → **전체 mask 아닌
     빈 상태로 표시** (이번 PR 핵심).
  2. MASK 탭 → brush로 일부 paint → save → GEN → SOURCE 라벨 옆에
     **thumbnail + "mask · edit" 버튼** 노출.
  3. 버튼 클릭 → MASK 탭으로 이동, 그렸던 영역만 mask로 정확히 복원
     (alpha 분기 효과).

## 결정

1. **분기 위치 = mask load**. 저장 (save) 분기는 PR #23에 있으니
   대칭으로 load 분기를 같은 prop (`embedded` / `onMaskCommit`)에
   걸음. 양방향 변환이 같은 컨디션에서.
2. **thumbnail 사이즈 20×20**. SOURCE 라벨 영역이 작아서 inline 가능
   한 크기. 클릭 가능 영역은 텍스트 포함해서 충분.
3. **revoke 정확히**. mask blob 변경 시 prev URL revoke + new URL
   생성. useEffect cleanup.

## 3번 (character hallucination) 미진행 사유

3번은 fal flux-inpainting model 자체의 prior — isolated atlas crop을
"character thumbnail" 로 해석. mask convention 문제 아님 (이미 RGB
white = edit으로 보냄). 해결 방향:

- **A. Source padding**: prepareOpenAISource의 1024² padded square +
  neutral background을 inpainting path에도 적용. 모델이 "이건 image
  일부지 character 전체가 아님" 인지하도록.
- **B. Prompt scaffold 강화**: inpainting model에도 character feature
  금지 명시. flux-2/edit에서 시도한 패턴 (PR #13) 재사용.
- **C. 다른 mask-aware model**: bria/fibo-edit 등.

별 PR로 분리. 이 PR은 1+2 가 정확히 동작하는 것에 집중.

## 영향

- MASK 탭 roundtrip 정상 — 그린 mask만 정확히 복원.
- GEN 탭에서 mask 상태가 시각적으로 명확.
- DecomposeStudio standalone 흐름 회귀 없음 (`!embedded` 분기).

## 참조

- 손댄 파일 2개:
  - `components/DecomposeStudio.tsx` — mask load 분기 + deps 갱신.
  - `components/GeneratePanel.tsx` — mask preview URL state +
    SOURCE 라벨 옆 thumbnail 버튼.
- PR: 이 entry가 포함된 PR이 머지될 때 main에 들어감.
