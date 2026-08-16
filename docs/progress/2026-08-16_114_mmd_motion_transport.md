# 114 — MMD 모션 시스템: VMD 업로드·트랜스포트·아이들 지정 (v0.5.0)

> 2026-08-16 · plan: [10_mmd_3d_runtime.md](../plan/10_mmd_3d_runtime.md)

## 배경 — "내장 애니메이션" 조사

PMX 포맷은 애니메이션을 **내장하지 않는다** (모프·본·물리 데이터만).
MMD 생태계에서 모션은 별도 **.vmd** 파일이며, 대부분의 배포 모델(Chisa
포함)에는 동봉되지 않는다. 그래서 "재생할 것"을 사용자가 넣을 수 있어야
했다.

## 한 것

- **db `addPuppetFiles`** — 기존 퍼펫에 파일 추가/경로별 교체 (row 합계는
  테이블 재집계로 산출 — 반복 교체에도 카운터 안 틀어짐). sync push 유발
  → 업로드한 VMD 가 auto-publish/export zip 에 자동 동승.
- **MmdStage/Adapter 모션 API** — addVmdFile(같은 이름 교체 시 stale
  runtime-animation 파기), pause/resume/seek(30fps 프레임), getMotionState
  (트랜스포트용), getMotionNames. 일시정지 중 루프 시킹 금지 가드.
- **Animation 탭 Motions 섹션 전면 개편** — `+ VMD 업로드`(IDB 영속),
  ▶ 칩 목록, 트랜스포트(⏸/▶·⏹·시크바·m:ss 표시, 스크럽 중 폴링 정지),
  **아이들 모션 지정** 드롭다운(기존 idleMotionGroupName 필드 재사용 —
  값은 VMD 스템 이름, 빈 값 = 절차적 아이들).
- **사이드카** — `mmd.vmds: [{name, path}]` (원본+업로드분 전부).
- **Geny 측** — 설치기 vmds 패스스루 + mmd 는 idle 기본값 "Idle" 강제
  금지(빈 값 유지), MmdCanvas 가 idle VMD 를 로드·루프 재생(모프 트랙
  있으면 절차적 블링크도 양보, 립싱크·감정 모프는 항상 유지). 실패 시
  절차적 아이들 폴백.

## 검증

- 자체 제작 VMD(gentle-idle, 120f/4s: センター 밥 + 上半身/頭 스웨이 +
  팔 내림 유지 — 라이선스 프리)로 E2E: 업로드→칩→재생(1s에 7.1% 픽셀
  변화)→트랜스포트 0:02/0:04→일시정지(0.2%)→아이들 지정→Export zip에
  motions/gentle-idle.vmd + 사이드카 반영→백엔드 설치→레지스트리
  idleMotionGroupName/vmds→VMD 바이트 동일 추출.
- 모션 포함 zip 신규 업로드 시 칩 자동 표시(번들 경로).

## 주의

- VMD 가 팔 본을 안 만지면 T-포즈 노출 — VMD 재생 중 절차적 포즈는 전부
  양보하는 설계라, 모션 제작 시 팔 키프레임 포함 필요(자체 gentle-idle 은
  포함).
