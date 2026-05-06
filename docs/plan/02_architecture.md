# 02 — Architecture

시스템의 큰 구성. 자세한 라이브러리 선택은 [03_tech_stack](03_tech_stack.md), 데이터 표현은 [04_data_model](04_data_model.md).

## 한 그림

```
┌──────────────────────────────────────────────────────────────────────┐
│ Browser (Next.js client, React, Pixi v8 canvas)                      │
│                                                                       │
│  ┌────────────────┐   ┌──────────────────┐   ┌──────────────────┐    │
│  │ Asset Library  │   │ Live Preview     │   │ Tools / Layers   │    │
│  │  (좌측 리스트)   │   │  (Pixi canvas)   │   │  (우측 패널)      │    │
│  └────────────────┘   └──────────────────┘   └──────────────────┘    │
│           │                    │                       │              │
│           └────────────┬───────┴───────────────────────┘              │
│                        ▼                                              │
│           ┌─────────────────────────────┐                             │
│           │ Avatar State (Zustand)      │                             │
│           │  - layers, variants, anims  │                             │
│           │  - texture overrides        │                             │
│           │  - undo/redo                │                             │
│           └──────────────┬──────────────┘                             │
│                          │                                            │
│           ┌──────────────┼──────────────┐                             │
│           ▼              ▼              ▼                             │
│       Runtime        Atlas Tools    AI Client                         │
│       Adapters       (decompose,    (request                          │
│       (Spine,         repack,       compose,                          │
│        Live2D)        export)       cancel,                           │
│                                     stream)                           │
│           │                              │                            │
│  ─────────│──────────────────────────────│────────────────────────    │
│  IndexedDB (assets, generated textures, undo log)                     │
└──────────────────────────────────────────────────────────────────────┘
                          │ HTTPS
                          ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Next.js API routes (edge or node)                                    │
│  - /api/ai/generate       (큐 to AI backend)                          │
│  - /api/ai/status/:jobId                                             │
│  - /api/sample/list, /api/sample/:id   (내장 샘플 메타)                │
│  - /api/license/validate                                             │
└──────────────────┬───────────────────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│ AI Backend (Phase 1: Replicate, Phase 2+: 자체 ComfyUI)              │
│  - SDXL inpaint + ControlNet + IP-Adapter + LoRA                     │
└──────────────────────────────────────────────────────────────────────┘
```

## 주요 결정과 Why

### D1 — 클라이언트 무거움, 서버 가벼움

렌더링·레이어 토글·atlas 슬라이싱·undo/redo 모두 **브라우저에서**. 서버는 AI inference 라우팅과 내장 샘플 카탈로그만.

**Why**: 첫 화면 로드 후의 모든 인터랙션이 네트워크 없이 즉각 반응. 또 hobby 단계라 사용자 = 우리 자신이라 자산을 서버에 올릴 필요가 없다.

**예외**: AI 생성은 네트워크가 강제됨. 그게 유일한 라운드트립.

### D2 — 단일 페이지 애플리케이션, Next.js App Router

`/` (랜딩 + 샘플 그리드) → `/edit/[avatarId]` (메인 에디터). 라우팅은 단순.

**Why**: SSR이 거의 필요 없는 도구지만 Next.js를 쓰면 API routes·환경변수·Vercel/Cloudflare 배포가 묶여 온다. App Router가 클라이언트 컴포넌트 경계 관리에 유리.

### D3 — Pixi v8 단일 렌더 캔버스

좌측 리스트의 캐릭터 thumbnail은 미리 렌더한 PNG, 메인 프리뷰만 살아있는 Pixi 캔버스 1개.

**Why**: 캐릭터별 thumbnail까지 라이브 렌더하면 동시 모델 로딩 비용이 폭발. 큐레이션된 PNG로 충분.

### D4 — 런타임 어댑터 패턴 (둘 다 day-1)

`SpineAdapter`와 `Live2DAdapter`가 공통 인터페이스(`AvatarAdapter`)를 구현. 두 어댑터는 Phase 1에서 같이 만들어진다 — 한쪽을 먼저 만들고 나중에 추가하지 않는다 ([P1](../README.md)).

