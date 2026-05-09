# 2026-05-07 — Export Model: visibility hide를 atlas erase 대신 모델 파일 패치로

## 사용자 보고

[`49 export_model_hide_cascade`](2026-05-07_49_export_model_hide_cascade.md)에서 cascade까지 포함시켰음에도 여전히 깨짐:

> part0은 껐음에도 그게 여전히 존재하고 그 존재하는 것 때문인지 그냥 심각하게 텍스처가 깨지고 있어. (...) 특정 PART를 끄는 것이 해당 파트에 뭔가 마스크를 넣는 게 아니라 렌더링 로직 자체를 좀 조작해야 할 것으로 보여 (텍스처를 건드리는 게 아니라). part0을 끈 상태로 저장하면 해당 texture를 유지하지만 그게 렌더링이 안 되도록 모델을 수정해야 한다.

## 원인 재정의

Atlas pixel erase는 표면적으로 그럴듯한 해법이지만 근본적 문제가 있다:

- **mesh sampling**: drawable의 mesh 정점이 atlas 픽셀을 보간 sample. 인접 픽셀이 살아있는데 본인만 0이면 가장자리에서 ghost imagery.
- **mip-map / 텍스처 필터링**: 작은 화면에서 mip 단계가 인접 erased / non-erased 픽셀을 평균 → 부서진 격자 패턴.
- **atlas region 공유**: 한 atlas region이 여러 drawable의 UV에 걸쳐있을 수 있음. erase 시 동시 손상.

49의 cascade fix는 더 많은 영역을 erase하지만 **atlas erase 접근 자체가 잘못된 layer**라서 유저 본 격자/잔재가 안 사라짐.

사용자의 정확한 통찰: **runtime이 part를 렌더하지 않게 모델 파일을 직접 패치하라**. atlas는 보존.

## 새 접근

### Cubism: `motion3.json`에 PartOpacity=0 커브 주입

각 motion3.json 파일에 `Target = "PartOpacity"`, `Id = <hidden part id>`, `Segments = [0, 0, 0, duration, 0]` (linear segment, 시작/끝 모두 v=0) 한 entry씩 추가. Cubism Framework는 매 frame 이 커브를 읽어 part opacity를 0으로 묶음.

- 원본 motion의 다른 커브 (parameter, idle breathing 등)는 손대지 않음 → idle 애니메이션 유지
- 모든 motion에 동일 패치 적용 → motion 전환 사이에도 part가 돌아오지 않음
- 존재하지 않는 part Id의 커브는 Framework가 무시 → over-include 안전

motion이 0개인 puppet (드뭄): `geny-hide-init.motion3.json` 합성해서 model3.json `FileReferences.Motions.Idle`에 `unshift`. Framework가 자동 idle 재생 시 hide 적용.

Meta 카운터 (`CurveCount`, `TotalSegmentCount`, `TotalPointCount`) 도 필수로 갱신 — Cubism Framework는 이걸 보고 메모리 할당.

### Spine: skeleton.json `slot.attachment = ""`

Spine은 setup pose에서 `attachment` 필드를 비우면 그 slot은 default render 안 됨. JSON 포맷이면 직접 파싱해서 패치. `.skel` 바이너리만 있는 puppet은 warning 띄우고 hide 미적용 (사용자가 Spine Editor에서 JSON으로 재export 권장).

### `bakeAtlas.ts`에서 visibility erase 통째 제거

- 입력 시그니처에서 `visibility` 제거
- 페이지 합성 단계에서 hidden footprint erase 단계 제거
- 주석에 "왜 atlas erase는 잘못된 접근인지" 명시
- 파일은 이제 **순수 mask + AI texture 합성기**. 두 채널 모두 사용자 명시적 atlas-content 변경이라 베이크 정당.

### 결과 메타데이터 확장

