# 03 — Tech Stack

라이브러리·프레임워크 선택. 모든 결정에 **Why** + 검증되지 않은 가정에는 [analysis/09_open_questions](../analysis/09_open_questions.md) ID를 단다.

## 결정 요약 한 표

| 영역 | 선택 | 대안 (왜 안 골랐나) |
|---|---|---|
| 앱 프레임워크 | Next.js 15 (App Router) | Vite SPA — API routes·배포 일체형이 편해서 |
| UI 라이브러리 | React 19 + Tailwind CSS v4 | Solid·Svelte — 생태계와 npm 팩키지 호환성 |
| 렌더 엔진 | Pixi.js v8 | three.js (3D 강점, 2D는 약함), 직접 WebGL (개발 비용) |
| Spine 런타임 (1차) | **`@esotericsoftware/spine-pixi-v8`** | Spine 3.8/4.0/4.1/4.2 모두 |
| Live2D 런타임 (1차, 동등) | **`untitled-pixi-live2d-engine`** (Cubism 5 + Pixi v8) + Cubism Core 정적 호스팅 | `pixi-live2d-display` (v6, v8 포팅 미성숙), raw Cubism Web SDK (Pixi 통합 비용) |
| 상태 관리 | Zustand + Immer | Redux Toolkit (boilerplate), Jotai (atomic 분산이 복잡) |
| 로컬 저장 | IndexedDB via `idb-keyval` 또는 `dexie` | localStorage (용량), OPFS (브라우저 호환) |
| 파일 처리 | Native File API + JSZip | (서버 업로드 — 정책상 안 함) |
| AI 백엔드 (V1) | Replicate (HTTPS API) | 자체 ComfyUI (인프라), 클라이언트 SDXL (성능) |
| AI 백엔드 (V2+) | 자체 ComfyUI on cloud GPU | — |
| 분해 보조 | SAM 1 (서버 inference) | SAM 2 web (성숙도, 비용) |
| 폼/모달 | shadcn/ui + Radix | MUI (테마 무거움) |
| 아이콘 | Lucide | Heroicons |
| 패키지 매니저 | pnpm | npm/yarn |
| Lint/Format | Biome | ESLint + Prettier (설정 무거움) |

## 핵심 결정 상세

### TS1 — Next.js 15 + App Router

**Why**: SSR이 거의 필요 없는 도구지만 (a) API routes로 AI proxy, (b) Vercel/Cloudflare 배포가 일체로 묶임, (c) `next/image`·streaming·suspense 같은 무료 인프라. App Router가 client/server 경계를 명확히 강제해서 "Pixi는 클라이언트만"이 자연스럽다.

**Pin point**: Pixi 캔버스를 `'use client'` 컴포넌트에서만 마운트. SSR 시 placeholder.

### TS2 — Pixi.js v8

**Why**: 2D WebGL/WebGPU의 사실상 표준. spine-pixi-v8이 공식, Live2D 진영도 v8 포팅이 진행 중. v6/v7에서 v8로 가면서 ESM·tree-shake가 깔끔해졌다.

### TS3 — Spine과 Live2D 둘 다 1차

**선택**: `@esotericsoftware/spine-pixi-v8` + `untitled-pixi-live2d-engine` 둘 다 V1에 포함. ([P1 in README](../README.md))

**Why dual-primary**:
- 인터넷 자산이 두 포맷으로 반반 — 한쪽만 지원하면 도구 가치의 절반을 잃는다.
- 어댑터 인터페이스가 두 포맷을 동시에 받아내야만 진짜로 검증된다 — 한 포맷만 보고 만든 추상화는 두 번째 포맷에서 반드시 깨진다 ([D4 in architecture](02_architecture.md)).
- 1인 hobby 기준 두 런타임 모두 라이선스 통과.

**역할 분담**:
- Spine: Skin/Slot/Attachment 추상화 — 의상 교체에 자연스러움.
- Live2D: Drawable 단위 + MultiplyColor/ScreenColor — 색조 조작이 깔끔.
- 두 추상화를 우리 자체 `Layer/Variant`로 정규화 ([plan/04](04_data_model.md)).

