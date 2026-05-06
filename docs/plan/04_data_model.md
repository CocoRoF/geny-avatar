# 04 — Data Model

우리 자체 표현. 두 런타임(Spine, Live2D) 모두 받을 수 있어야 하므로 공통분모를 잡는다. 근거는 [analysis/04](../analysis/04_layer_skeleton_model.md).

## 최상위 — Avatar

```ts
type AvatarId = string  // ULID

type Avatar = {
  id: AvatarId
  name: string
  source: AvatarSource         // 어떤 런타임에서 왔는가
  license: LicenseInfo         // 출처 라이선스
  layers: Layer[]              // 평면 list, drawOrder 보존
  groups: LayerGroup[]         // 트리 — Live2D Part 또는 Spine slot grouping
  variants: Variant[]          // Spine Skin 또는 Live2D Part 가시성 프리셋
  textures: Texture[]          // 모든 atlas page (원본 + 우리 변형)
  animations: AnimationRef[]   // 이름 기반
  parameters: Parameter[]      // Live2D은 진짜 param, Spine은 노출용 가상
  metadata: {
    createdAt: number
    updatedAt: number
    version: 1                 // 우리 스키마 버전
  }
}

type AvatarSource =
  | { runtime: 'spine', skel: AssetRef, atlas: AssetRef, pages: AssetRef[] }
  | { runtime: 'live2d', model3: AssetRef, moc3: AssetRef, files: AssetRef[] }

type AssetRef =
  | { kind: 'bundled', path: string }      // /public/samples/...
  | { kind: 'idb', key: string }           // IndexedDB blob key
  | { kind: 'inline', bytes: Uint8Array }  // 메모리 (drag-drop 직후)
```

## Layer

```ts
type LayerId = string  // ULID, 우리가 부여 (안정적)

type Layer = {
  id: LayerId
  externalId: string             // runtime의 native ID (slot name 또는 drawable index)
  groupId?: string               // LayerGroup.id
  name: string                   // UI 표기
  geometry: 'region' | 'mesh' | 'clipping' | 'path' | 'other'

  texture: TextureSlice          // 어디서 픽셀을 가져오는가
  silhouette?: Polygon           // mesh 외곽선 (AI ControlNet 입력)

  defaults: {
    visible: boolean
    color: RGBA                  // tint multiplier
    opacity: number              // 0..1
  }

  capabilities: {
    canSwapTexture: boolean      // Spine RegionAttachment / Live2D Drawable: yes
    canChangeMesh: boolean       // Spine MeshAttachment: 새 attachment 교체 가능 (T4 검증)
                                 // Live2D: no (메시는 .moc3에 baked)
    canTint: boolean             // Spine slot color, Live2D MultiplyColor 모두 yes
  }
}

type LayerGroup = {
  id: string
  name: string
  parentId?: string
  layerIds: LayerId[]
  defaultVisible: boolean
}
```

`externalId` vs `id`:
- 우리 스토어·undo 로그는 항상 `id`를 키로 쓴다.
- 어댑터가 런타임에 명령을 내릴 때만 `externalId`로 변환.
- 자산을 재로딩하거나 atlas를 재패킹해도 `id`는 안정.

## Texture

```ts
type TextureId = string

type Texture = {
  id: TextureId
  pageIndex: number              // 원본 atlas의 몇 번째 page
  origin: 'original' | 'override'
  pixelSize: { w: number, h: number }
  data: AssetRef                 // PNG bytes
  generatedBy?: GenerationRecord // override일 때 어떻게 만들어졌나
}

type TextureSlice = {
  textureId: TextureId           // 보통 origin='original' 또는 'override'
  rect: { x: number, y: number, w: number, h: number }
  rotated?: boolean              // Spine atlas 회전 패킹
  uvIslands?: UVIsland[]         // mesh의 경우 사각형 밖 UV
}

type GenerationRecord = {
  prompt: string
  negativePrompt?: string
  seed: number
  baseModel: string              // "AnimagineXL", "JuggernautXL", ...
  loras: { name: string, weight: number }[]
  controlnets: ControlNetEntry[]
  refImages?: AssetRef[]
  generatedAt: number
}
```