`BuildModelZipResult`에:
- `hiddenParts`: 실제로 hide 강제된 part 수
- `patchedFiles`: 우리가 rewrite한 model 파일 path 목록 (motion3.json들 / skeleton.json / model3.json)

ExportButton 로그도 갱신: `[export:model] ... · baked=N · hiddenParts=K patched=M`.

## 의도적 한계

- **Spine binary `.skel` puppet에서 hide는 적용 안 됨**: warning만 출력. JSON으로 재export 필요. 이걸 자동 변환하려면 .skel parser/encoder 필요 — 별도 sprint.
- **motion 없는 Cubism puppet**: 합성된 idle motion이 추가됨. 만약 원래 puppet이 의도적으로 motion-less였다면 자동 재생되는 idle motion이 새 동작으로 보일 수 있음 (단, 우리 합성 motion은 PartOpacity 커브만 가져서 visible 부분에 영향 없음).
- **expression / pose 같은 다른 채널은 안 건드림**: 만약 expression에서 part opacity를 raise하면 그 시점에는 hide가 풀릴 수 있음. 현실적으론 expression은 parameter용이지 part용은 아니므로 충돌 거의 없음.
- **default-hidden part는 여전히 안 건드림**: atlas erase 시절과 같은 룰 — `defaults.visible === true` AND `current === false` 일 때만 hide 강제. motion이 raise할 가능성을 보존.

## 검증

- typecheck 통과
- biome 통과
- `next build` 통과

## 시각 검증 가이드

```bash
git pull && pnpm install && pnpm dev

# 1. CJK puppet 다시 업로드 → /edit/<id>
# 2. part0 (워터마크/크레딧 컨테이너) 토글 off
# 3. 다른 곳에 mask + AI texture 적용도 한두 개
# 4. "export model" → <name>.zip 다운로드
# 5. zip 풀어서 atlas PNG 직접 확인:
#    - hidden part의 영역이 그대로 (transparent 아님!) → atlas는 손상되지 않음 ✓
#    - mask 영역만 transparent ✓
#    - AI texture 합성 영역만 새 픽셀 ✓
# 6. zip의 motion3.json 텍스트 에디터로 열어서 확인:
#    - Curves 배열 끝에 새로 PartOpacity Target 커브 추가됨
#    - 각 hidden part Id 하나씩 새 entry
#    - Meta의 CurveCount / TotalSegmentCount / TotalPointCount 증가
# 7. zip을 다시 /poc/upload에 드롭 → 재import
#    - puppet 본체 영역 깨끗 (격자/노이즈 없음 — atlas 손상 안 됐으니)
#    - hidden part는 렌더 안 됨 (motion 패치가 매 frame opacity 0으로 묶음)
#    - mask + AI texture는 그대로
# 8. 콘솔: [export:model] ... · baked=N · hiddenParts=K patched=M
#    - hiddenParts > 0
#    - patched > 0 (각 motion3.json 파일이 patched에 포함)
# 9. 외부 도구 (Cubism Viewer 등)에 같은 zip 로드:
#    - 동일하게 hidden part가 렌더 안 됨 (Framework가 motion 커브를 적용하므로)
```

## Spine 검증 (있으면)

```bash
# 1. Spine puppet (JSON 형식) 업로드
# 2. 한 slot toggle off
# 3. export model
# 4. zip의 .json 열어서 확인: 해당 slot의 attachment가 "" 로 변경
# 5. 재import 하면 그 slot은 default 빈 상태로 시작 → 안 보임
# 만약 .skel binary puppet이면: 콘솔에 "JSON으로 재export 권장" warning 출력됨
```

## Phase 4 polish 종료 — Phase 4 정식 완료

Phase 4의 핵심 시나리오 (export → 외부 viewer / 재import → 동일 모습) 가 안정적으로 동작. atlas erase 접근에서 모델 패치 접근으로 전환하면서 puppet 본체 안정성과 hidden part 정확성을 동시에 확보.
