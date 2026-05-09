# 2026-05-07 — Fix: Cubism Id 추출 (csmString → JS string)

## 증상

[`51 export_model_pose_hide`](2026-05-07_51_export_model_pose_hide.md)에서 pose3.json 추가하고 model3.json도 정확히 참조시키고 motion3.json도 패치했지만 **여전히 part_0이 안 사라짐**:

- `geny-hide.pose3.json` 잘 생성됨 — `Groups: [[{Id: "part_3"}, {Id: "part_0"}]]`
- `model3.json.FileReferences.Pose` 잘 추가됨
- `[export:model] ... · hiddenParts=1 patched=3` 정확히 출력
- 그러나 재upload 시 part_0이 그대로 보임

## 진짜 원인 (47/49/50/51 세 번 헛다리 끝에 발견)

`coerceCubismId` 함수가 **csmString을 인식 못함**.

### 엔진 내부 (untitled-pixi-live2d-engine):

```js
class CubismId {
  getString() { return this._id; }   // ← csmString 객체 반환 (JS string 아님!)
}

class csmString {
  // .s 가 진짜 JS string
  // .s += ... 같이 사용
}
```

### 우리 코드 (수정 전):

```ts
function coerceCubismId(value, fallback) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const v = value;
    if (typeof v.getString === "function") {
      const s = v.getString();
      if (typeof s === "string") return s;  // ← csmString은 "object"라 false, fall through
    }
    if (typeof v._id === "string") return v._id;  // ← _id도 csmString이라 false, fall through
    if (typeof v.id === "string") return v.id;  // ← undefined, fall through
  }
  return fallback;  // ← 항상 여기로 떨어짐
}
```

결과: **Cubism puppet의 모든 layer.externalId가 fallback `part_${partIdx}`로 채워짐** (`part_0`, `part_3`, `part_6`, ...). 이 값들은 우연히 자연스럽게 보이지만 **moc3 binary의 진짜 part ID와 일치하지 않음**.

### 결과 효과 (현재까지의 모든 export model 시도가 실패한 이유)

1. **Pose3.json**: `{Id: "part_0"}` 가 적힘. 엔진이 `getPartIndex("part_0")` 호출 → moc3에 그런 ID 없음 → -1 → pose가 아무것도 안 함 → part_0 그대로 보임.

2. **Motion3.json PartOpacity 커브**: `Id: "part_0"` 적힘. 동일하게 매칭 실패 → 커브 무시.

3. **AI history / variants / overrides IDB rows**: 모두 fallback id 키. 사용자가 새 puppet을 로드해도 이 keys로는 검색 불가능 — 다행히 같은 puppet에선 같은 fallback id 발생하므로 일관성은 유지됐었음.

런타임 hide 토글이 작동했던 건 partIdx (숫자)로 직접 drawable opacity를 mutate해서 — name lookup 안 거치는 channel이라 우연히 살아있었음.

## 수정

`coerceCubismId`가 csmString의 `.s`까지 추출:

```ts
function coerceCubismId(value, fallback) {
  if (typeof value === "string") return value;
  if (value == null || typeof value !== "object") return fallback;
  const v = value;
  if (typeof v.getString === "function") {
    const s = v.getString();
    if (typeof s === "string") return s;
    // csmString case — `.s` is the real JS string
    if (s && typeof s === "object" && typeof s.s === "string") return s.s;
  }
  if (v._id != null) {
    if (typeof v._id === "string") return v._id;
    if (typeof v._id === "object" && typeof v._id.s === "string") return v._id.s;
  }
  if (typeof v.id === "string") return v.id;
  return fallback;
}
```

이제 `coreModel.getPartId(idx)` → CubismId → `getString()` → csmString → `.s` → JS string. moc3 binary에 적힌 진짜 part ID 추출.

## 효과

수정 후:
- `layer.externalId` = puppet의 **실제 moc3 part ID** (예: `Part_xxx` 또는 puppet 작가가 실제로 명명한 ID)
- pose3.json `{Id: <real id>}` → 엔진이 정확히 매칭 → part 0으로 fade
- motion3.json `Id: <real id>` 커브 → 정확히 적용
- export model의 hide가 표준 Cubism 메커니즘으로 작동

## Breaking change 주의

**기존 puppets의 IDB rows (AIJob, Variant, LayerOverride, PuppetSession) 는 모두 fallback id (`part_0` 등) 키로 저장되어 있음**. 수정 후 새 layer.externalId는 다른 값 (실제 moc3 ID)이라 기존 IDB rows는 orphan됨. 대응:

- AI history: 같은 layer에 다시 generate하면 새 row가 생기고, 옛 row는 안 보임 (메모리 차지만 함)
- Variants: 캡처한 visibility가 매칭 안 됨 (`part_0` 키가 새 외부 ID로 안 풀림). 사용자가 다시 캡처 필요.
- Layer overrides (mask / AI texture): hydrate 단계에서 못 찾음. 다시 그려야 함.

해결: 사용자가 puppet 다시 업로드하면 새 puppetId (IDB row)로 시작 → 새 ID 체계로 깔끔히 시작. 또는 DevTools → Application → IndexedDB → geny-avatar 삭제 후 새로 시작.

## 추가 개선

이 수정으로 영향받는 다른 surface:
- **parameter IDs**: `coreModel.getParameterId(i)` 도 같은 wrapping. 수정 후 정확한 파라미터 ID (예: "ParamAngleX") 추출. 향후 parameter 슬라이더가 정확히 작동.
- **LayersPanel display name**: cdi3 displayName 매칭이 fallback 대신 진짜 ID 기준으로 됨. 더 정확한 display.

## 검증

- typecheck 통과
- biome 통과
- `next build` 통과

## 시각 검증

```bash
git pull && pnpm install && pnpm dev
# 1. 같은 CJK puppet 다시 업로드 (옛 IDB row는 orphan되니 무시 가능)
# 2. layer panel 보기 — 이전에 "part_0"이던 layer가 다른 이름으로 나올 수 있음
#    (실제 moc3 ID가 part_0과 다른 경우)
# 3. workflow 정확한 게 무엇인지 콘솔에서 확인:
#    DevTools console에서 Live2DCubismCore 모델의 part ids 직접 보기:
#    예) document.querySelector('canvas').__pixi_app... 등으로 추적
# 4. part_0 (이젠 이름이 다를 수 있는 그 워터마크 part) toggle off
# 5. export model
# 6. zip의 geny-hide.pose3.json 열어서 Id가 진짜 moc3 ID인지 확인
#    (예: "Part_xxxx" 같은 실제 puppet 작가의 명명)
# 7. 재upload — 워터마크 part가 정상으로 안 보여야 함
```

## 4번째이자 진짜 정답

| 시도 | 접근 | 실패 이유 |
|---|---|---|
| 47 | atlas pixel erase | mesh sampling artifact로 본체 깨짐 |
| 49 | cascade-aware atlas erase | 같은 atlas 메커니즘이라 같은 artifact |
| 50 | motion3.json PartOpacity 커브 | motion auto-play 안 됨 (group이 ""라서) |
| 51 | pose3.json + motion 같이 | pose Id가 fallback `part_0` 인데 moc3 진짜 ID와 안 맞음 |
| **52** | **id wrapper unwrap** | 51까지의 메커니즘 자체는 옳았음. ID 추출이 깨져있던 게 진짜 원인 |
