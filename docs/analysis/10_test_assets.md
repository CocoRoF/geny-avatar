# 10 — Test Assets (자산 다양성 회귀)

[plan/01 north star](../plan/01_north_star.md)의 V1 acceptance 기준 중:

> 인터넷 무작위 자산 5종(2 Spine + 3 Live2D, 다양한 버전) 80% 이상 정상 로드

이걸 검증할 때 어디서 자산을 받고 무엇을 확인할지의 시드 가이드. 사용자가 직접 자산을 모아 `/poc/upload`에 드롭하면서 통과율을 본다.

## 목표 매트릭스

| # | runtime | 추천 버전 | 출처 후보 | 무엇을 확인 |
|---|---|---|---|---|
| 1 | Spine | 4.0/4.1 | Esoteric `spine-runtimes` examples (raptor, hero) | 다양한 슬롯·메시 attachment, 4.x 표준 |
| 2 | Spine | 4.2 | Esoteric examples (spineboy-pro 이미 vendor에 있지만 별도 자산도) | physics constraint (4.2 신규) |
| 3 | Live2D | Cubism 4 | nizima 무료 모델, shiralive2d, Live2D 공식 샘플 (Haru/Mark/Koharu) | 표준 Hiyori 외 모델별 part 정의 차이 |
| 4 | Live2D | Cubism 5 | Live2D 공식 5.x 샘플, 최근 nizima | Cubism 5.0 신규 기능 (multiply/screen color) |
| 5 | Live2D | Cubism 4 (압축) | 위 3·4 중 하나를 ZIP으로 묶은 것 | ZIP 압축 해제 path 검증 |

자산 5종이 전부 다른 출처에서 와야 의미 있음 — 같은 작가의 모델 5개는 하나가 통과하면 다 통과하는 경향.

## 출처 후보

### Spine

- **Esoteric Software 공식 examples**: `https://github.com/EsotericSoftware/spine-runtimes/tree/4.2/examples`
  - 추천: `raptor`, `hero`, `mix-and-match`, `goblins-pro`, `coin-pro`
  - 라이선스: 평가용. hobby 통과.
- **NIKKE 추출 자산** (dotgg.gg/nikke): 게임사 저작권물. 외부 배포 X. 본인 머신에서 hobby 검증 OK.

### Live2D Cubism

- **Live2D 공식 샘플**: `https://www.live2d.com/en/learn/sample/`
  - Hiyori, Haru, Mark, Koharu, Haruto. Cubism 4·5 혼재.
  - 라이선스: General User (hobby) 통과.
- **nizima 무료 모델**: `https://nizima.com/` — 무료 필터.
  - 작가별 EULA 다름, hobby 사용은 거의 OK.
- **shiralive2d**: `https://shiralive2d.com/live2d-sample-models/`
  - 비상업 무료 다수.
- **CubismWebSamples 레포**: `https://github.com/Live2D/CubismWebSamples/tree/master/Samples/Resources` — Hiyori 외 Mark, Mao 등.

## 검증 절차

```
1. /poc/upload 진입
2. 자산 폴더 또는 ZIP 드롭
3. 화면에 캐릭터 떠야 함 (단순 정적 표시도 OK)
4. animations 라디오 클릭 — 적어도 하나가 재생 시작해야 함
5. layers/parts 토글 — 하나 클릭 시 사라지거나 색상 변화
6. /poc/library — 카드로 보이고 clear 후 다시 클릭으로 reload 가능해야 함
7. origin select에서 출처 라벨 지정
```

각 자산을 위 7 단계로 통과/실패 표 작성:

| 자산 | runtime | 버전 | (1) 떠짐 | (2) animations | (3) toggle | (4) library reload | 비고 |
|---|---|---|---|---|---|---|---|
| (예시) Hiyori | Live2D | Cubism 4 | ✓ | ✓ | ✓ | ✓ | 기준점 |

## 흔한 실패 패턴 (디버깅 가이드)

### "couldn't identify the runtime"
- ZIP 안에 manifest 파일이 누락되거나 파일명이 표준과 다름
- 일부 게임 추출 자산은 `.skel` 대신 `.bin` 같은 비표준 확장자 — 어댑터 detect heuristic 보강 필요

### "Cubism bundle is missing the .model3.json manifest"
- 작가가 model3.json을 빼고 .moc3만 배포 — Cubism Editor에서 재export 필요
- 또는 .model3.json이 다른 디렉터리 깊이에 있어서 ZIP 압축 해제 후 path가 어긋남

### 화면 떠나 토글 무효
- Hiyori 디버깅 (progress 11~17) 같은 model-specific binding 문제 가능
- Cubism 모델이 part-drawable binding을 안 쓰고 parameter를 직접 쓰는 케이스 — 우리 어댑터의 monkey-patch가 잡아냄
- 그래도 안 되면 console에 `[Live2DAdapter] hooked beforeModelUpdate` 또는 `patched internalModel.update` 로그 확인

### Spine 4.x 자산이 안 뜸
- `@esotericsoftware/spine-pixi-v8`은 4.0/4.1/4.2 호환. 5.0+은 미지원 (2026-05 현재).
- 3.8 이하는 [analysis/09 T-rt2](09_open_questions.md)대로 silent break 가능. 그 경우 explicit 에러 메시지 보강.

## 통과율 기준

5종 중 4종(80%) 통과면 V1 acceptance. 그 이하면 [plan/08 R11](../plan/08_risks_and_mitigations.md)에 따라:
- 어떤 출처가 통과 안 했는지 기록
- 어댑터 detect / parseBundle / rewrite 보강 방향 검토

## 다음 라운드

V2 또는 1.5 sprint에서:
- 통과 안 된 자산을 위해 detect heuristic 확장 (magic-byte 기반 추가)
- Spine `.bin`, Cubism 압축 변종 등
- 자동 회귀 테스트 (Playwright + 자산 fixture)
