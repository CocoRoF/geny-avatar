# 10 — MMD 3D Runtime (PMX/PMD)

> 2026-08-15 · Status: **shipped** (editor v0.4.0 + Geny 백/프론트 동시 랜딩)

## 스코프 결정의 공식 번복

[01 North Star](01_north_star.md)와 [analysis 01](../analysis/01_problem_statement.md)은
"3D 아바타 (VRM / VRoid)"를 **V1 비목표**로 못박았다. 이 문서는 그 결정을
부분적으로 번복한다:

- 번복 범위: **MMD PMX/PMD** 모델의 **뷰어 + 라이브 아바타 배선**.
- 유지되는 비목표: 3D 모델의 *편집*(메시/텍스처 리페인트), VRM/VRoid 지원.
  DecomposeStudio / GeneratePanel / Restyle 은 여전히 2D 아틀라스 전용이다.

번복 이유: Geny 의 VTuber 라이브러리에 실사용 수요가 가장 큰 3D 포맷이 MMD
(보급 모델 수가 압도적)이고, babylon-mmd 라는 성숙한 단일 런타임 덕에
"뷰어+모프" 수준의 통합 비용이 2D 어댑터 하나 수준으로 떨어졌기 때문.

## 런타임 선택 — babylon-mmd

| 후보 | 판정 |
|---|---|
| three.js MMDLoader | three r0.185 에서 **제거됨**(구버전 고정 필요), SDEF 미지원 |
| three-stdlib 포트 | 레거시 품질, ammo.js 수동 번들, 유지보수 정체 |
| **babylon-mmd 1.3.0** | ✅ 활발한 유지보수(2026-07 릴리스), SDEF·톤셰이딩·모프·IK, **물리 WASM 내장**(single-thread 빌드는 COOP/COEP 불필요), `referenceFiles` 로 브라우저 File 로딩 1급 지원 |

실측(Chisa PMX 2.0, 78,917 정점 / 45 머티리얼 / 564 본 / 116 모프):
로드 ~1.1s, SwiftShader 소프트웨어 GL 에서도 렌더 성공, SPR WASM 물리 가동.

## 아키텍처

- `lib/adapters/MmdAdapter.ts` — `AvatarAdapter` 3번째 구현. 도메인 매핑:
  Layer=머티리얼(45개면 메시 45개로 1:1 분리 — `optimizeSubmeshes` 기본값),
  Parameter=모프(`morph:<이름>`), Animation=번들 내 `.vmd`(파일 스템).
- `lib/adapters/mmd/MmdStage.ts` — babylon 을 만지는 유일한 파일. adapter 가
  `load()` 시점에 dynamic import → 2D 퍼펫은 4MB 스택을 절대 로드하지 않음
  (`/poc/mmd` first-load 1.75kB 로 검증).
- **selfHostedView capability** — 3D 는 Pixi Application 을 만들지 않는다.
  `usePuppet`/`PuppetCanvas` 가 capability 를 보고 Pixi 경로를 통째로 건너뛰고
  `mountView(host)` 를 부른다. 팬/줌은 Babylon ArcRotateCamera 소관.
- 로딩: IDB blob → File(webkitRelativePath 재정의) → `referenceFiles` 매칭.
  블롭 URL 재작성이 **없다** — PMX 텍스처 상대경로(역슬래시·대소문자 무관)는
  babylon-mmd 의 PathNormalize + 대문자 비교가 처리.
- 아이들: 모션 없는 모델도 살아 보이게 블링크(まばたき 계열 자동 탐지) +
  호흡(上半身/頭 미세 사인 회전). Babylon `Bone.rotationQuaternion` **getter 는
  복사본**을 주므로 반드시 setter 대입으로 써야 한다(초기 구현 결함이었음).
- Animation 탭(MMD 전용 섹션): VMD 재생 · GoEmotion→모프 맵(기존 emotionMap
  필드 재사용, 값이 모프 **이름**) · lip-sync 모프 지정 · 카메라 구도 저장
  (`PuppetAnimationConfigRow.mmdCamera` — additive optional, Dexie 버전 불변).

## Export / Geny 계약

`avatar-editor.json` schemaVersion 은 **2 유지** (additive 필드만):

```jsonc
{
  "puppet": { "runtime": "mmd", ... },
  "animationConfig": { "emotionMap": {"joy": "笑い"}, "mmdCamera": {...}, "lipSyncMorph": "あ" },
  "mmd": { "pmxPath": "...", "hiddenMaterials": [...], "hiddenMaterialIndices": [...], "morphs": [{"name","panel"}] }
}
```

- PMX 는 pose3.json 류 패치가 불가능하므로 **숨김 머티리얼은 사이드카 데이터**로
  나가고 Geny 렌더러가 적용한다 (2D 의 모델파일 패치와 대응되는 자리).
- Geny 측: 설치 allowlist +mmd, `static/mmd-models/` 루트, 레지스트리에
  `mmdConfig` 백(이모션 맵은 이름 기준 그대로 — Live2D 의 인덱스 번역과 달리
  MMD 모프는 이름 주소), 프론트 `MmdCanvas`(립싱크=amplitude→모프,
  emotion=WS avatar_state→모프 이징, 블링크/호흡, SPR 물리).

## 라이선스 메모

- babylon-mmd: MIT · @babylonjs/core: Apache-2.0 — vendor/ 격리 불필요(자유
  라이선스, npm 의존성으로 충분).
- **샘플 미동봉**: 검증에 쓴 Chisa 모델은 게임(鳴潮) 추출 변환물로 재배포
  불가. built-in sample 은 추가하지 않았고, 이용자는 자기 모델을 업로드한다.
  PMX 코멘트(이용약관)가 있는 모델은 그 조건을 따를 것.
