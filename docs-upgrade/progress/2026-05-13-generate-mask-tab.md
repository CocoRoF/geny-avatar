# 2026-05-13 Phase 1.x — GeneratePanel에 GEN/MASK 탭 + 별도 inpaint mask 에디터

**Phase / 작업**: Phase 1.x (PR #16 사용자 피드백 반영)
**상태**: done
**관련 계획**: [../plan/01-Phase1.md](../plan/01-Phase1.md) +
[2026-05-13-inpaint-mask-from-source-alpha.md](2026-05-13-inpaint-mask-from-source-alpha.md)

## 사용자 지적

> "Edit 모드에서 MASK를 처리하면 해당 Component가 안 보이게 적용되는
> 기능이 있잖아 에당초 다른 기능이고 다른 방식으로 존재해야 한다고
> gen 모드에서 gen을 위한 마스크를 편집할 수 있는 공간이 존재해야하는
> 거고 gen에서 마스크를 씌운뒤 그것을 제대로 LLM한테 전달하는 방식
> 으로 동작해야 한다고 즉 Gen 모드에도 GEN TAB과 MASK 탭이 존재해야
> 하는거고"

핵심:
- 두 mask 의미가 다르므로 인터페이스 자체를 분리해야 한다.
- GeneratePanel 안에 GEN 탭 + MASK 탭.
- MASK 탭에서 사용자가 inpaint mask를 직접 그림.
- 그린 mask가 generate 호출에 전달.

## 변경

### 신설 [components/GenerateMaskEditor.tsx](../../components/GenerateMaskEditor.tsx)

Self-contained brush component (~370 LOC):

- **두 canvas**: 디스플레이 (사용자 시야) + 오프스크린 mask (source-
  of-truth, native source dims).
- **도구**: paint (edit zone 확장) / erase (preserve 영역 확장).
- **브러시 크기**: 2-160 px 슬라이더.
- **버튼**: fill all (whole component) / clear / invert.
- **포인터 이벤트**: pointerDown/Move/Up + pointer capture로 drag
  안정성.
- **stroke segment**: lineTo로 빠른 drag도 끊김 없음.
- **commit on pointerUp**: stroke 끝날 때마다 toBlob → onChange 콜백.
- **출력 컨벤션**: RGB white = edit, RGB black = preserve, alpha 255
  (FLUX/SDXL 표준). alpha / luma 양쪽 호환.
- **초기 시드**: source의 alpha 채널에서 derive (opaque pixel → white).
  사용자가 별도 그리지 않으면 전체 컴포넌트가 edit zone.

문서 코멘트에 "DecomposeStudio mask와 의미가 다르다"는 핵심 디자인
이유 명시.

### 수정 [components/GeneratePanel.tsx](../../components/GeneratePanel.tsx)

- `activeTab: "gen" | "mask"` state.
- `inpaintMaskBlob: Blob | null` state — MaskEditor의 commit callback
  으로 갱신.
- 헤더에 탭 버튼 추가. MASK 탭에 mask 그려진 상태일 때 작은 dot
  indicator.
- body 조건부 렌더:
  - `activeTab === "gen"` → 기존 source/result/control body.
  - `activeTab === "mask"` → `<GenerateMaskEditor>`.
- `onSubmit` 의 inpaint mask 결정 로직:
  1. **MASK 탭에서 사용자가 그린 mask가 있으면 그것 우선**.
  2. 없으면 source alpha에서 auto-derive (PR #16 흐름 유지).
  3. DecomposeStudio mask는 inpaint에 forward 안 함 (PR #16과 동일).
- 콘솔 로그가 두 케이스 구분: `user-painted in MASK tab` vs `derived
  from source alpha`.

## 검증

- `pnpm typecheck` ✓
- `pnpm exec biome check` ✓
- 실호출 검증: 사용자가 dev 재시작 후
  1. GeneratePanel 열기.
  2. 헤더의 [MASK] 탭 클릭.
  3. brush로 일부 영역만 paint (예: 머리 앞부분).
  4. [GEN] 탭으로 돌아옴.
  5. provider "fal.ai FLUX" + model "FLUX.1 inpainting" 선택.
  6. prompt "white hair" → generate.
  7. 콘솔에 `[generate] inpaint mask: user-painted in MASK tab (NNNB)` 노출.
  8. 결과: 사용자가 paint한 영역만 흰색으로 변경, erase한 영역은 원본 보존.

mask 그리지 않고 inpainting 호출 → 콘솔에 `derived from source
alpha` 로 fallback.

## 결정

1. **DecomposeStudio mask와 완전히 분리된 UI**. 헤더에 명시적 탭으로
   두 mask 컨벤션 헷갈리지 않게 격리. DecomposeStudio는 hide,
   Generate MASK 탭은 edit zone — surface 부터 다름.
2. **mask state는 component-local useState**. IDB persistence 없음.
   layer 닫고 다시 열면 reset. 한 편집 세션 단위가 자연.
3. **fill-all 시드 = source alpha**. "처음 MASK 탭 열었을 때 = 전체
   컴포넌트가 edit zone" 이라는 자연 기본값. 사용자가 그 위에서 erase
   하거나 paint하는 흐름.
4. **brush 단순화**. opacity, hardness, undo는 후순위. PR 분량 통제 +
   초기 mask 도구가 dense하지 않아도 핵심 의도 충족. 후속에서
   DecomposeStudio brush 코드를 ref로 강화 가능.
5. **MASK 탭 indicator**. 헤더 탭 옆 작은 dot — mask가 user-painted
   상태인지 한눈에 보임. ("기본 alpha vs 사용자 mask" 구분).
6. **biome useExhaustiveDependencies 예외**. pointer handlers가
   eventToMaskCoords를 호출하는데, 그게 ref만 읽으므로 deps에 포함하면
   불필요. inline `// biome-ignore` 주석.

## 영향

- GeneratePanel UX:
  - GEN 탭 → 기존 그대로.
  - MASK 탭 → 신규. inpainting model 사용 시 정밀 제어 가능.
- inpaint mask 전체 흐름:
  - 사용자 명시 paint 있음 → 그것 사용.
  - 없음 → source alpha auto-derive (PR #16).
  - 두 경로 모두 inpainting model 외에선 적용 안 됨 (`flux-inpainting`
    선택 시만).
- DecomposeStudio mask는 본연의 destination-out hide 용도 그대로,
  Generate 흐름에 forward 안 함 (PR #16과 동일).

## 후속 (백로그)

- **MASK 탭 brush 강화**: undo/redo (Decompose의 history hook 재사용),
  opacity, hardness, magic wand 통합.
- **mask preview를 GEN 탭에서도 mini-view로**: GEN 탭 source 위에
  현재 mask 윤곽 표시.
- **flux-2/edit에도 mask 적용 옵션**: flux-2/edit는 mask channel 없지만
  prompt scaffold에 "edit only the white region of [image 2]" 를
  넣고 mask를 image[1]로 보낼 수 있는 실험.

## 참조

- 손댄 파일 3개 (신설 1 + 수정 2):
  - `components/GenerateMaskEditor.tsx` (신설)
  - `components/GeneratePanel.tsx` (탭 UI + state + onSubmit)
  - (없음 — `lib/avatar/inpaintMask.ts`은 PR #16에서 그대로)
- PR: 이 entry가 포함된 PR이 머지될 때 main에 들어감.
