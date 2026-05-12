# 04 — Phase 4 실행 계획

**목표**: 캐릭터 전체를 렌더해서 AI에게 보내고, 결과를 atlas page들로
back-project하는 길을 연다. cross-drawable 일관성을 구조적으로 해결
하는 strategic differentiator.

**예상 기간**: 1주 spike + 통과 시 8–12주.

**선행 의존**: Phase 3 종료. 그리고 **spike 통과**가 본격 착수의
gating condition.

**분석 출처**:
- [docs-upgrade/04-multipart-problem.md](../04-multipart-problem.md) Architecture C
- [docs-upgrade/07-strategy-options.md](../07-strategy-options.md) Option 4
- [docs-upgrade/09-phased-roadmap.md](../09-phased-roadmap.md) Phase 4

## 0주차 — Spike (필수 게이트)

**spike 통과 조건**:
- Hiyori에서 jacket 1개 drawable에 대해 pixel-to-triangle-to-atlas
  매핑이 동작.
- AI가 편집한 character render의 jacket 영역이 jacket atlas page의
  올바른 위치에 back-project.
- rotation flag, padding awareness 모두 처리.
- 결과가 head turn ±15°에서 seam 없이 보존.

**spike에서 안 하는 것**:
- 다중 drawable 처리. 단 하나로 검증.
- occlusion 해결. 다른 drawable과 안 겹치는 jacket 1개로 시작.
- 풀 production-grade 에러 처리.

**spike 손볼 파일** (모두 신설, spike 폴더):
- `lib/avatar/backproject/spike.ts` — 메인 spike 코드.
- `lib/avatar/backproject/pixelToTriangle.ts` — 핵심 매핑 함수.
- `lib/avatar/backproject/atlasUnpack.ts` — atlas rect → drawable pixel
  unpack.

**spike 검증**:
- jacket 영역 픽셀 중 정상 매핑된 비율 ≥80%.
- back-project 결과의 시각적 일관성 (overrides로 적용 후 화면에서
  자연스러운지).
- 동일 영역을 Phase 3 orchestrator로도 만들어 비교. 80% 이상 케이스
  에서 back-project가 더 자연스러운지.

**spike 후 결정 회의** (혼자라도):
- 통과 → Phase 4 본격 착수.
- 부분 통과 (60–80%) → 일부 한계 인정하고 제한된 형태로 ship.
- 실패 (<60%) → Phase 4 defer. Phase 3가 v3까지 main path.

## 작업 1 — Canonical pose render at full resolution

**왜**: Phase 1에서 만든 canonical pose는 1024 wide. back-project에는
원본 atlas 해상도 (보통 2048–4096) 만큼 큰 게 필요.

**손볼 파일**:
- `lib/avatar/canonicalPose.ts` (Phase 1에서 만든 것) — `width: 2048`
  옵션 추가. 또는 `renderFullResolution()` 별도 메서드.

**구현 메모**:
- 메모리 비용: 4096×4096 RGBA = 64 MB. 메모리 한 번에 두 장 이상
  들고 있지 않게 주의.
- AI는 받는 사이드 한계가 있음 (gpt-image-2: 4MP). 그 한계에 맞춰
  downscale 후 보낸 뒤, back-project 시점에 upscale 매핑.

## 작업 2 — Pixel → triangle → atlas mapping

**왜**: 작업의 핵심. character render의 한 pixel이 어떤 drawable의
어떤 mesh triangle에 속하는지, 그 triangle이 atlas 어디에 있는지
완전한 매핑.

**손볼 파일**:
- `lib/avatar/backproject/mapping.ts` (신설) — `mapPixelToAtlas(x, y)
  → { drawableIndex, atlasRect, atlasPixel }`.

**구현 메모**:
- 입력: 캐릭터 화면 좌표.
- 단계:
  1. 어떤 drawable에 속하는지? → ray casting / z-order 확인. Live2D
     SDK에서 drawable index + mesh triangle index 받아오는 API 사용.
  2. 그 triangle의 atlas UV 좌표 → barycentric으로 atlas 픽셀 좌표
     역산.
  3. atlas rect rotation flag 적용 (rotated atlas islands는 90°
     회전).
  4. 4 px padding 보정 (atlas packing 패딩이 매핑에서 빠짐).
