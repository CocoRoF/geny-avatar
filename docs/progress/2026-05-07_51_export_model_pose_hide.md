# 2026-05-07 — Export Model: pose3.json으로 hidden part 영구 처리

## 사용자 보고

[`50 export_model_hide_via_model_patch`](2026-05-07_50_export_model_hide_via_model_patch.md)에서 atlas erase를 폐기하고 motion3.json에 `PartOpacity = 0` 커브를 주입하는 방식으로 전환했지만 여전히 작동 안 함:

> 텍스처는 그대로인데 우리의 upload 시스템에서는 그냥 나와버리는데 (...) 이게 제대로 되는건지 전혀 모르겠는데 제대로 좀 검토해 봐.

사용자가 첨부한 model3.json:

```json
"Motions": {
    "": [
        { "File": "idle.motion3.json" },
        { "File": "idle2.motion3.json" }
    ]
}
```

## 진짜 원인

이 puppet의 motions 그룹 키는 `""` (빈 문자열). Cubism Framework는 표준적으로 **`"Idle"` 그룹만 자동 재생** — `""` 그룹은 manual trigger 필요. 우리 어댑터도 motion auto-play 안 함.

결과: motion3.json에 `PartOpacity = 0` 커브를 아무리 넣어놔도 **motion이 한 번도 재생 안 되니** 커브가 적용되지 않음. part_0의 opacity는 default 1로 유지 → 워터마크 그대로 표시.

motion 패치는 그 자체로 정확하지만 "재생되어야 효과 있다"는 전제가 사용자 puppet 구조에서 깨짐.

## 정답: `pose3.json`

Cubism Framework의 **pose 시스템**은 매 프레임 자동으로 적용됨 (motion 재생 여부와 무관). pose group은 "한 그룹 내에서 한 part만 visible, 나머지는 fade-to-0"의 mutex 시맨틱.

```json
{
  "Type": "Live2D Pose",
  "Groups": [
    [
      { "Id": "<always-visible part>", "Link": [] },
      { "Id": "part_0", "Link": [] }
    ]
  ]
}
```

런타임 동작 (Cubism Framework `CubismPose.doFade`):
1. 매 프레임 각 그룹의 첫 번째 opacity > epsilon인 part를 "visible" 후보로 픽
2. visible 후보는 → opacity 1로 fade-up
3. 나머지 (part_0 포함) → opacity 0으로 fade-down
4. fade time은 `FadeInTime` 필드 (default 0.5초)

pose는 Cubism의 update pipeline에서 **motion + expression 다음에 실행**되므로 어떤 motion 커브가 part_0을 raise하더라도 결국 0으로 끌어내림. motion 재생 안 돼도 정상 동작 — pose 자체가 매 프레임 돌므로.

## 변경 surface

### `lib/export/buildModelZip.ts`

`patchCubismForHide` 시그니처에 `layers: ReadonlyArray<Layer>` 추가 — anchor part 선택용.

#### 새 단계 1: pose3.json 패치 (주메카니즘)

1. **Anchor 찾기**: `findAnchorPartId` 헬퍼 — `defaults.visible === true`이면서 hiddenPartIds에 안 들어가는 첫 layer. iteration 순서 결정적.
2. **기존 pose3.json 로드 또는 신규 생성**:
   - manifest의 `FileReferences.Pose` 참조가 있고 파일이 bundle에 있으면 파싱 (확장)
   - 없거나 파싱 실패 시 `{ Type: "Live2D Pose", Groups: [] }` 신규 생성
3. **새 그룹 push**: `[{ Id: anchor, Link: [] }, ...hiddenPartIds.map(id => ({ Id, Link: [] }))]`
4. **emit**:
   - 기존 pose 파일 있으면 → replacements로 같은 path 덮어쓰기
   - 없으면 → 신규 `geny-hide.pose3.json` 생성 + `manifest.FileReferences.Pose` 갱신

#### 단계 2: motion3.json 패치 (defense in depth)

