# Phase 8 — Editor Animation Tab

> 텍스처 편집 (Phase 0~6) + Polish (Phase 7) + Geny 통합 (Phase A~D, 별도 사이드 트랙) 다음. puppet 의 motion / expression / display 메타데이터를 editor 에서 직접 매핑하고, 그 결과를 baked zip + Geny 라이브러리로 전송할 수 있게 한다.
>
> **상태**: 계획 (구현 전).
> **의존**: geny-avatar v0.2.x (Phase A 끝 + Geny 통합 가능 상태).
> **결과물 버전**: v0.3.0 (minor — 신규 기능).

---

## 1. 배경

geny-avatar 의 현재 editor 는 **텍스처 영역** 에 한정:
- 레이어 visibility / mask / AI 생성
- atlas 페이지 합성 / export

하지만 Live2D Cubism puppet 은 model3.json 안에 풍부한 **모션 / 표정 / 히트영역** 메타데이터를 가지고 있고, 이 메타데이터가 어떻게 매핑되는지가 puppet 의 실제 사용감을 결정한다:

```
ellen_joe.model3.json
├─ Motions: { "Idle": [idle.motion3.json, idle2.motion3.json] }
├─ Expressions: [black, red, shock, shou, shuiyin, tang]
└─ HitAreas: [HitAreaHead, HitAreaBody]
```

Geny 의 `model_registry.json` 은 이 위에 **per-puppet 사용자 선택** 을 얹는다:

```json
{
  "name": "ellen_joe",
  "kScale": 0.92, "initialXshift": 0, "initialYshift": 0,
  "idleMotionGroupName": "Idle",
  "emotionMap": { "joy": 1, "anger": 0, ... },   // → expression 인덱스
  "tapMotions": { "HitAreaHead": {"": 0} },       // → motion group/index
  "hiddenParts": ["Part17"]
}
```

이 매핑은 **현재 사용자가 model_registry.json 을 직접 손으로 편집** 해야 한다. geny-avatar 에서 GUI 로 편집할 수 있게 만들고, 결과를 baked zip 에 동봉해 Geny 가 자동 적용하게 한다.

## 2. 목표 / 비목표

### 목표

1. **Editor 에 Animation 탭 추가** — 기존 Edit 탭 (텍스처 편집) 옆에 새 탭. 탭 전환 시 좌측 캔버스 그대로, 우측 사이드바만 교체.
2. **모션 / 표정 미리보기** — 탭 안에서 motion group + expression 을 ▶ 버튼으로 즉시 캔버스에 트리거. 사용자가 "joy → 어떤 표정이 어울리지?" 직접 보고 결정.
3. **emotion → expression 매핑 GUI** — 8 GoEmotions 표준 (`neutral` / `joy` / `anger` / `disgust` / `fear` / `sadness` / `surprise` / `smirk`) 별로 expression NAME (인덱스 X) 선택. 인덱스는 모델 변경 시 깨지지만 NAME 은 안정적.
4. **viewport 디폴트 튜닝** — `kScale`, `initialXshift`, `initialYshift` 슬라이더 → 라이브 프리뷰. Geny 의 `model_registry` 가 그대로 받음.
5. **tap motion 매핑** — 모델에 `HitAreas` 가 있으면, 영역별로 trigger 할 motion group/index 선택.
6. **IDB 영구 저장** — 본 메타데이터는 puppet 별로 IDB 에 저장. baked zip export 에 포함.
7. **단독 사용에서도 작동** — Geny 에 보내지 않아도 editor 안에서 motion/expression 미리보기 + 매핑 저장 자체로 가치 있음.
8. **Geny 통합 schema 명시** — `avatar-editor.json` 의 schemaVersion v1 → v2. Geny backend 의 install 경로가 v2 메타를 읽어 `model_registry.json` 에 자동 적용.

### 비목표 (이 phase 의 범위 밖)