**Override 방식**: 원본 텍스처를 변경하지 않는다. 어댑터에 "이 layer의 texture는 이 override를 써라"라고 매핑한다 (D5).

## Variant — 의상/스킨

```ts
type Variant = {
  id: string
  name: string                   // "Casual", "Swimwear"
  description?: string
  overrides: {
    // layerId → 그 variant에서의 상태
    [layerId: LayerId]: {
      visible?: boolean
      color?: RGBA
      attachmentName?: string    // Spine: skin의 attachment 이름
      textureId?: TextureId      // 텍스처 override
    }
  }
  thumbnail?: AssetRef
}
```

**활성화**: 한 시점에 한 Variant가 active. active variant의 override가 layer.defaults 위에 적층.

**Spine Skin과의 매핑**: Spine 모델을 임포트하면 각 Skin이 한 Variant로 import되고, 슬롯의 attachment name이 `overrides[layerId].attachmentName`에 들어간다.

## Animation

```ts
type AnimationRef = {
  name: string                   // "idle", "wave", "aim"
  duration?: number              // 초; Live2D는 지정, Spine은 키프레임 합산
  loop: boolean
  source: 'spine-track' | 'live2d-motion'
}
```

V1에서는 애니메이션 파일을 직접 편집하지 않는다. 재생/정지/루프만.

## Parameter

```ts
type Parameter = {
  id: string
  name: string
  min: number
  max: number
  default: number
  source: 'live2d-param' | 'spine-virtual'
}
```

Live2D 모델의 `Parameter*` ID들이 직통. Spine은 직접 노출되는 파라미터가 없으므로, 미래에 우리가 "본 회전 X을 슬라이더로 매핑"하는 가상 파라미터를 만들 수도 있음 (V1 스코프 외).

## 상태 — Store가 들고 있는 것

```ts
type EditorState = {
  avatar: Avatar | null

  ui: {
    selectedLayerIds: LayerId[]
    activeVariantId?: string
    playingAnimation?: string
    parameterValues: { [id: string]: number }
    canvasViewport: { zoom: number, pan: { x, y } }
    panelMode: 'tools' | 'layers' | 'generate' | 'decompose'
  }

  // 사용자가 만든 변경 — defaults 위에 적층
  workingOverrides: {
    visibility: { [layerId: LayerId]: boolean }
    color:      { [layerId: LayerId]: RGBA }
    texture:    { [layerId: LayerId]: TextureId }
  }

  // AI 작업 큐
  aiJobs: AIJob[]

  // Undo/Redo
  history: {
    past: EditorPatch[]
    future: EditorPatch[]
  }
}

type AIJob = {
  id: string
  layerId: LayerId
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  request: GenerationRecord
  startedAt: number
  resultTextureId?: TextureId
  error?: string
  progress?: number  // 0..1
}
```

## Persistence — 직렬화

`Avatar`는 JSON으로 직렬화 가능해야 한다 (texture data는 별도 IndexedDB key). Export 시:

```
my-avatar.geny-avatar.zip
├─ avatar.json              // Avatar 메타 (textures.data는 path 참조)
├─ textures/
│  ├─ original_0.png
│  ├─ override_<id>.png
│  └─ ...
├─ runtime/
│  ├─ source/               // 원본 puppet 파일 (수정 안 함)
│  └─ patched/              // 변경 적용된 atlas/모델 (재패킹 결과)
├─ LICENSE.md               // license info + override generation records
└─ README.md                // 자동 생성, 무엇이 변경되었는지
```

Re-import 시 같은 ZIP을 받아 동일 상태로 복원 가능해야 한다. 이건 V1 수락 기준의 일부.

## 호환성 정책

- `metadata.version = 1`. 스키마 변경 시 버전 올리고 마이그레이션.
- 미지의 필드는 보존 (forward compatibility).
- Texture data와 metadata는 항상 분리 — 큰 binary가 JSON에 들어가지 않게.

## [VERIFY]

- Spine .skel/.json 모두에서 동일한 layer 추상화로 import할 수 있는가 (ts runtime이 둘 다 파싱하므로 OK일 가능성 높음)
- Live2D .cdi3.json (display info) 가 Layer.name에 사용될 수 있는지 — 다국어 캐릭터의 한국어 라벨 등