**버전 스팬 (사용자 업로드 day-1을 위한 필수 요건)**:
- Spine: 3.8 / 4.0 / 4.1 / 4.2. spine-pixi-v8(4.x 기반)이 4.0/4.1/4.2를 받는다. 3.8은 silent break 가능성 — Phase 0에서 실측.
- Cubism: 2 / 3 / 4 / 5. Cubism 4 SDK가 3을 backward-compatible. 2는 별도 SDK 필요할 수 있음 — Phase 0에서 실측.
- 받지 못하는 버전은 명확한 오류 메시지 + "이 도구로 변환해 보세요" 안내.

**Why not Inochi2D**: V1 비대상. 웹 런타임 부재. 자체 puppet 1종을 자체 BSD/CC0로 내장 자산에 추가하는 정도까지만 검토.

### TS4 — Zustand + Immer

**Why**: 우리 store는 사실상 한 개의 큰 객체(Avatar + UI 선택 상태 + AI job 큐)다. Redux의 슬라이스 분리가 오히려 부담. Immer로 immutable 갱신을 자연스럽게.

**구조**:
```ts
const useAvatarStore = create<AvatarState>()(
  immer((set, get) => ({
    avatar: null,
    selection: { layerIds: [] },
    overrides: { texture: {}, color: {}, visibility: {} },
    aiJobs: [],
    undoStack: [],
    // actions...
  }))
)
```

### TS5 — IndexedDB via Dexie

**Why**: 단순 key-value (idb-keyval)로 시작 가능하지만, undo/redo와 generated texture index를 다루다 보면 쿼리 가능한 스키마가 필요해진다. Dexie가 그 점에서 가성비.

**스키마 (안)**:
```ts
db.assets       // puppet 패키지 원본
db.textures     // AI 생성 + 사용자 변형
db.snapshots    // 작업 상태 (undo/redo)
db.recipes      // 선호하는 프롬프트/LoRA 조합
```

### TS6 — AI 백엔드: Replicate 우선, ComfyUI 자가호스팅 후행

**V1 (Phase 1~3)**: Replicate.
- 빠른 진입 — SDXL inpaint + ControlNet은 이미 모델로 등록되어 있음.
- Cog로 우리 커스텀 워크플로 이미지를 빌드해서 deploy하면 LoRA·다중 ControlNet 적층도 가능.

**V2 (Phase 4+)**: 자체 ComfyUI on RunPod 또는 Lambda Labs.
- 사용량이 충분히 모이면 Replicate 변동비보다 자가호스팅 고정비가 싸다.
- 워크플로 자유도 + 응답 시간 단축.
- 인프라 책임 부담은 추후 검증 후 결정.

**옵션 (Phase 5+)**: BYO endpoint.
- 사용자가 자기 ComfyUI URL을 설정에 붙여넣으면 우리 클라이언트가 직접 호출.
- 우리 서버 부담 0, 고급 사용자 만족.

**클라이언트 사이드 SDXL은 명시적으로 배제** — 모델 로드 GB 단위·iOS 사실상 불가·LoRA 합성 이슈로 V1에서 부담 너무 큼. 미래 옵션으로 남겨둠.

### TS7 — 분해 보조: SAM 서버 inference

**Why**: SAM의 image encoder가 무거워 클라이언트 WebGPU에서 처리하기엔 첫 인터랙션 응답이 느림. 일단 서버 (Replicate에 SAM 모델도 있음 — `meta/sam-2`)로.

**대안**: Phase 4+에서 SAM web (ONNX Runtime Web + WebGPU)로 옮기는 것 고려. 현재는 우선순위 낮음.

### TS8 — 코드 품질: Biome

**Why**: ESLint+Prettier는 설정 부담이 큼. Biome는 단일 도구 + 빠름. 우리 프로젝트 사이즈에 적합.

## 디렉터리 구조 (안)