- 모션 데이터 자체 편집 (Cubism Animator 의 영역).
- 신규 motion / expression 생성 (외부 도구 필요).
- 직접 parameter 조작 (lipsync / 표정 blend 같은 runtime 시스템은 Geny 가 책임).
- **Spine 의 animation 탭** — Spine 은 motion group / expression 개념 자체가 다름 (animation tracks / skins). V1 은 Live2D Cubism only. Spine puppet 진입 시 "Spine animation editor 미지원" placeholder.
- Geny 의 다른 컴포넌트 (lipsync engine / beat sync) 와의 직접 통합 — 그건 Geny 측 책임.

---

## 3. UX

### 3.1 탭 스위처

`/edit/<id>` 진입 시 헤더에 두 탭:

```
[ Edit | Animation ]   ← 디폴트 Edit
```

탭 전환:
- 좌측 캔버스: **항상 visible** (양쪽 탭에서 puppet 이 보임 — Animation 미리보기 시 캔버스에서 모션 재생).
- 우측 사이드바: 탭에 따라 컨텐츠 교체.
  - **Edit 탭**: 현재 그대로 (Tools / References / Variants / Layers / Decompose / Generate / Export).
  - **Animation 탭**: 아래 4 섹션.

### 3.2 Animation 탭 사이드바 구성

#### Section 1 — Display (viewport 기본값)

```
DISPLAY                          [reset]
─────────────────────────
kScale       [============●===]  0.92
                  0.1       2.0
X shift      [======●========]   0
                 -200       200
Y shift      [======●========]   0
                 -200       200

Idle motion group
  ▾ [Idle ▼]   (모델의 motion group 목록)
```

각 슬라이더 → 즉시 캔버스에 반영 (live preview).

#### Section 2 — Motions

```
MOTIONS                                          (3 groups, 5 entries)
─────────────────────────────────
▾ Idle  [☑ idle group]               2 motions
   ▶ idle.motion3.json     · 4.2s
   ▶ idle2.motion3.json    · 3.8s
▾ TapHead                            2 motions
   ▶ tap_head_a.motion3.json · 2.1s
   ▶ tap_head_b.motion3.json · 2.3s
```

- 그룹 헤더의 `[☑ idle group]` 체크박스: 단 하나의 그룹만 idle. 디폴트는 model3.json 에 "Idle" 그룹이 있으면 그것.
- ▶ 클릭 → adapter.playMotion(group, index) → 캔버스에서 즉시 재생.
- 시간 표시 (motion3.json 의 `Duration` 필드 추출).

#### Section 3 — Expressions + Emotion Map

```
EXPRESSIONS                                      (6 entries)
─────────────────────────────────
▶ black     [neutral · anger · disgust · fear ▾ assign]
▶ red       [joy · smirk ▾ assigned to: joy]
▶ shock     [surprise ▾ assigned to: surprise]
▶ shou      [sadness ▾ assigned]
▶ shuiyin   [— unassigned —]
▶ tang      [— unassigned —]

EMOTION MAP    (Geny 의 emotion → expression 매핑)
─────────────────────────────────
neutral  → ▾ [tang ▼]
joy      → ▾ [red ▼]
anger    → ▾ [black ▼]
disgust  → ▾ [black ▼]
fear     → ▾ [black ▼]
sadness  → ▾ [shou ▼]
surprise → ▾ [shock ▼]
smirk    → ▾ [red ▼]
```

- 위쪽 expressions list: 각 expression 옆에 ▶ 미리보기 + 어떤 emotion 들에 매핑됐는지 라벨.
- 아래쪽 emotion map: 8 GoEmotions 별로 어느 expression 을 쓸지 dropdown.
- 매핑은 expression NAME 기준 (예: `joy → "red"`). Export 시점에 NAME → 인덱스 변환 (Geny 가 인덱스 받음).

#### Section 4 — Hit Areas (조건부)

model3.json 에 HitAreas 가 정의돼 있을 때만 노출:

```
HIT AREAS                         (model 에 정의된 영역)
─────────────────────────────────
HitAreaHead → tap motion: ▾ [TapHead / 0 ▼]
HitAreaBody → tap motion: ▾ [TapBody / 1 ▼]
              (아니면 — none —)
```

ellen_joe 처럼 `HitAreas: []` 인 puppet 은 이 섹션 자체 hidden + "이 puppet 은 hit area 미정의" 한 줄.