- 인접 island 충돌 시 우선순위는 화면 z-order의 위쪽이 win.

**검증**:
- 알려진 좌표에 가짜 색 칠하고 atlas에서 그 픽셀이 정상 색인지.
  ex) jacket 왼쪽 어깨에 빨간 점 → atlas page의 정확한 위치에 빨간 점.

## 작업 3 — Occlusion 처리

**왜**: 캐릭터 렌더에서 2개 drawable이 한 픽셀을 공유 (앞머리가 얼굴
가림). AI가 그 pixel을 편집했을 때 어디로 보낼 건가?

**손볼 파일**:
- `lib/avatar/backproject/occlusion.ts` (신설) — visibility mask 계산.

**구현 메모**:
- 각 pixel별로 visible drawable들의 list를 유지.
- 가장 위 (z-order 최상위)에 변경 commit. 그 아래는 보이지 않으니
  손대지 않음.
- alpha < 1 면 (반투명 머리카락 등) 둘 다 영향. 그땐 alpha-weighted
  blending. 단 v1에선 top opaque drawable에만 commit하는 것으로
  단순화 시작.

**검증**:
- 앞머리 + 얼굴 겹치는 영역에서 AI 편집 결과가 앞머리 atlas에만
  반영되고 얼굴 atlas는 변하지 않는지.

## 작업 4 — Group mask 생성

**왜**: AI에게 "이 영역만 편집해"를 알려주려면 image-space mask
필요. 그룹 멤버 drawable들의 clip path 합집합.

**손볼 파일**:
- `lib/avatar/backproject/groupMask.ts` (신설).

**구현 메모**:
- 그룹 멤버 drawable마다 alpha-clipped silhouette → image space로
  렌더 → union.
- Phase 1 작업 1의 mask erosion도 여기서 동일하게 적용.

## 작업 5 — AI 단일 호출 path

**왜**: 오케스트레이터처럼 N호출이 아니라 single call. 한 번에 캐릭터
편집.

**손볼 파일**:
- `lib/ai/backproject/singleShot.ts` (신설) — `generate(canonicalRender,
  groupMask, prompt)`.

**구현 메모**:
- provider는 gpt-image-2 (마스크 honour 강함).
- image[1] = full character render, alpha-cleared outside mask.
- image[2] = original character render (reference).
- Phase 3에서 만든 references / prompt template 재사용 가능.

## 작업 6 — Back-projection composition

**왜**: AI 결과를 각 drawable의 atlas slot에 분배해서 layerTextureOverride
로 합성하는 마지막 단계.

**손볼 파일**:
- `lib/avatar/backproject/compose.ts` (신설).

**구현 메모**:
- AI 결과 이미지에서 각 pixel을 atlas mapping (작업 2) 통해 분배.
- drawable별로 빈 atlas-sized canvas 만들고 매핑된 pixel 채워 넣음.
- 결과를 `setLayerTextureOverride(layerId, blob)` 호출. 기존 Phase 1
  파이프라인 그대로.
- provenance source = "ai" + 새 flag `via: "backproject"`.

## 작업 7 — Intent dispatcher 라우팅 추가

**왜**: 어떤 intent를 어느 path (Phase 3 orchestrator vs Phase 4
backproject)로 보낼지 결정.

**손볼 파일**:
- Phase 3 작업 2의 `dispatcher.ts` — 라우팅 룰 추가.

**라우팅 룰** (v0):
- "Character mode" 토글이 ON이면 backproject 우선.
- intent type이 `ai-multipart`이고 모든 target group이 character mode
  지원 그룹 (top + bottom + accessory 류)이면 backproject.
- 한 그룹만 (hair_* 단일) 또는 character mode 안 켜졌으면 orchestrator
  fallback.

**구현 메모**:
- 두 path는 결과 surface 동일 (per-group review). 라우팅 차이는
  사용자 입장에선 "어느 방식으로 가는지" 정도.

## 작업 8 — Character mode 토글 UI

**왜**: 사용자가 명시적으로 character mode를 켤 수 있어야 함. Phase 4
spike가 통과해도 모든 케이스에서 backproject가 더 나은 건 아니므로.

**손볼 파일**:
- `components/IntentBar.tsx` (Phase 3) — "🎭 Character mode" 토글 추가.

