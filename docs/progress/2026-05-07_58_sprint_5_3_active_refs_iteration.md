# 2026-05-07 — Sprint 5.3: Active references + iterative anchor

[`57 sprint_5_2`](2026-05-07_57_sprint_5_2_multi_image_input.md)이 모든 puppet ref를 자동으로 image[]에 흘려넣는 baseline을 깔았다. 이번 sprint은 사용자가 **이번 generation에 어떤 ref를 쓸지** 결정할 수 있는 selection UX + **연속 실행 시 직전 결과를 다음 ref로 자동 포함**하는 iterative refinement.

사용자가 5.0에서 못박은 핵심 요구:
> 우리는 레퍼런스가 [사용자가 원하는 사진] + [현재 Texture] 연속 실행시 이전 명령을 바탕으로 어떻게 변하는 것이 올바른지 이런 것들을 제대로 처리해야 한다고 생각해.

세 채널로 정리:

| 채널 | 슬롯 | 처리 |
|---|---|---|
| 현재 Texture | image[0] | source layer canvas — Sprint 3.x부터 자동 |
| 사용자가 원하는 사진 | image[1...n] (puppet refs) | 5.1 store + 5.2 multi-input + **5.3 selection** |
| 직전 명령 결과 | image[n+1] (iteration anchor) | **5.3 자동 포함 + 토글** |

## 변경 surface

### `GeneratePanel` state 추가

```ts
// puppet refs 중 사용자가 OFF한 것들. default ON.
const [disabledRefIds, setDisabledRefIds] = useState<Set<string>>(new Set());

// iterative anchor: 직전 succeeded result를 ref로 보낼지.
const [useLastResult, setUseLastResult] = useState(true);
const [lastResultBlob, setLastResultBlob] = useState<Blob | null>(null);
```

`disabledRefIds`는 session-only state — 패널 닫으면 휘발. 사용자의 disable은 보통 "이번 한 번만 빼자"라는 micro-decision이라 영구화 부적합.

`useLastResult`는 default ON. 첫 generate은 lastResultBlob이 null이라 영향 없음. 두 번째부터 직전 결과가 자동 ref로.

### `lastResultBlob` 자동 capture

```ts
useEffect(() => {
  if (phase.kind === "succeeded") {
    setLastResultBlob(phase.blob);
  }
}, [phase]);
```

phase가 succeeded될 때마다 갱신. failed로 돌아가도 lastResultBlob은 안 비움 — 사용자가 prompt 살짝 바꿔서 retry할 때 직전에 잘 됐던 것을 그대로 anchor로 쓰는 게 자연스러움.

### `activeRefBlobs` 재정의

```ts
const activeRefBlobs: Blob[] = supportsRefs
  ? [
      ...references.filter((r) => !disabledRefIds.has(r.id)).map((r) => r.blob),
      ...(useLastResult && lastResultBlob ? [lastResultBlob] : []),
    ]
  : [];
```

순서 중요 — gpt-image-2가 image[] 앞쪽 entry를 더 강한 anchor로 취급. 사용자의 명시적 puppet refs를 먼저, iterative anchor를 뒤에 배치 → puppet refs가 character identity를 잡고, last result는 "방금 만든 이걸 살짝 다듬어"라는 nudge.

### Active references UI

prompt textarea와 generate 버튼 사이에 박스로 노출:

- 헤더: "Active references (M/N)" + sent as image[]... 힌트
- 각 puppet ref 행: 체크박스 + name (truncate) + 사이즈
  - disabled 상태는 line-through + dim 색
- last result anchor (있으면): 체크박스 + "last result · iteration anchor" italic accent + 사이즈
- 모두 OFF 시 ref 0개로 generate (image[0] 만)
- supportsRefs=false provider이면 기존 fallback 메시지 그대로 ("stored, but {provider} doesn't accept...")

### Diagnostic 강화

5.2의 `[ai/submit]` 그룹 로그가 각 ref slot에 source 표기 추가:

```
references (2): [
  { slot: "image[1]", source: "puppet ref",                  name: "anchor.png",  ... },
  { slot: "image[2]", source: "iteration anchor (last result)", name: "last-result", ... },
]
```

## 의도적 한계

- **History row → ref pin 미구현**: 과거 history entry를 ref로 끌어쓰는 액션은 5.4 또는 별도 polish. 현재는 "직전 한 번"만 iterative anchor로 사용.
- **disabled state 영구화 X**: session-only. 다음 panel open 시 모두 ON으로 복귀.
- **anchor 순서 사용자가 못 바꿈**: 항상 (puppet refs) → (last result). 사용자가 직접 순서 조정 못함. 검증 후 수요 있으면 drag-reorder 도입 가능.
- **Last result clear 버튼 X**: 토글만 가능. 명시적 forget 액션은 polish 항목.
- **Provider 미지원 시 last-result도 같이 비활성**: gemini/replicate에서 last result도 ride-along 안 됨. supportsRefs gate 동일 적용.

## 검증

- typecheck 통과
- biome 통과
- `next build` 통과

## 시각 검증 가이드

```bash
git pull && pnpm install && pnpm dev

# 1. References 2장 업로드된 puppet으로 진입, 임의 layer에 gen
# 2. Active references 박스 등장 — 두 ref 모두 체크된 상태
#    "Active references (2/2)" 헤더 + sent as image[] 힌트
# 3. 한 ref 체크 OFF → "(1/2)" 갱신 + 그 ref name이 line-through
# 4. prompt 입력 → generate
#    - 콘솔 [ai/submit] 그룹에서 references 1개만 표시 (puppet ref source)
#    - 결과 OK
# 5. 결과가 succeeded되면 Active references 박스에 "last result · iteration anchor"
#    체크박스 등장 (default ON, accent 색)
# 6. prompt 살짝 바꿔서 다시 generate
#    - [ai/submit] 그룹: refs 2개 (puppet ref + iteration anchor),
#      slot[2] source="iteration anchor (last result)" 식
#    - [openai] image[] 3 entries 로그 (source + ref + last-result)
# 7. last result 토글 OFF → 다시 generate → puppet ref만 ride along
# 8. 모든 ref OFF → image[]에 source만 (1 entry)
# 9. provider를 Gemini로 바꾸면 active refs 박스가 fallback 메시지로 변경
```