### 3.3 헤더 버튼

기존 헤더 (`undo / redo / reset / save / export model / send to Geny / library / ?`) 에 변경 없음. Animation 탭의 변경사항은:
- IDB 에 자동 저장 (debounced) — 명시적 save 불필요.
- "save & export" 시 baked zip 에 포함 (8.8).

---

## 4. 데이터 모델

### 4.1 IDB schema (geny-avatar)

새 store: `puppetAnimationConfig`

```ts
type PuppetAnimationConfig = {
  /** Same key scheme as other per-puppet stores: PuppetId or "builtin:<key>". */
  puppetKey: string;

  /** Viewport defaults — Geny 의 model_registry 와 동일 의미. */
  display: {
    kScale: number;          // default 0.7
    initialXshift: number;   // default 0
    initialYshift: number;   // default 0
  };

  /** 어느 motion group 이 idle 인지. model3.json 에 "Idle" 있으면 그 이름,
   *  없으면 첫 번째 group. 사용자 override 가능. */
  idleMotionGroupName: string;

  /** Emotion → expression NAME (인덱스 X — 안정성). Geny 로 export 시 인덱스 변환. */
  emotionMap: Record<string, string>;
  // 예: { "joy": "red", "anger": "black", "neutral": "tang" }

  /** Hit area → motion group/index 매핑. Geny 의 tapMotions 와 같은 모양. */
  tapMotions: Record<string, { group: string; index: number }>;
  // 예: { "HitAreaHead": { "group": "TapHead", "index": 0 } }

  /** 향후 확장: emotion → motion group 매핑 (expression 만 바꾸지 않고 motion 도 트리거).
   *  V1 에서는 비워둠. */
  emotionMotionMap?: Record<string, { group: string; index: number }>;

  updatedAt: number;
};
```

### 4.2 Baked zip schema 변경 (v1 → v2)

`avatar-editor.json` 안에 `animationConfig` 필드 추가. **schemaVersion 2** 로 bump:

```json
{
  "schemaVersion": 2,
  "exporter": "geny-avatar/0.3.0",
  "exportedAt": 1730000000000,
  "puppet": {
    "name": "ellen_joe",
    "runtime": "live2d",
    "version": "Cubism 4"
  },
  "animationConfig": {
    "display": { "kScale": 0.92, "initialXshift": 0, "initialYshift": 0 },
    "idleMotionGroupName": "Idle",
    "emotionMap": {
      "neutral": "tang",
      "joy": "red",
      "anger": "black",
      "disgust": "black",
      "fear": "black",
      "sadness": "shou",
      "surprise": "shock",
      "smirk": "red"
    },
    "tapMotions": {}
  }
}
```

**주의**: `emotionMap` 는 NAME 기준. Geny 의 install endpoint 가 모델의 expression list 를 파싱해서 NAME → 인덱스 변환 (이쪽이 한 번 더 stable — geny-avatar 가 인덱스를 모름 / 알 필요 없음).

기존 v1 zip (animationConfig 필드 없음) 도 backward 호환 — Geny 의 install 이 detect 후 디폴트값 사용.

---

## 5. Geny 측 인터페이스 (consumer side)

### 5.1 변경 surface

- `backend/controller/vtuber_baked_imports_controller.py` 의 `install_baked_import`:
  - `_peek_zip_metadata` 가 schemaVersion + animationConfig 추출.
  - schemaVersion ≥ 2 일 때 `animationConfig` 적용:
    - `display.kScale` / `initialXshift` / `initialYshift` → `Live2dModelInfo.kScale` / `initialXshift` / `initialYshift`
    - `idleMotionGroupName` → 동일 필드
    - `emotionMap` (NAME) → 모델 model3.json 파싱 → expression 인덱스로 변환 → `Live2dModelInfo.emotionMap`
    - `tapMotions` ({ group, index }) → 동일 필드
  - schemaVersion 1 (기존 zip) → 디폴트 값 (현재 동작 그대로).
  - schemaVersion > 우리 알아 보는 최대값 → 명시적 에러 ("geny-avatar 가 너무 신버전 — Geny 업그레이드 필요").

