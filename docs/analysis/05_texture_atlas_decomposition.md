# 05 — Texture Atlas Decomposition

이 문서가 프로젝트의 **가장 어려운 단일 문제**를 다룬다. 사용자도 "이런 것들을 정확하게 처리하여 강력한 뼈대 샘플을 제공하는 것이 주요한 과제"라고 명시.

## 무엇이 문제인가

리깅된 puppet은 보통 텍스처가 atlas로 패킹돼 있다:

```
atlas_page_0.png (2048×2048)
├─ region "hair_front"      (rect 12,12,512,768)
├─ region "hair_back"        (rect 12,792,512,640)
├─ region "face"             (rect 540,12,256,256)
├─ region "outfit_top"       (rect 540,280,720,520)
└─ ...
```

런타임 입장에서는 region이 곧 슬롯의 그래픽 원본이다. 슬라이싱 자체는 쉽다 — `.atlas` 파일이 좌표를 다 알려주니까 PIL/canvas로 잘라내면 끝.

**진짜 문제 두 가지:**

### 분해 문제 (decomposition)

아티스트가 그릴 때:
- "머리카락 앞" 텍스처 사각형 안에는 **머리카락만 있는 게 아니라**, 그 뒤에 비치는 피부의 음영, 그림자, 헤어밴드의 일부가 함께 그려져 있을 수 있다.
- "옷 상의" 안에는 옷 + 옷 위에 떨어진 머리카락 그림자 + 옷 사이로 비치는 피부 색이 baked.
- 이게 의도된 것이다 — Live2D/Spine은 알파 블렌딩으로 합성하니까 베이킹된 디테일이 최종 픽셀의 품질을 만든다.

→ **AI에게 "이 옷을 베레모로 바꿔줘"라고 시키려면 그 region에 들어있는 "옷 픽셀"만 분리해야 한다.** 그렇지 않으면 머리카락 그림자까지 옷의 일부로 학습되어 결과가 깨진다.

### 정렬 문제 (alignment)

새로 생성한 텍스처를 atlas의 같은 region 사각형에 다시 끼워넣으려면:
- **외곽선이 정확히 맞아야 한다** (메시 UV가 그 외곽선을 가정하고 있음).
- **해상도가 같거나 정수배여야 한다** (atlas page 해상도 보존).
- **알파 채널 분포가 맞아야 한다** (region 바깥은 transparent, 안쪽은 의도대로).

## 가능한 접근들 — 비교

### 접근 A — 슬라이싱만 (baseline)

`.atlas` 좌표대로 PNG를 자른다. 끝.

- **장점**: 완전히 결정론적, 빠름.
- **단점**: baked-in 그림자/잔상이 그대로 남음. AI가 옷만 다시 그릴 수 없다.
- **언제 충분?**: artist가 처음부터 깨끗하게 그린 자산이거나 (Inochi2D 호환 PSD 등), 또는 사용자가 baked detail을 받아들이는 경우.

### 접근 B — 알파/색 마스크 휴리스틱

region 안에서 알파 임계치 + 색 클러스터링으로 "주된 객체"를 추출.

- **장점**: 자동, 학습 불요.
- **단점**: 머리카락 그림자처럼 옷과 색이 비슷한 baked 영역을 못 거른다. 깔끔한 region에는 잘 동작.

### 접근 C — SAM (Segment Anything Model) 기반 자동 분할

