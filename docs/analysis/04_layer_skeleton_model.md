# 04 — Layer & Skeleton Model

각 포맷의 "레이어/뼈대" 추상화를 한 자리에서 비교한다. **우리 자체 데이터 모델은 이 추상화의 공통분모**가 되어야 한다 — 두 런타임을 모두 받을 수 있도록.

## 용어 매핑 — 한눈에

| 우리 추상화 | Live2D | Spine | Inochi2D |
|---|---|---|---|
| **Avatar** (한 캐릭터 패키지) | model3.json + assets | skel/json + atlas + pages | inp |
| **Bone** (변환 노드) | (Part 계층의 변환은 implicit) | Bone | Node (transform) |
| **Layer** (그리는 단위) | Drawable / ArtMesh | Slot의 현재 attachment | Drawable Node |
| **LayerGroup** (계층 그룹) | Part | (없음 — slot은 평면적, skin/draw order로 그룹) | Node 계층 |
| **Texture region** (UV 사각형) | Drawable의 텍스처 인덱스 + UV | Atlas region | Texture |
| **Variant** (의상/스킨) | Part 가시성 조합 (관례) | **Skin** | (없음) |
| **Anim parameter** | Parameter (graph) | Animation (timeline) | Parameter |

## Live2D — Drawable 중심

```
Model
├─ Parts[]            (계층적 그룹, opacity 제어)
│  └─ ChildParts[]
└─ Drawables[]        (그리는 실제 단위; flat list, drawOrder로 정렬)
   ├─ textureIndex    (어느 PNG?)
   ├─ vertexUVs[]     (UV)
   ├─ vertexPositions[] (파라미터에 따라 dynamic)
   ├─ opacity         (dynamic)
   ├─ multiplyColor   (RGB; Cubism 4.2+)
   ├─ screenColor     (RGB)
   └─ parentPartIndex
```

- **편집 단위 = Drawable.** 한 Drawable은 한 텍스처 영역 + 한 변형 메시 + 한 색.
- "이 슬롯의 텍스처를 갈아끼운다" = textureIndex가 가리키는 PNG의 해당 UV 영역을 다시 그린다.
- Drawable 자체를 "다른 모양"으로 바꿀 수는 없다 (메시 토폴로지가 .moc3에 baked). 텍스처만 바꿀 수 있다 — 이건 우리 목적상 큰 제약은 아니다.

## Spine — Slot + Skin 중심

```
Skeleton
├─ Bones[]                (계층)
├─ Slots[]                (drawing position; bone에 부착)
│  ├─ defaultAttachment
│  └─ color (RGBA tint)
├─ Skins[]
│  └─ Skin
│     └─ attachments: { (slotIndex, name) → Attachment }
└─ Attachments (skin 안에 들어감)
   ├─ RegionAttachment   (텍스처 사각형)
   ├─ MeshAttachment     (정점 가중치 메시)
   ├─ ClippingAttachment
   ├─ PathAttachment
   └─ BoundingBoxAttachment
```

- **편집 단위 = Slot의 attachment.** 슬롯에 등록된 attachment 중 하나가 활성화된다.
- **의상 교체 = Skin 교체.** 같은 슬롯 이름에 여러 이름의 attachment를 등록해 두면 skin을 바꾸는 것만으로 모든 슬롯이 한꺼번에 새 그래픽으로 바뀐다 — 완벽한 outfit swap.
- "이 슬롯의 텍스처를 다시 그린다" = 그 attachment가 참조하는 atlas region의 픽셀을 갈아끼운다 (RegionAttachment) **또는** 그 attachment의 메시 + 텍스처 자체를 새 attachment로 교체한다 (MeshAttachment, runtime에서 새 attachment 생성 가능).

## 함의 — 우리 데이터 모델

두 런타임을 모두 받으려면 우리 자체 표현은 다음 정도여야 한다:

```ts
type Avatar = {
  id: string
  source: { runtime: 'spine' | 'live2d', files: AssetRef[] }
  layers: Layer[]            // flat list, drawOrder 보존
  groups: LayerGroup[]       // 트리 (Part 또는 ad-hoc)
  variants: Variant[]        // Spine skin 또는 Live2D Part 가시성 프리셋
  animations: AnimationRef[]
  parameters: Parameter[]    // Live2D는 진짜 param, Spine은 노출용 가상 param
}

type Layer = {
  id: string                 // stable, 우리가 부여
  externalId: string         // runtime에서의 식별자 (slot 이름 또는 drawable index)
  groupId?: string
  texture: TextureSlice      // atlas region 정보
  defaultColor: { r,g,b,a }  // tint
  defaultVisible: boolean
  geometry: 'region' | 'mesh' | 'clipping' | 'path' | 'other'
  // mesh 정보 — 편집은 안 하지만 AI 생성 시 외곽선 가이드로 씀
  meshSilhouette?: Polygon
}

type TextureSlice = {
  pageId: string             // 어느 atlas page (PNG)
  rect: { x, y, w, h }       // 페이지 내 픽셀 좌표
  rotated?: boolean          // Spine atlas는 90도 회전 패킹 가능
  uvIslands?: UVIsland[]     // mesh의 경우 UV가 사각형이 아닐 수 있음
}
```

핵심 디자인 결정:

- **layer.id는 우리가 부여한다** (안정적). 외부 런타임 ID는 변할 수 있다 (특히 atlas 재패킹 시).
- **texture는 별도 객체**다. 한 텍스처를 여러 layer가 공유할 수 있고, AI 생성은 텍스처 단위에서 일어난다.
- **mesh silhouette은 저장한다** — AI 생성 시 ControlNet canny/lineart의 입력이 된다. 메시를 편집할 일이 없어도 외곽선 정보는 필요.

## 그룹/스킨/변형 — 우리는 어떻게 표현?

- Spine의 Skin → 우리의 `Variant`. "교복 / 사복 / 수영복" 같은 동시 선택 그룹.
- Live2D의 Part 가시성 조합 → 동일하게 `Variant`로 묶을 수 있다 (Live2D 자체에는 skin 개념이 없지만 우리가 "이 Part 셋을 켜라"의 명명된 묶음을 만들면 된다).
- 한 Variant는 `{ layerId → { visible?, color?, attachmentName? } }` 오버라이드 맵.

## 그리기 순서 (draw order)

- Live2D: Drawable의 `drawOrder` 동적 파라미터 (Drawable 자체의 정적 인덱스 ≠ 매 프레임 그리기 순서).
- Spine: Slot 순서 (애니메이션이 `drawOrder` 키프레임으로 바꿀 수 있음).
- 우리 모델: layers를 list로 들되 **drawOrder는 read-only로 표시**. 편집기에서 표시할 때만 "현재 drawOrder"로 정렬해서 보여주고, 사용자는 직접 순서를 못 바꾼다 (런타임이 결정). 단, 가시성·색은 오버라이드.

## [VERIFY]

- Spine MeshAttachment를 런타임에서 새 attachment로 교체할 때 본 가중치가 자동 매핑되는지, 아니면 메시 정점 수가 동일해야 하는지
- Live2D Drawable의 textureIndex를 런타임에서 다른 PNG로 바꾸는 게 SDK API로 노출되어 있는지 (텍스처 핫스왑) — 안 되면 atlas 자체를 통째로 갈아끼우는 식이 된다