```ts
interface AvatarAdapter {
  static detect(files: FileBundle): DetectionResult | null  // Spine? Cubism? 버전?
  load(files: FileBundle): Promise<AvatarSnapshot>
  toPixiObject(): Container
  setLayerVisibility(layerId, visible): void
  setLayerColor(layerId, rgba): void
  setLayerTexture(layerId, png: ArrayBuffer): void
  playAnimation(name: string): void
  setParameter(name, value): void
  serialize(): AvatarSnapshot
  capabilities: AdapterCapabilities  // 어떤 능력이 작동하는가
}

type DetectionResult = {
  runtime: 'spine' | 'live2d'
  version: string                    // "4.1.23", "Cubism4", ...
  confidence: 'high' | 'low'         // low이면 사용자 확인 모달
}
```

`AvatarRegistry`가 두 어댑터를 들고, 업로드/로드 시 `Adapter.detect()`를 순서대로 호출해서 매칭되는 어댑터를 선택한다.

**Why**: 두 어댑터를 같이 구현해야 인터페이스가 진짜로 검증된다. 한 포맷만 보고 만든 추상화는 두 번째 포맷에서 반드시 깨진다 — 우리는 그 충돌을 첫날 직접 본다.

### D4-bis — 포맷 자동 감지 (업로드 day-1)

사용자가 ZIP 또는 폴더를 드롭하면:
1. ZIP이면 메모리에서 압축 해제.
2. 매니페스트 파일 탐색:
   - `*.model3.json` → Cubism 4/5
   - `*.moc` (헤더 검사) → Cubism 2/3
   - `*.skel` 또는 `*.atlas` → Spine
3. 헤더로 정확한 버전 추출 (Spine .skel의 string version, Cubism .moc3의 versioning bytes).
4. 각 어댑터의 `detect()`를 호출, 가장 높은 confidence를 가진 어댑터로 라우팅.
5. 감지 실패 시 사용자에게 "이 자산은 어떤 포맷인가요?" 모달 + 안내.

**Why**: hobby 사용자(=우리)가 인터넷에서 받는 자산은 정형화된 ZIP이 아닐 수 있다. 폴더 통째로, 또는 다른 사람이 패킹한 비표준 ZIP일 수 있어서 detect가 robust해야 한다.

### D5 — 텍스처 변경은 "오버레이"로 시작

V1은 atlas 재패킹 안 함. 변경된 region을 별도 PNG로 메모리에 들고, 런타임이 그 region을 그릴 때 우리 PNG를 사용하도록 어댑터가 라우팅.

**Why**: 재패킹은 어렵고 raise한 가치가 작다 (export 시점에 한 번만 하면 됨). V1은 "보이는 것"이 중요.

**Phase 후속에서**: export 시 재패킹해서 round-trip 가능한 atlas를 만든다.

### D6 — IndexedDB로 자산·생성 결과 캐시

업로드된 puppet 파일과 AI가 생성한 텍스처를 IndexedDB에 저장. 새로고침해도 작업 보존.

**Why**: 사용자 자산을 서버로 안 보내는 정책의 부산물. 또 AI 생성 비용이 있으니 같은 결과를 재생성하지 않게 캐시 hit이 중요.

### D7 — AI는 비동기 작업

생성 요청 → 즉시 jobId 반환 → 클라이언트가 polling 또는 SSE로 진행 상태 수신. 완료 시 PNG 다운로드 → Pixi 텍스처 갱신.

**Why**: SDXL inpaint 30 step은 데스크톱 GPU에서도 5~30초. UI를 막으면 안 된다. 사용자는 그동안 다른 레이어를 만질 수 있다.

### D8 — 서버는 "최소" — 인증·DB 없음 (V1)

내장 샘플 메타는 정적 JSON. 사용자 계정 없음. 모든 사용자 자산은 브라우저 로컬.

**Why**: V1 스코프는 도구 자체. 계정·갤러리·결제는 V2 이후 의사결정. 지금 만들면 갈아엎게 된다.

**예외**: AI 사용량은 결국 측정·요금 부과가 필요할 수 있다. 그건 [08 Risks](08_risks_and_mitigations.md)에서 다룸.

### D9 — 폐쇄 바이너리는 별도 private 레포에 격리