## 작업 9 — Animation 안정성 평가

**왜**: backproject는 canonical pose 기준으로 편집한 거라서 파라미터
극단값에서 깨질 수 있음. 매 commit 직전 평가.

**손볼 파일**:
- `eval/runner.ts` 확장 — backproject 결과에 대한 extra animation
  checks.

**구현 메모**:
- 6 extreme parameter combos에서 렌더링 후 seam / drift 자동 검출.
- 실패 시:
  - 사용자에게 알림: "이 편집은 머리 30° 회전에서 깨집니다. 그래도
    적용하시겠습니까?".
  - "Use orchestrator instead" 옵션 제공 (Phase 3 path로 자동 fallback).

## 작업 10 — backProjections IDB 스토어

**왜**: backproject 결과 전체 render와 per-drawable patch들을 캐싱.
재실행 시 빠른 비교 / undo 위해.

**손볼 파일**:
- `lib/persistence/db.ts` — `backProjections` 스토어 추가.
- 필드 정의는 [11-data-model-evolution.md](../11-data-model-evolution.md)
  "Phase 4 schema additions".

## 작업 11 — A/B 비교 surface

**왜**: 같은 intent를 orchestrator + backproject 두 방식으로 돌려서
비교할 수 있어야 path 선택을 발전시킬 수 있음. 사용자가 "Use
orchestrator instead" 누르면 옆에 결과 두 개 나란히.

**손볼 파일**:
- `components/PathCompareView.tsx` (신설).
- A/B 결과는 둘 다 metadata에 저장.

## Ship criteria — Phase 4 종료 조건

- [ ] Spike 통과: jacket 1개 drawable에서 pixel mapping 정확도
      ≥80%.
- [ ] Production: "school uniform" 시나리오에서 backproject 결과를
      A/B 했을 때 70% 이상 backproject 선호.
- [ ] Animation eval: 6개 extreme 모두에서 seam / drift <1%.
- [ ] Occlusion 처리가 머리/얼굴 겹침에서 정상 동작.
- [ ] backProjections 스토어가 IDB에 정상 영속화.

## 위험 / 차단 요소

| 위험 | 대응 |
|---|---|
| Spike에서 pixel mapping이 안 됨 (회전된 atlas island가 매핑 깨짐) | Spike 통과 안 되면 Phase 4 defer. 충분한 사유 |
| Live2D SDK에서 pixel → triangle 조회 API 없음 | mesh triangle 목록은 받을 수 있으니 ray casting 직접 구현 |
| Occlusion이 너무 어려움 (5개 drawable이 한 pixel 공유) | v1은 top opaque drawable만 commit. 알파 blending은 v2 |
| AI가 mask 밖 픽셀까지 손댐 | Phase 1 mask erosion + alpha-clip post-process |
| Animation eval에서 seam이 자주 발생 | seam이 자주 발생하는 케이스는 orchestrator fallback으로 자동 라우팅 |
| Canonical pose 메모리 큰 거 부담 | 메모리 watchdog. 4096×4096 한 장만 유지 |
| 사용자 입장에서 두 path 차이를 모름 | A/B view (작업 11)로 비교 노출 |

## 작업 순서 권장

0. **Spike 1주차** — 작업 0의 spike 코드. 통과 못 하면 stop.
1. 작업 1 (full-res canonical pose).
2. 작업 2 (mapping) — 가장 까다로움. 시간 충분히 잡기.
3. 작업 4 (group mask) + 작업 5 (single shot AI).
4. 작업 6 (composition).
5. 작업 3 (occlusion) — 작업 6 후에 검증하면서 점진 향상.
6. 작업 7 (dispatcher 라우팅) + 작업 8 (UI 토글).
7. 작업 10 (backProjections 스토어).
8. 작업 9 (animation eval).
9. 작업 11 (A/B 비교).

## 다음 단계로 가기 전 점검

Phase 4 종료 시:

- A/B에서 backproject 선호 비율 실측.
- 실패 case 카탈로그 (어떤 intent에서 orchestrator로 fallback해야
  하는지).
- Phase 5 (PSD round-trip) 진입 판단: `.moc3` write 커뮤니티 도구
  상태 확인, telemetry로 PSD source 보유 사용자 비율 확인.
