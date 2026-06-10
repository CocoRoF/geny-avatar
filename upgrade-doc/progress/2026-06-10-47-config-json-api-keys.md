# #47 — API 키 config.json 설정 기능

## 무엇을

메인 화면 "⚙ API 설정" 모달에서 provider 별 API 키를 설정. 저장소는
**서버측 `config.json` 파일** (사용자 요구: localStorage 금지, 프로젝트
내부 파일로 관리). 우선순위: config.json 키 > `.env` 기본값. config 키가
인증 실패(401/403)하면 서버가 `.env` 키로 1회 자동 재시도.

## 어떻게

- `lib/config/serverConfig.ts`: `$GENY_AVATAR_CONFIG_PATH` || `<cwd>/config.json`.
  매 요청 fresh read (재시작 불필요), 쓰기는 in-process lock + tmp/rename
  원자적, mode 0600. `isAuthError` 휴리스틱 포함.
- `app/api/config/keys/route.ts`: GET = 마스킹 미리보기("sk-…1234")만 반환
  (전체 키 절대 비노출) + configConfigured/envConfigured/source. PUT =
  `{set, clear}` — 빈 입력은 "변경 없음", 제거 버튼이 clear.
- 키 소비 4경로 전부 config-우선 + .env fallback 배선:
  - generate: `getProvider(id, configKey)` + auth 실패 시 env provider 재시도
  - refine-prompt / sam: keyCandidates 루프 (config → env)
  - providers 목록: 유효 키 기준 availability + source 표시
- `lib/config/apiKeyProviders.ts`: 클라이언트 안전 메타데이터 (fs 비의존).
- `components/ApiKeysConfig.tsx` + 메인 페이지 헤더 "⚙ API 설정" 버튼.
- config.json 은 .gitignore/.dockerignore 등재.
- 배포 영속화: 컨테이너 재빌드에도 살아남도록 compose 에서
  `GENY_AVATAR_CONFIG_PATH` 를 볼륨 경로로 지정 (Geny compose 수정).

## 검증

`pnpm typecheck`/`pnpm lint` 0 error, `pnpm build` 성공 (/api/config/keys 라우트 포함).

## 남긴 것

- 키 암호화 저장은 안 함 (서버 파일 0600, 솔로 호스팅 전제). 필요해지면
  secret manager 로.