### 5.2 호환성 약속

- **schemaVersion 1**: animationConfig 없음. Geny 가 디폴트 (kScale=0.7, emotionMap={"neutral":0}, tapMotions={}) 사용. (현 install 동작 그대로)
- **schemaVersion 2**: animationConfig 필수. 누락 시 zip reject + 친절한 에러.
- **schemaVersion 3+**: 미래 확장. Geny 가 모르는 버전이면 reject.

이 contract 는 두 레포에 동시 명시:
- geny-avatar: 본 plan + buildModelZip 코드.
- Geny: `docs/plan/GENY_AVATAR_INTEGRATION.md` 의 "3.2 baked zip 포맷" 섹션 갱신.

---

## 6. 구현 sub-sprint 분할

각 atomic PR. 사용자 검증 후 다음 진입.

### 8.1 — Editor 탭 스위처 (shell)

- `/edit/<id>` + `/edit/builtin/<key>` 페이지에 헤더 탭 (Edit / Animation) 추가.
- 탭 state 는 URL 쿼리 (`?tab=animation`) 또는 React state — URL 우선 (북마크 가능).
- Animation 탭 진입 시 사이드바 콘텐츠 교체 (placeholder "Animation 탭 — 다음 sprint").
- 캔버스는 두 탭 공유 — unmount 안 함.

### 8.2 — model3.json motion/expression 추출

- `lib/avatar/cubismMeta.ts` (신규) — Live2DAdapter 가 들고 있는 model3.json 을 파싱해서:
  - `motions: { groupName: [{ file, duration?, fadeIn, fadeOut }] }`
  - `expressions: [{ name, file }]`
  - `hitAreas: [{ name, id }]` (있으면)
- 그룹 / 표정 / 히트영역 메타가 React 컴포넌트에 도달하도록 store / hook 정비.

### 8.3 — Display section (live preview)

- `components/animation/DisplaySection.tsx` (신규).
- kScale / shift 슬라이더 → 즉시 PuppetCanvas 의 viewport transform 반영 (Live2DCanvas 의 baseScaleRef + userPanRef 갱신).
- 변경값 → `puppetAnimationConfig.display` 에 debounced (400ms) 저장.

### 8.4 — Motions section + ▶ preview

- `components/animation/MotionsSection.tsx`.
- adapter 에 `playMotion(group, index)` 메서드 expose (Live2DAdapter 가 이미 native 로 지원 — Cubism Framework 의 `_motionManager.startMotion`).
- ▶ 버튼 → playMotion → 캔버스에서 즉시 재생 (with fadeIn/fadeOut 의 motion3.json 메타).
- 그룹별 idle 체크박스 → `idleMotionGroupName` 갱신 → IDB.

### 8.5 — Expressions + emotion map

- `components/animation/ExpressionsSection.tsx`.
- adapter.setExpression(name) — Live2DAdapter 도 이미 expose (Cubism Framework `_expressionManager.startMotion`).
- 8 GoEmotions × expression dropdown 매트릭스.
- 각 expression 의 ▶ → setExpression(name).

### 8.6 — Hit Areas section (조건부)

- model3.json 에 HitAreas 있으면 `components/animation/HitAreasSection.tsx` 렌더.
- 각 영역에 motion group/index dropdown.
- 없으면 hidden.

### 8.7 — IDB persistence

- `lib/avatar/usePuppetAnimationConfig.ts` — load/save hook.
- Dexie v10 schema bump: 새 store `puppetAnimationConfig`.
- mount 시 IDB 에서 load, 변경 시 debounced save.
- 빈 IDB (첫 진입) → 디폴트값 (model3.json 의 첫 idle group + 디폴트 kScale 0.7).

### 8.8 — buildModelZip 의 schemaVersion 2 출력

- `lib/export/buildModelZip.ts` 갱신.
- `avatar-editor.json` 의 `schemaVersion` 1 → 2 (Live2D 일 때만; Spine 는 v1 유지 — animationConfig 없음).
- `animationConfig` 객체 직렬화.
- 기존 model 자산 / atlas 의 export 동작 무손상.

