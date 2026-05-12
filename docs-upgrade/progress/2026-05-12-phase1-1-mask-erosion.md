# 2026-05-12 Phase 1.1 — Alpha-enforce 마스크 erosion

**Phase / 작업**: Phase 1 작업 1 (Mask erosion 적용)
**상태**: done (코드 변경 완료, 시각 검증은 사용자가 puppet 편집할 때 진행)
**관련 계획**: [../plan/01-Phase1.md](../plan/01-Phase1.md) 작업 1

## 코드베이스 탐색에서 확인된 진실

계획 문서의 가정 (`buildOpenAIMaskCanvas` 안에 erosion 추가)이 현재
코드와 일치하지 않았다. 실제 상태:

- `lib/ai/client.ts` 의 `buildOpenAIEditMask` (line 397) — 정의돼 있지만
  **호출하는 곳이 0개**. dead code.
- `lib/ai/maskConvert.ts` — 코멘트에서 언급되지만 **파일 자체가 없음**.
- OpenAI generate 경로는 `image[]` 에 padded source canvas만 보내고
  별도 mask file은 안 보냄 (`maskSentToAI=false`). 실제 mask 역할은
  padded source의 알파 채널이 함.
- Gemini 경로만 별도 mask blob을 보냄 (`geminiMaskBlob`).
- Seam 오염의 진짜 진입 지점은 `postprocessGeneratedBlob` 의
  alpha-enforcement 단계 ([client.ts:580](../../lib/ai/client.ts)).
  result 알파 = result_alpha × source_alpha / 255 인데, source 알파의
  anti-aliased edge가 그대로 result로 흘러나와 atlas 인접 island로
  새어 들어감.

## 변경

- **신설** [lib/ai/morphology.ts](../../lib/ai/morphology.ts) —
  separable min-filter 기반 grayscale erosion 유틸:
  - `erodeAlphaInPlace(imageData, radius)` — ImageData 알파 채널을
    radius 픽셀만큼 안쪽으로 침식. 2-pass (horizontal → vertical),
    Uint8Array에 알파만 떼서 처리, early-break on min=0.
  - `defaultAlphaErodeRadius(shortSide)` — silhouette 짧은 변 기준
    erosion 반경 계산. `Math.round(shortSide / 100)` clamp [2, 8].
- **수정** [lib/ai/client.ts](../../lib/ai/client.ts) `postprocessGeneratedBlob`
  의 Step 2 (alpha enforcement) — 곱셈 직전에 source 알파에 erosion
  적용:
  - `sourceBBox`가 있으면 그 짧은 변 사용, 없으면 source canvas 짧은 변.
  - radius=0이면 no-op.
  - 콘솔에 `[postprocess] alpha-enforce: erode radius=Npx (shortSide=Spx)`
    로깅 추가.

## 검증

- `pnpm typecheck` — 통과.
- `pnpm exec biome check lib/ai/morphology.ts lib/ai/client.ts` — 통과.
- 시각 검증 (puppet 실편집): **아직 미실행**. 사용자 환경에서 빌트인
  Hiyori 머리 인접 2 drawable 편집 후 atlas 인접 픽셀 diff로 확인 예정.
  Phase 1 종료 전 ship criteria의 "seam <1%" 측정 시점에 함께 검증.

## 결정

1. **계획 ≠ 코드 현실 → 적응**. plan/01-Phase1.md 작업 1은 "mask
   canvas에 erosion"이지만 실제 mask file이 보내지지 않으므로,
   대신 **alpha-enforce 단계의 source 알파에 erosion**. 결과는 동일:
   silhouette 외곽이 인접 island로 안 새어 들어감.
2. **morphology를 별도 모듈로 분리**. 같은 utility를 Phase 4 (back-
   projection) 의 group mask, Phase 2 (tint fallback) 의 per-pixel HSV
   영역 boundary 처리에도 재사용 예정. inline 함수로 끼워 넣지 않음.
3. **Separable min-filter** 채택. binary erosion (threshold 후 disk
   SE)이 더 단순하지만 anti-aliased edge가 한 번에 0 되어 부자연
   스럽다. min-filter는 알파 그라데이션을 자연스럽게 안쪽으로 옮긴다.
4. **Radius 비례 공식**: shortSide / 100 clamp [2, 8]. 50px ribbon이
   2px, 600px head가 6px, 1600px 큰 영역이 8px. 사용자에게 노출 안 함
   (자동).

## 영향

- **모든 OpenAI generate 결과의 alpha 외곽이 2-8 px 좁아짐**. 사용자가
  체감할 정도로 silhouette이 줄어들진 않지만 (anti-alias 영역 ≤8 px),
  Hiyori 같은 모델의 매우 작은 detail (예: 눈썹 끝) 은 절반 가까이
  잠식될 수 있음. ship criteria 측정 시 확인.
- Gemini 경로는 `postprocessGeneratedBlob` 을 통과하지만
  `paddingOffset`이 없는 단순 경로 (Step 2 동일 적용). gemini도
  erosion 받음. 일관성 위해 OK.
- `compositeProcessedComponents` (multi-component 합성) 의 알파 enforce
  는 변경 없음 — 그쪽은 full source canvas를 기준으로 다시 곱하는데,
  per-component에서 이미 erode 됐으므로 추가 erode는 불필요.

## 다음 작업

[../plan/01-Phase1.md](../plan/01-Phase1.md) 작업 2 — Canonical-pose
render를 image[2]에 추가. 별 entry로 진행 로그 작성.

## 참조

- 손댄 파일:
  - `lib/ai/morphology.ts` (신설)
  - `lib/ai/client.ts` (import 추가 + Step 2 본문 수정)
- PR [#2](https://github.com/CocoRoF/geny-avatar/pull/2) (squash-merge
  `44eecc6`).