Cubism Core 같은 EULA 종속 자산을 메인 코드 레포에 두지 않는다. `geny-avatar-vendor`(private) → `vendor/` 경로 submodule로 마운트. 자세한 내용은 [03_tech_stack 레포 구성](03_tech_stack.md#레포-구성--메인--vendor-submodule).

**Why**: 미래에 메인을 public으로 전환하더라도 라이선스 충돌이 없도록 미리 격리. hobby 단계에서도 자산 라이프사이클(버전·갱신)을 코드와 분리할 수 있다.

## 주요 컴포넌트 — 책임 한 줄

| 컴포넌트 | 책임 |
|---|---|
| `AssetLibrary` | 좌측 리스트, 사용자 업로드, 내장 샘플 카탈로그 |
| `LivePreview` | Pixi 캔버스 1개 + 어댑터 위임. 줌/팬, 애니메이션 셀렉터 |
| `LayersPanel` | 우측 레이어 트리, 검색, bulk select, visibility/color |
| `ToolsPanel` | 우측 상단 라디오/체크 (애니 모드, HQ assets, hide UI) |
| `GeneratePanel` | 레이어 선택 시 나타나는 AI 프롬프트 입력 + 결과 미리보기 |
| `DecomposeStudio` | atlas region 분해 — SAM 자동 + 브러시 마스크 |
| `Adapter:Spine` | spine-pixi-v8 wrapping, slot/skin/attachment 노출, Spine 3.8/4.0/4.1/4.2 모두 받음 |
| `Adapter:Live2D` | Cubism Web SDK wrapping, drawable/part 노출, Cubism 2/3/4/5 모두 받음 |
| `AvatarRegistry` | 두 어댑터를 들고 업로드/내장 자산 입력 시 적절한 어댑터로 라우팅 |
| `FormatDetector` | ZIP/폴더 → manifest 탐색 → 포맷·버전 자동 감지, low-confidence 시 사용자 모달 |
| `AtlasIO` | `.atlas` parsing, region slicing, export 시 재패킹 |
| `AvatarStore` | Zustand store, 모든 변경의 single source of truth, undo/redo |
| `AIClient` | API 호출, jobId 관리, 결과 패치 |
| `OriginNote` | 자산 출처를 상태바 chip으로 표시 (정보용, 차단 X) |
| `Persistence` | IndexedDB wrapper |

## 데이터 플로우 — "텍스처 다시 그려줘" 한 사이클

1. 사용자가 LayersPanel에서 layerX 선택 → `store.setSelectedLayer(layerX)`
2. GeneratePanel이 layerX의 메타(silhouette, current texture) 표시
3. 사용자가 프롬프트 입력 + Generate 클릭
4. AIClient: 현재 region의 PNG + silhouette을 base64로 패키징 → POST /api/ai/generate
5. 서버가 Replicate 호출 → jobId 반환
6. 클라이언트 polling 또는 SSE로 진행 추적
7. 완료 시 결과 PNG 수신 → IndexedDB에 캐시 저장 → store에 textureOverride 추가
8. 어댑터가 이를 감지하여 Pixi 텍스처 갱신 → 화면 즉시 변경
9. 사용자 만족 → "Apply" → 영구 변경 (사실은 메모리/IndexedDB 변경, 새로 export 시 PNG로 굳어짐)
10. 사용자 불만족 → "Regenerate" or "Discard"

## 비기능 요구사항 (V1)

- 첫 페인트(내장 모델) ≤ 1.5s
- 사용자 업로드 → 첫 미리보기 ≤ 5s (50MB 미만 자산)
- 레이어 토글 → 화면 갱신 ≤ 16ms (한 프레임)
- AI 라운드트립 ≤ 30s (Replicate, 1080p)
- IndexedDB 용량: 단일 puppet 패키지 < 50MB 가정, 사용자에게 quota 경고
- 인터넷 무작위 자산 5종(2 Spine + 3 Live2D, 다양한 버전) 80% 이상 정상 로드
- Chrome 최신·Firefox 최신·Safari 최신 + WebGL2. WebGPU는 fallback 후순위.

## 미정 (다른 문서에 위임)

- AI 백엔드 결정 → [05_ai_pipeline](05_ai_pipeline.md)
- UI 세부 → [06_ui_ux](06_ui_ux.md)