### 8.9 — README + version bump

- README 에 "Animation 탭" 섹션 추가 (스크린샷 + 사용법 한 단락).
- `app/page.tsx` landing chip `v0.2.4` → `v0.3.0`.
- `package.json` version bump.
- git tag `v0.3.0` (minor — feature add).

총 9 sprint × 평균 1 PR = **9 atomic PR**.

---

## 7. 위험 / 의도적 한계

### 7.1 Live2DAdapter 의 motion/expression API 미공개 위험

- 현재 Live2DCanvas 에서 motion/expression 트리거가 어떻게 되는지 (Cubism Framework 의 어느 메서드를 부르는지) 검증 필요.
- 만약 native API 가 직접 노출 안 돼있으면 Live2DAdapter 에 thin wrapper 추가 (1 PR 내에서).

### 7.2 motion3.json 의 Duration 필드 부재

- 일부 puppet 의 motion3.json 은 `Duration` 안 적혀 있음. 그 경우 ▶ preview 길이 표시 X (옵션 필드).

### 7.3 expression 이름 중복

- 이론상 가능. 현실에선 거의 없음. 발견 시 `name + index` 로 disambiguate (예: "red#1") 또는 export 시 reject.

### 7.4 schema version 불일치

- geny-avatar v0.3.0 zip → Geny C-phase only (v1 만 처리) → install 성공하지만 animationConfig 무시 + 디폴트값 사용.
- 사용자에게는 "파일은 install 됐지만 Geny 가 옛 버전이라 emotion 매핑이 디폴트 — Geny 업그레이드 필요" 한 줄 안내가 필요. C-phase install endpoint 에 schemaVersion 검증 + warning 응답 추가.

### 7.5 캔버스 모션 preview 의 race

- 사용자가 ▶ 빠르게 연달아 누르면 motion 이 cancel/restart 되어야 함. Cubism Framework 의 `MotionPriority.PRIORITY_FORCE` 사용.

### 7.6 Spine 지원 부재

- Spine puppet 진입 시 Animation 탭이 비어있음 ("Spine animation editor 미지원" 한 줄).
- 향후 별도 phase — Spine 의 animation tracks + skins 매핑은 Live2D 와 다른 모델이라 별도 설계 필요.

### 7.7 Geny 의 emotion 표준 변화

- Geny 가 GoEmotions 8개 → 다른 세트로 변경 시 본 plan 의 emotion 키 list 도 갱신.
- 본 contract 는 schemaVersion 으로 보호 — Geny v?? 가 새 emotion 추가하면 schemaVersion 3 으로 bump.

---

## 8. 시각 검증 가이드 (V1 완료 시점)

```bash
# Phase 8 끝난 후 — 단독 사용 + Geny 통합 둘 다 검증

# 단독:
git pull && pnpm install && pnpm dev
# 1. /edit/builtin/hiyori 진입 → 헤더 [Edit | Animation] 보임
# 2. Animation 탭 클릭 → 사이드바 4 섹션 보임
# 3. ▶ 버튼들 → 캔버스에서 모션/표정 재생
# 4. emotion map dropdown → 변경 시 바로 미리보기 (joy 선택 → red expression 적용)
# 5. kScale 슬라이더 → 캔버스 즉시 변경
# 6. 페이지 reload → 변경값 그대로 유지 (IDB persistence)

# Geny 통합:
# 7. (Geny 가 v0.3.0 spec 처리 가능한 상태) "send to Geny"
# 8. Geny 의 가져오기 모달 → install
# 9. Geny VTuber 탭의 모델 selector 에 "(Editor)" 등장
# 10. 선택 → kScale / emotionMap / tapMotions 모두 정확히 적용된 상태로 렌더
```

---

## 9. 다음 단계

1. 본 plan 사용자 검토 + 승인.
2. **8.1 부터 시작** — atomic PR 한 번에 하나씩.
3. 8.8~8.9 끝나고 v0.3.0 tag.
4. Geny 측 별도 PR — 5.1 의 install endpoint 갱신 + submodule pin v0.2.4 → v0.3.0.

각 sprint 완료 시 `docs/progress/` 에 기록.