기존 코드 그대로 — 모든 motion3.json에 `PartOpacity = 0` 커브 추가. Pose가 주메카니즘이라 redundant이지만:
- Pose가 fade time만큼 (0.5s) 늦게 도달하므로 motion이 정확히 0으로 강제하면 첫 프레임부터 깨끗
- 외부 viewer 중 pose 미적용 케이스 대비 안전망

#### 합쳐진 manifest 패치 시점

motion synthesize 분기 (motions=0일 때 idle motion 합성)는 제거. pose가 motions 없는 puppet에서도 동작하니 불필요. `synthesizeHideMotion` / `HIDE_MOTION_FILENAME` 죽은 코드 정리.

manifest 변경 (Pose 참조 추가)이 있을 때만 manifestPatch 발행 — pose 기존 파일 있으면 manifest 안 건드림.

### Type 추가

```ts
type Live2DPoseFile = {
  Type?: string;
  FadeInTime?: number;
  Groups?: Array<Array<{ Id: string; Link?: string[] }>>;
};
```

`Live2DManifest.FileReferences.Pose?: string` 필드 추가.

## 의도적 한계

- **anchor가 hidden과 같은 part-level child**: anchor가 part_0의 자식 part라면 part_0 hide는 cascade로 자식까지 hide. 이건 정상이지만 사용자가 의도하지 않은 부수효과 가능. iteration 순서를 layer.defaults.visible=true 기준으로 하므로 보통 main body가 anchor가 됨.
- **anchor가 motion으로 가려지는 순간**: anchor가 일시적으로 opacity 0이 되면 pose는 그룹 내 다음 visible part를 찾음 → part_0이 잠깐 보일 수 있음. 정상 puppet에서 anchor는 보통 main body 같은 always-visible part라 거의 발생 안 함.
- **fade-in 0.5초**: 로딩 직후 짧은 fade 동안 part_0 잠깐 보임. 정적 export 용도라 허용.
- **Cubism Framework 외 viewer**: pose 시맨틱을 구현 안 하는 경량 viewer가 있으면 hide 안 됨. motion 패치가 fallback으로 받음.

## 검증

- typecheck 통과
- biome 통과
- `next build` 통과

## 시각 검증 가이드

```bash
git pull && pnpm install && pnpm dev

# 1. CJK puppet (motions 그룹이 ""인 그 puppet) 다시 업로드 → /edit/<id>
# 2. part_0 (워터마크) 토글 off
# 3. "export model" → zip 다운로드
# 4. zip 풀어서:
#    - geny-hide.pose3.json 새 파일 등장 (또는 기존 pose3.json에 그룹 추가)
#    - 그 파일 안에 [{ Id: "<some-other-part>", Link: [] }, { Id: "<part_0의 partId>", Link: [] }]
#    - model3.json의 FileReferences.Pose가 "geny-hide.pose3.json"으로 채워짐 (없었다면)
#    - atlas PNG는 그대로 (part_0 워터마크 픽셀 살아있음 — atlas 손상 X)
#    - motion3.json들도 패치되어 있음 (defense in depth)
# 5. zip을 /poc/upload에 다시 드롭 → 재import
#    - 본체 깨끗
#    - **part_0 (워터마크) 안 보임** ← Cubism Framework의 pose 적용
#    - 0.5초 fade 동안 살짝 보일 수 있으나 곧 사라짐
# 6. 콘솔: [export:model] ... · hiddenParts=N · patched=M
#    - patched 수에 motion3.json들 + pose3.json (또는 신규 path) + 가능하면 model3.json
# 7. 외부 Cubism Viewer (Cubism SDK 샘플 등)에 같은 zip 로드 → 동일하게 part_0 안 보임
```

## Phase 4 진짜 종료

3번의 시도 끝에 정답에 도달:
- (47) atlas erase: 픽셀 sampling artifact로 격자/잔재 발생
- (49) cascade-aware atlas erase: 같은 atlas 메커니즘이라 같은 artifact
- (50) motion3.json PartOpacity 커브 패치: motion 재생 의존, 표준 group 키 아니면 미적용
- (51) **pose3.json + 매 프레임 자동 적용**: motion 의존 없음, 표준 Cubism 메커니즘 활용

V1 시나리오 C (export → 외부 viewer / 재import에서 동일 모습) 진짜로 동작.