```
geny-avatar/
├─ docs/                     (이미 있음)
├─ apps/web/                 (Next.js 앱; pnpm workspace 가정)
│  ├─ app/
│  │  ├─ layout.tsx
│  │  ├─ page.tsx            (랜딩)
│  │  └─ edit/[avatarId]/    (메인 에디터)
│  ├─ components/
│  │  ├─ AssetLibrary/
│  │  ├─ LivePreview/
│  │  ├─ LayersPanel/
│  │  ├─ GeneratePanel/
│  │  └─ DecomposeStudio/
│  ├─ lib/
│  │  ├─ adapters/
│  │  │  ├─ AvatarAdapter.ts (interface)
│  │  │  ├─ SpineAdapter.ts
│  │  │  └─ Live2DAdapter.ts
│  │  ├─ atlas/
│  │  ├─ store/
│  │  ├─ ai/
│  │  └─ persistence/
│  └─ public/
│     ├─ samples/             (내장 샘플)
│     └─ runtime/             (Cubism Core 등 정적 자산)
├─ packages/                  (단계적으로 분리; V1은 한 앱이어도 OK)
└─ pnpm-workspace.yaml
```

## 레포 구성 — 메인 + Vendor Submodule

폐쇄 바이너리(Cubism Core JS+wasm 등)와 라이선스 메모가 명시적인 자산은 **메인 레포에 직접 포함하지 않는다**. 별도 private 레포에 두고 git submodule로 연결.

| 레포 | 가시성 | 무엇이 들어가나 |
|---|---|---|
| `geny-avatar` | private | Next.js 앱·docs·우리가 쓴 코드. **폐쇄 바이너리 없음.** |
| `geny-avatar-vendor` | private | Cubism Core (`live2dcubismcore.min.js` 등), 라이선스가 명시적인 외부 SDK 자산. `vendor/` 경로에 submodule로 마운트 |

**Why 분리**:
- Cubism Core 같은 자산은 EULA에 따라 redistribution 조건이 있다. 메인 코드 레포의 라이선스 정책과 깨끗하게 분리.
- 메인 레포가 public으로 가면 절대 같이 갈 수 없는 자산을 미리 격리.
- vendor 자산이 큰 binary일 때 메인 레포 사이즈가 안 부푼다.
- 다른 hobby 프로젝트에서도 같은 vendor 레포를 재사용 가능.

**왜 둘 다 private인가 (지금)**: 사용자 명시 — hobby 단계에서 메인 코드를 외부에 공개할 의사 없음. 미래에 메인을 public으로 전환할 때 vendor 분리가 미리 되어 있어서 라이선스 충돌 없이 넘어갈 수 있다.

**submodule 패턴**:
```bash
# 한 번만:
git submodule add git@github.com:CocoRoF/geny-avatar-vendor.git vendor

# clone 시:
git clone --recurse-submodules <main repo>
# 또는 clone 후:
git submodule update --init
```

코드에서 vendor 자산 참조는 항상 `vendor/<sub-path>` 같은 상대 경로 — 빌드 시 Next.js의 `public/runtime/`로 복사하거나 직접 import.

**현재 상태**: 두 레포 placeholder 생성, 메인 레포 push, vendor 자산은 Phase 0 PoC에서 Cubism Core 다운로드 시점에 채움 ([progress 02](../progress/2026-05-06_02_phase0_bootstrap.md)).

## 라이선스 — 의존성 차원 (hobby 기준)

| 패키지 | 라이선스 | hobby 사용 |
|---|---|---|
| pixi.js v8 | MIT | OK |
| @esotericsoftware/spine-pixi-v8 | Spine Runtime License | OK (evaluation 범주) |
| pixi-live2d-display | MIT | OK (Cubism Core 별도 호스팅 필요) |
| Cubism Web SDK | Live2D Open Software License | OK |
| zustand | MIT | OK |
| dexie | Apache-2.0 | OK |
| jszip | MIT | OK |

## 미해결

- 내장 샘플로 어떤 puppet을 정적 호스팅할지 — [analysis/07](../analysis/07_sample_sources.md)의 라이선스 정리에 따라 결정
- 모노레포 vs 단일 앱 — V1은 단일 앱 (`apps/web` 안 만들고 root에 직접) 가능. 패키지 분리 시점은 코어 로직이 외부에서 재사용될 수 있을 때.
