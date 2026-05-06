# 03 — Rendering Runtimes (Web)

브라우저에서 위 포맷들을 실제로 그릴 수 있는 라이브러리.

## Pixi.js v8 — 공통 기반

- WebGL · WebGPU · Canvas 멀티 백엔드. 2026 시점 v8이 안정. ([pixijs.com](https://pixijs.com/))
- Spine·Live2D·Inochi 어느 쪽을 쓰든 Pixi가 화면에 픽셀을 올리는 마지막 레이어가 된다.
- 우리 입장에서 Pixi는 **선택이 아니다 — 거의 강제**. React/Next.js와 잘 붙고, 후처리·필터·Canvas-to-PNG가 모두 이 위에서 끝난다.

## Spine 런타임 — `@esotericsoftware/spine-pixi-v8`

- Esoteric Software 공식. PixiJS 팀과 공동 개발. ([blog: spine-pixi-v8 released](http://esotericsoftware.com/blog/spine-pixi-v8-runtime-released))
- WebGL / WebGPU / Canvas 모두 지원. WebGPU 하드웨어 가속이 spine-ts 계열 최초로 들어옴.
- npm: `@esotericsoftware/spine-pixi-v8`. Pixi v8과 같이 설치.
- API 진입점: `Spine.from({ skeleton: '*.skel', atlas: '*.atlas' })` → DisplayObject.
- 슬롯·스킨·attachment를 런타임에 **이름으로 접근/교체** 가능. 우리 레이어 패널의 1:1 데이터 소스.

## Live2D 웹 런타임 — 두 갈래

### (a) Cubism Web SDK (공식)

- Live2D Inc. 공식. TypeScript. WebGL 직접 호출.
- 진입점: `Live2DCubismFramework`. 모델 로딩·파라미터·물리 등 전부 직접 wiring해야 한다.
- 장점: 공식이라 모든 기능(Multiply/Screen Color, 물리, 모션 그룹) 다 노출.
- 단점: API가 raw하다. Pixi에 직접 박을 수 없고 wrapper가 필요.

### (b) `pixi-live2d-display` 계열 (서드파티)

- [`guansss/pixi-live2d-display`](https://github.com/guansss/pixi-live2d-display): PixiJS v6용. Cubism 2/3/4 모두 지원. 가장 알려져 있음.
- [`pixi-live2d-display-lipsyncpatch`](https://www.npmjs.com/package/pixi-live2d-display-lipsyncpatch): v7 + 립싱크 패치 포크.
- [`Untitled-Story/untitled-pixi-live2d-engine`](https://github.com/Untitled-Story/untitled-pixi-live2d-engine): **PixiJS v8 + Cubism 5 SDK 호환**. 가장 최신 (2026 활성).
- 모두 내부에서 Cubism Core (`live2dcubismcore.js`)를 로드 — Cubism Core는 Live2D Inc.가 배포하는 폐쇄 바이너리(JS+wasm). 별도 다운로드 후 정적 호스팅 필요.

## Inochi2D 웹 런타임

- 공식 웹 런타임은 사실상 부재 [VERIFY]. Inochi Creator는 D 언어 데스크톱 앱.
- `*.inp` 포맷 자체는 ZIP 컨테이너 + JSON 매니페스트 + PNG 텍스처라 자체 web 런타임을 만드는 게 비현실적이지는 않지만 **상당한 작업**.
- 단기적으로는 우선순위 낮음.

## NIKKE-DB visualiser의 실제 구현

- 상위 레포: [`Nikke-db/Nikke-db.github.io`](https://github.com/Nikke-db/Nikke-db.github.io) — 86.7% JavaScript, vanilla JS (React/Vue/Svelte 없음). `package.json`이 있지만 빌드 도구 정도이고 SPA 프레임워크는 안 씀.
- visualiser 자체: [`Nikke-db/spine-web-player-template`](https://github.com/Nikke-db/spine-web-player-template) 기반. **Esoteric Software의 official Spine web player**를 얇게 감싼 vanilla JS. Spine 4.0/4.1만 지원. 2026-03-08에 archive 처리됨.
- 즉 NIKKE visualiser는 우리가 보고 있는 그 화면도 **`spine-player.js` + 커스텀 UI**다. 파라미터 슬라이더·레이어 토글·RGB 마스크는 모두 Spine 런타임의 `Skeleton` API(`findSlot`, `setAttachment`, slot color RGB) 위에 직접 구현되어 있다.
- 함의: **우리가 NIKKE visualiser 같은 경험을 spine-pixi-v8 위에 만드는 데 기술적 장애가 거의 없다.** UI만 잘 만들면 된다.

## 비교 (런타임 관점)

| 런타임 | 포맷 | 베이스 | 라이선스 (hobby 기준) | 슬롯/레이어 API | WebGPU | 비고 |
|---|---|---|---|---|---|---|
| `@esotericsoftware/spine-pixi-v8` | Spine | Pixi v8 | OK (evaluation) | 매우 좋음 (Skin/Slot/Attachment 직접) | O | 1차 후보 |
| Cubism Web SDK | Live2D | raw WebGL | OK (Live2D Open Software License) | 상 (Drawable, Part, Multiply/ScreenColor) | X | 정확하지만 raw |
| `untitled-pixi-live2d-engine` | Live2D | Pixi v8 | OK (오픈소스, LICENSE 확인) | 상 | X (Pixi v8이 WebGPU 지원이지만 Live2D 코어 자체가 WebGL) | Pixi v8 + Cubism 5 |
| `pixi-live2d-display` | Live2D | Pixi v6 | MIT | 상 | X | 가장 보편적, v8 전환 필요 |
| (Inochi2D 웹 런타임) | Inochi2D | — | — | — | — | 사실상 부재 |

## 결정 압력

- **Pixi v8 위에 Spine + Live2D 두 런타임을 동시 1차로** ([P1](../README.md)). spine-pixi-v8 + (untitled-pixi-live2d-engine 또는 v8 포팅된 pixi-live2d-display) 조합.
- 두 런타임을 같이 쓰면 Pixi 캔버스 한 개에 둘 다 마운트할 수 있어야 한다 — 서로의 GL state를 망치지 않는지 [VERIFY] (T-rt1).
- 사용자가 업로드한 임의 puppet 파일을 받아 자동 감지: 파일명/MIME/매니페스트 헤더로 Spine vs Cubism 구분 + 버전 감지.
- 빌드인 데모 자산은 권리가 깨끗한 것 (Live2D 공식 샘플 + Spine 공식 샘플 + 자체 제작)만. 게임 추출 자산은 사용자가 자기 환경에서 로드하는 것까지로 한정 ([07 Sample Sources](07_sample_sources.md)).
- 결정은 [plan/03_tech_stack](../plan/03_tech_stack.md)에서.

## [VERIFY]

- T-rt1 — spine-pixi-v8과 Live2D 런타임이 같은 Pixi Application의 stage에 동시 마운트될 때 텍스처 바인딩/GL state가 충돌하지 않는지 (Phase 0 PoC에서 확인)
- `untitled-pixi-live2d-engine`의 슬롯/레이어 API 노출 범위 — 레포 README와 데모 코드 확인
- Cubism Web SDK가 Cubism 2 모델을 받는지, 받는다면 같은 SDK 호출로 가능한지 (구버전 SDK 분리 필요 여부)
- Spine 3.8 모델을 spine-pixi-v8(4.x 기반)이 받는지, 받는다면 silent breakage 없는지
