# 02 — Format Landscape

2D rigged puppet을 표현하는 주요 포맷들. V1에서 **Cubism과 Spine 모두 1차로 지원**하기로 확정 ([P1 in README](../README.md))이라 이 문서는 두 포맷의 구조 비교 + 버전 스팬·자산 풀의 사실 정리에 집중.

## Live2D Cubism

- **무엇**: 일본 Live2D Inc.의 폐쇄형 2D 애니메이션 시스템. VTubing 사실상 표준.
- **파일 구성**: 모델 디렉터리 1개당 — `*.model3.json` (매니페스트), `*.moc3` (바이너리: 메시 + 파라미터 그래프), 텍스처 PNG들, `*.physics3.json`, `*.cdi3.json`(파라미터 ID 한글화), `*.userdata3.json`, 모션 `*.motion3.json`. 매니페스트가 모든 상대 경로를 들고 있어서 로딩 진입점은 `model3.json` 단 하나. ([Live2D SDK Manual — About Models (Native)](https://docs.live2d.com/en/cubism-sdk-manual/model/))
- **레이어 단위**: **Drawable** = 한 ArtMesh = 한 텍스처 사각형 + 변형 메시. **Part** = Drawable들의 계층적 그룹 (Part 단위 opacity 제어 가능). 각 Drawable은 **MultiplyColor / ScreenColor** (RGB만, 알파 미사용; multiply=흰색이면 비활성, screen=검정이면 비활성. Cubism 4.2+) 색조 조작을 SDK가 직접 지원한다.
- **변형**: 파라미터 그래프(예: 눈 깜박임 0~1, 입 벌림 0~1)가 Drawable 정점을 보간한다. 파라미터를 흔드는 게 그 자체로 애니메이션이 된다.
- **라이선스**: Live2D Cubism SDK는 distribution 라이선스가 있고, 샘플 모델은 ["Free Material License Agreement"](https://www.live2d.com/eula/live2d-sample-model-terms_en.html)로 General Users / 소규모 사업자에게 상업 이용 허용. **우리는 1인 hobby = General User**라 통과. (자세한 컨텍스트는 [07 Sample Sources](07_sample_sources.md))
- **편집기**: Cubism Editor (데스크톱, Free/Pro). 우리 도구는 Editor를 대체하는 게 아니라 **Editor 산출물을 받아 텍스처만 다시 그리는 후공정**.

## Spine 2D (Esoteric Software)

- **무엇**: Esoteric Software의 범용 2D 스켈레탈 애니메이션. NIKKE·Cookie Run·HoYoverse 일부 등 게임에서 광범위 사용.
- **파일 구성**: `*.skel`(바이너리) 또는 `*.json`(텍스트) + `*.atlas`(텍스처 영역 텍스트 정의) + 1개 이상의 PNG atlas 페이지. ([Spine — Atlas export format](http://esotericsoftware.com/spine-atlas-format))
- **레이어 단위 — 핵심 추상화**:
  - **Bone**: 변환(이동·회전·스케일)의 계층.
  - **Slot**: bone에 붙는 "그리는 자리". 한 slot은 한 시점에 attachment 1개를 표시.
  - **Attachment**: slot에 끼울 수 있는 그래픽 — region(텍스처 사각형), mesh(가중치 변형), clipping, path, bbox. **이름으로 식별된다.**
  - **Skin**: `(slotIndex, attachmentName) → attachment` 매핑의 모음. 한 슬롯에 같은 이름으로 다른 attachment를 등록해 둔 다음, **skin을 갈아끼우면 그 슬롯의 attachment가 통째로 교체된다**. 의상 교체가 자연스럽다.
- **변형**: 본 회전·메시 변형·deform 키프레임. 파라미터 그래프가 아니라 **타임라인 기반 애니메이션**.
- **라이선스**: Spine 런타임은 평가용 무료, 상업 이용 시 Spine Editor 라이선스 필요 (Essential $69, 1회 결제). **우리는 hobby = evaluation 범주**로 행동, 미래에 상업화하면 그때 라이선스 검토. ([spine-pixi runtime](https://esotericsoftware.com/blog/spine-pixi-v8-runtime-released))

## Inochi2D

- **무엇**: 오픈소스 2D 퍼펫 시스템. BSD 2-Clause. PSD 임포트 + 자체 리깅 도구(Inochi Creator).
- **파일 구성**: `*.inp`(퍼펫 패키지) / `*.inx`(익스포트). 각 노드는 PSD 레이어와 1:1로 시작해서 메시·deformer로 확장된다.
- **레이어 단위**: PSD 레이어가 곧 노드. 깨끗한 매핑이 강점. 단, [공식 문서](https://docs.inochi2d.com/)에 따르면 PSD 임포트는 여전히 WIP — 일부 blending mode가 잘못 적용되거나 hidden 레이어가 누락되는 알려진 이슈.
- **라이선스**: BSD 2-Clause. 가장 자유롭다.
- **약점**: 생태계 작음. 고품질 무료 puppet 자산이 Live2D만큼 풍부하지 않음. 데스크톱 도구 중심이라 웹 런타임은 자체 구현 또는 포팅이 필요.

## PSD-기반 (PSDtool, Glimpse, kfm 등)

- 진짜 "포맷"이라기보단 **레이어드 PSD를 직접 web에서 토글하는** 접근. 본은 없고 레이어 보이기/숨기기만.
- 우리 목적상 너무 정적. 다만 **AI 텍스처 생성 후 PSD로 export**하는 건 좋은 부산물 (Inochi2D나 Cubism Editor로 다시 가져갈 수 있음).

## 우리 입장에서 비교 (사실만)

| 항목 | Live2D | Spine | Inochi2D |
|---|---|---|---|
| 무료 고품질 puppet 풀 | ★★★ (공식 샘플 + nizima 등) | ★★ (게임 추출 자료는 외부 배포 X, 본인 환경에선 OK) | ★ |
| 웹 런타임 성숙도 | ★★★ (Cubism Web SDK 5.4 + pixi-live2d-display 계열) | ★★★ (`@esotericsoftware/spine-pixi-v8`, WebGPU 지원) | ★ (자체 web 런타임 미성숙) |
| 라이선스 (1인 hobby 기준) | ★★★ (General User로 통과) | ★★★ (evaluation으로 통과) | ★★★ (BSD-2) |
| 슬롯/스킨 추상화의 명확성 | 중 (Drawable + Part) | **상** (Slot + Skin 시스템이 의상 교체에 최적) | 중 (PSD 레이어) |
| 텍스처 분리 난이도 | 중 (artist convention에 의존) | 상 (atlas 패킹이 공격적) | 하 (PSD 레이어 분리) |

## 직접적인 함의

- **Cubism과 Spine 모두 V1에서 1차 지원** ([P1 in README](../README.md)). 둘 다 자산 풀이 충분하고, 두 포맷이 인터넷에 반반씩 존재해서 한쪽만 지원하면 사용자가 발견한 자산의 절반을 못 쓴다.
- Spine의 강점: Skin/Slot/Attachment 추상화가 의상 교체에 자연스러움.
- Live2D의 강점: 자산 풀(공식 + nizima + 서드파티)이 풍부, MultiplyColor/ScreenColor 같은 색조 API가 깔끔.
- **Inochi2D는 V1 비대상.** 웹 런타임 부재 + 자산 풀 빈약. 미래 확장.

버전 스팬:
- Spine: 3.8 / 4.0 / 4.1 / 4.2 — 인터넷에 있는 자산이 다양한 버전을 쓴다. 모두 받아야 한다.
- Cubism: 2 / 3 / 4 / 5 — 마찬가지. 오래된 모델은 Cubism 2~3, 최근은 4~5.

런타임/스택 결정은 [plan/03_tech_stack](../plan/03_tech_stack.md)에서. 여기서는 사실만.

## [VERIFY] — 미래에 스코프 확장 시

- Inochi2D 웹 런타임 — 공식 web 런타임이 존재하는지, 아니면 `*.inp`를 web에서 그리려면 자체 구현인지

(라이선스 관련 [VERIFY] 항목은 hobby 단계에서는 차단 요인이 아니므로 제거. 상업화 시점에 다시 추가.)