[Segment Anything](https://segment-anything.com/) 또는 SAM 2를 region에 적용해서 "객체별 마스크"를 추출.

- **장점**: 의미론적 분리가 가능. 머리카락과 그림자를 다른 마스크로 분리 가능성.
- **단점**: 작은 region(256px 이하)에서는 SAM의 정확도가 급락. 후처리(사용자 마스크 수정 UI) 필수.
- **현실적 사용**: SAM이 후보 마스크 N개를 제안 → 사용자가 클릭/지우개로 다듬는 반자동 워크플로.

### 접근 D — 사용자 손수 마스킹

브러시·라쏘·매직완드. Krita/Photoshop 수준의 도구를 우리 UI에 박는다.

- **장점**: 100% 정확, 결과물 통제.
- **단점**: 시간 비용 큼, 사용자 진입장벽 큼.
- **현실적 사용**: 자동 결과의 fallback. "Auto가 망쳤으면 직접".

### 접근 E — Reference-aware AI 재생성 (= "분해를 포기하고 다시 그린다")

이 접근이 **우리 문제에 가장 적합할 수 있다**. baked 디테일이 있는 region을 AI에게 보여주고 "이 region을 같은 외곽선·같은 비율로 새로 그려줘"라고 시킨다.

- 입력: 원 region + 외곽선 마스크 + 프롬프트
- ControlNet (canny/lineart)로 외곽선 보존
- IP-Adapter로 캐릭터 톤 보존
- inpainting 모드 (mask = region의 알파, prompt = "white tank top, soft shading from above")
- 출력: 같은 사이즈의 새 PNG → atlas에 다시 끼워넣음

→ **분해가 완벽할 필요가 없다.** "옷 그림자에 머리카락이 묻어 있더라도, AI가 옷의 새 텍스처를 그릴 때 그 그림자를 자연스럽게 다시 그려준다." 이게 우리의 차별점이 된다.

## 실용적 결정 트리 (안)

```
region 받음
  │
  ├─ 깨끗한 자산이라고 표시됨? ──► 접근 A (슬라이싱) → AI 생성에 그대로 사용
  │
  ├─ baked detail 있음, 사용자가 "옷만"을 분리하고 싶음
  │     │
  │     ├─ 자동으로 시도 → SAM(접근 C)로 마스크 후보
  │     │     ├─ 결과 만족 → 그대로 사용
  │     │     └─ 부족 → 접근 D (사용자 브러시로 다듬기)
  │     │
  │     └─ 분리 결과를 별도 텍스처 레이어로 저장
  │
  └─ baked detail 있음, 사용자가 "이 region 통째로 새로 그려줘"
        │
        └─ 접근 E (reference-aware AI 재생성)
```

## Atlas 재패킹

새 텍스처를 받은 후 atlas page를 어떻게 갱신할 것인가:

- **옵션 1 — in-place 교체**: region rect 픽셀을 그대로 덮어쓰기. 사이즈가 동일할 때만. atlas 파일은 변경 불요.
- **옵션 2 — 재패킹**: 모든 region을 새 atlas page로 다시 채워넣기. region 크기를 바꿀 자유는 생기지만 `.atlas` 좌표를 갱신하고 파일을 새로 써야 함.
- **옵션 3 — overlay page**: 원본 atlas는 그대로 두고 변경된 region만 별도 PNG로 두고 런타임에 "이 region은 이 PNG 사용"으로 라우팅.

**1차 구현은 옵션 1이 가장 단순.** 사이즈를 바꾸고 싶다면 옵션 2로 진화. 옵션 3은 export/공유 시 복잡도가 올라가서 비추천.

## 도구·라이브러리

- [`galigalikun/unpack-spine-atlas`](https://github.com/galigalikun/unpack-spine-atlas) — Spine atlas 슬라이싱 참고 구현
- [Spine Atlas format](http://esotericsoftware.com/spine-atlas-format) — 공식 스펙
- [Spine `AtlasUtilities.GetRepackedAttachments`](http://en.esotericsoftware.com/spine-unity-attachments-and-attachmenttools) — Unity 런타임의 동적 재패킹 API. 웹용은 직접 구현해야 하지만 알고리즘 참고.
- [Segment Anything](https://github.com/facebookresearch/segment-anything) — Meta SAM
- [SAM 2 (Segment Anything 2)](https://ai.meta.com/sam2/) — 영상까지. 우리는 정지 이미지라 SAM 1으로 충분.

## [VERIFY]

- Live2D 텍스처에서 한 Drawable의 UV가 atlas 안의 사각형인지, 아니면 임의 다각형인지 — 사각형이 아니면 "region rect 덮어쓰기" 옵션 1이 안 통한다 (mesh UV에 맞춘 라스터화가 필요)
- Spine MeshAttachment의 UV가 region rect 밖으로 나갈 수 있는지 (회전 패킹 시 회전 적용 후의 좌표계 문제)
- SAM의 web inference 비용 — 클라이언트 사이드(WebGPU)에서 돌릴지, 서버 inference로 돌릴지
