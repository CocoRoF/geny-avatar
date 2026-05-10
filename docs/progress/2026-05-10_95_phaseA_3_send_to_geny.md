# 2026-05-10 — Phase A.3: "Send to Geny" 모드

[Geny 의 GENY_AVATAR_INTEGRATION plan](https://github.com/CocoRoF/Geny/blob/main/docs/plan/GENY_AVATAR_INTEGRATION.md) 의 Phase A 세 번째. geny-avatar 가 Geny compose 안에서 동작할 때, baked model zip 을 한 번의 클릭으로 Geny 의 import 큐 (공유 volume) 로 전달.

## 변경 surface

### `components/ExportButton.tsx`

- `IS_IN_GENY = process.env.NEXT_PUBLIC_GENY_HOST === "true"` 모듈 상수.
- `savingMode` 유니온에 `"send"` 추가.
- `sendStatus` state — 성공 메시지 inline 표시 ("Geny 로 보냈습니다: <savedAs>").
- `handleSendToGeny()` — `buildModelZip()` (export model 과 동일) → multipart POST `/api/send-to-geny` (basePath 헬퍼 통과) → savedAs 응답 표시. 실패 시 한국어 에러.
- 새 버튼 ("send to Geny") — `IS_IN_GENY` 일 때만 렌더, `modelDisabled` 와 동일 가드 (puppetId + adapter + avatar 모두 필요). 단독 사용 시 완전히 안 보임 → 버튼이 4개로 늘어나지 않음.
- 비고: title tooltip 한국어 ("Geny 의 VTuber 라이브러리로 baked 모델을 보냅니다 (공유 volume 경유)").

### `app/api/send-to-geny/route.ts` (신규)

POST endpoint. multipart `{zip: File, filename: string}` 받아서 `process.env.GENY_BAKED_EXPORTS_DIR` (디폴트 `/exports`) 에 timestamped 파일명으로 fs.writeFile.

- `runtime = "nodejs"` (fs/promises 필요)
- `dynamic = "force-dynamic"` (request body 처리)
- `NEXT_PUBLIC_GENY_HOST !== "true"` 면 503 + 한국어 에러 (단독 사용자가 호출하면 친절한 안내).
- 파일명 sanitize: `[\x00-\x1f\x7f]` + `..` → `_` 치환, basename 만 추출, 200 문자 클램프.
- 충돌 방지: timestamp (UTC `YYYYMMDD_HHmmss`) 를 확장자 앞에 삽입 (`spineboy.zip` → `spineboy__20260510_213045.zip`). 같은 puppet 의 여러 send 가 정렬도 자연.
- mkdir recursive — volume mount 가 비어있어도 첫 호출에서 자동 생성.
- 성공 시 `{savedAs: string, bytes: number}` 반환, 콘솔에 한 줄 info log.

## 검증

- typecheck 통과
- biome 통과 (1 file autofix — formatting)
- `pnpm build` 통과 (default + `NEXT_PUBLIC_BASE_PATH=/avatar-editor` 두 모드)
- 빌드 출력에 `/api/send-to-geny ƒ 140 B` 정상 등장.
- 단독 사용 시 `IS_IN_GENY=false` → ExportButton 의 새 버튼 hidden, route 는 503 응답 (의도적).
- API 실제 fs write 동작은 Geny compose 안에서 통합 검증 (Phase B 완료 후).

## 의도적 한계

- **filename 충돌 시 덮어쓰기 X**: 동일 timestamp (1초 정확도) 안에 두 번 보내면 두 번째가 첫 번째를 덮어쓸 수 있음. 동시성이 1인 사용 시나리오 (사용자 본인 클릭) 라 무시. 필요 시 epoch ms 또는 UUID suffix 로 강화.
- **zip 내용 검증 X**: route 는 zip 의 메타데이터 (avatar-editor.json) 를 파싱 안 함. 그냥 byte 그대로 디스크에. Geny backend 의 import 시 검증 (Phase C 책임).
- **upload 크기 제한 미설정**: Next.js 디폴트 는 1MB body 한계 — 큰 baked atlas 가 거부될 위험. App Router 는 별도 `bodyParser` 설정이 없는 대신 `formData()` 가 알아서 받지만, 환경별로 reverse proxy (nginx) 의 `client_max_body_size` 도 같이 키워야 함 (Geny B.5 PR 에서).
- **content-type/길이 검증 X**: zip 인지 mime 으로 한 번 더 확인 안 함. 현실 시나리오에서는 우리가 클라 측에서 buildModelZip 을 직접 호출해 form 에 담는 거라 신뢰 가능.
- **CSRF token X**: 1인 hobby + 동일 origin (nginx 후) → 디폴트 same-origin 방어로 충분.

## 시각 검증 가이드

```bash
# 단독 사용 (NEXT_PUBLIC_GENY_HOST 미설정)
pnpm dev
# → /edit/<id> 의 헤더에 send-to-Geny 버튼 안 보여야 함
# → /api/send-to-geny 직접 호출 시 503 + 한국어 안내

# Geny 모드 시뮬레이션
NEXT_PUBLIC_GENY_HOST=true GENY_BAKED_EXPORTS_DIR=/tmp/geny-exports pnpm dev
# → /edit/<id> 헤더에 [save | export model | send to Geny] 세 버튼
# → "send to Geny" 클릭 → "sending…" → "Geny 로 보냈습니다: <name>__<ts>.zip" 표시
# → ls /tmp/geny-exports/  로 파일 확인
```

## 다음 — Phase A.4

geny-avatar `README.md` 의 "Geny 통합" 섹션 추가. 새 env 들 (`NEXT_PUBLIC_BASE_PATH`, `NEXT_PUBLIC_GENY_HOST`, `GENY_BAKED_EXPORTS_DIR`) 의미 + Geny 측 compose 와 어떻게 맞물리는지 docs.
