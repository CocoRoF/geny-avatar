# 2026-05-06 — Sprint 1.3a: parseBundle + format detect

Phase 1.3 첫 sub-sprint. 사용자가 떨어뜨린 파일 묶음(여러 File 또는 ZIP 한 개)을 받아서 어댑터가 바로 load할 수 있는 형태로 정규화.

## 스코프

- `fflate` 설치 (ZIP 압축 해제, ~30KB gzipped, browser DecompressionStream은 ZIP container를 못 풀어서 필수)
- `lib/upload/types.ts` — `BundleEntry`, `ParsedBundle` 타입
- `lib/upload/parseBundle.ts`:
  - `File[]` 또는 ZIP `File` 1개 → 정규화된 `BundleEntry[]` (name + path + blob + URL)
  - 매니페스트(model3.json)나 atlas 텍스트를 *읽어서* 진짜 entry point 결정 (filename heuristic 보완)
  - 어댑터 라우팅: `AvatarRegistry.detectFromFilenames`로 1차, 매니페스트 파싱으로 confirm
  - 결과: `ParsedBundle` — 어댑터 + entry blob URL들 + 모든 원본 entry 매핑
- `/poc/upload-debug` 페이지 — 단순 드롭존 + 파싱 결과 JSON 표시. 사용자가 ZIP 드롭해서 분류가 정확한지 즉시 시각 검증.

## 결정

### blob URL을 어댑터 인터페이스에 그대로 넘김

`AdapterLoadInput`은 이미 `skeleton: string`, `model3: string`을 받음. blob URL도 string이라 인터페이스 변경 없음. 단, blob URL은 directory 개념이 없어서 atlas의 `spineboy-pma.png` 같은 상대 참조를 어떻게 풀지가 1.3b의 문제 — 이번 sprint에서는 blob URL 매핑 dictionary까지만 만들고, 어댑터 쪽에서 그걸 활용하는 부분은 1.3b.

### 매니페스트 파싱 — 한 발 깊이

filename heuristic만으로는 다음을 못 잡음:
- ZIP 안에 `Hiyori.model3.json`이 두 개 있을 때 어느 게 진짜인지
- model3.json이 참조하는 텍스처 파일이 ZIP 안에 진짜 있는지

이번 sprint에서 `parseBundle`이 model3.json을 *읽고* `FileReferences.Moc/Textures/Motions` 경로를 정규화해서 blob URL 매핑 만든다. 단순한 파싱 (no schema validation), 누락된 file은 warning에 적되 fail은 아님 (사용자가 일부만 올렸을 수 있음).

### 디버그 페이지의 가치

라이브러리만 만들고 unit test 쓰는 것보다, 작은 시각 페이지가 있으면 사용자가 자기 자산으로 즉시 검증 가능. unit test는 1.3 종료 시점에 1.3d 회귀 테스트로 모음.

## 진행 노트

### 16:10 — fflate 0.8.2 설치

`pnpm add fflate` — 30KB gzipped, browser-only ZIP unzip. native `DecompressionStream`은 ZIP container를 못 풀어서 별도 lib 필요.

### 16:15 — types.ts

- `BundleEntry` — `{ name, path, size, blob }` 정규화 단위
- `ParsedBundle` — discriminated union (ok/!ok). ok면 `loadInput`으로 어댑터 즉시 load 가능.
- `urls: string[]` — 생성된 모든 blob URL을 모아둔 배열. `disposeBundle`이 한 번에 revoke.

blob URL은 어댑터에 string으로 그대로 넘김 — 인터페이스 변경 없음. URL이 blob:이든 /samples/...이든 같은 string.

### 16:25 — parseBundle.ts

핵심 분기:
1. 단일 ZIP File → fflate `unzipSync`로 풀어 BundleEntry[]
2. File[] (폴더 드롭) → 각 File을 그대로 BundleEntry. `webkitRelativePath` 우선, 없으면 file.name.
3. 모든 entry를 path로 lowercased Map에 인덱싱
4. `AvatarRegistry.detectFromFilenames`로 1차 결정
5. 결정된 어댑터별로 manifest 파싱:
   - **Spine**: `.skel` 우선 (없으면 `.json` non-`.model3.json` non-`motion`), `.atlas`, PNG pages
   - **Live2D**: `.model3.json` 발견 → JSON.parse → `FileReferences.{Moc, Textures, Physics, Pose, UserData, DisplayInfo, Motions}` 모두 walking → 참조된 파일이 bundle에 진짜 있는지 확인 후 missing은 warnings에 누적

`.moc`만 있는 경우(Cubism 2/3) → `Cubism Editor 4+로 마이그레이션하세요` 명확한 에러로 fail.

`disposeBundle(parsed)` — 모든 blob URL revoke. 페이지 unmount 시 호출 필수 (메모리 누수 방지).

### 16:40 — /poc/upload-debug 페이지

좌: 드롭존 (HTML5 drag-drop API + `<input type=file multiple>` fallback) + status chip + clear 버튼.
우: 파싱 결과 JSON 패널 — `loadInput` 안의 blob URL은 `blob:…`으로 redact (URL 중복 표시 방지), `entries`는 `{path, size}` 요약.

홈에 `/poc/upload-debug` 카드 링크 추가.

### 16:50 — 검증

- typecheck: 0
- lint: 1 a11y 에러 (드롭존 div에 onDrop만 있고 role 없음) → `<section aria-label>`으로 교체. 그 외 format auto-fix 2건.
- build: 통과 (`/poc/upload-debug` 5.93KB / 278KB First Load — fflate가 추가됐지만 dynamic import 없이 정적 묶음, 영향 미미)

## 산출물

| 파일 | 라인 | 역할 |
|---|---|---|
| `lib/upload/types.ts` | 53 | `BundleEntry`, `ParsedBundle` discriminated union |
| `lib/upload/parseBundle.ts` | 245 | ZIP/folder → ParsedBundle. manifest 파싱·참조 검증 포함 |
| `app/poc/upload-debug/page.tsx` | 197 | 드롭존 + JSON 결과 뷰어 |
| `app/page.tsx` | +1 카드 | 홈에 링크 |
| `package.json` | +1 dep | `fflate ^0.8.2` |

## 사용자 시각 검증 요청

```bash
git pull && pnpm install && pnpm dev
# /poc/upload-debug 진입
# 1) Hiyori vendor 폴더(public/samples/hiyori/)에서 파일들 다중 선택해 드롭 → ok=true, runtime=live2d, warnings 없음 기대
# 2) spineboy 폴더(public/samples/spineboy/)에서 .skel + .atlas + .png 드롭 → ok=true, runtime=spine 기대
# 3) 임의 폴더의 PNG만 드롭 → ok=false, "couldn't identify the runtime"
# 4) ZIP으로 묶어서 드롭 → 압축 해제 후 같은 결과
```

이번 sprint의 핵심 가치 = 드롭→분류 파이프라인이 정확한지를 사용자가 즉시 확인 가능. 1.3b의 어댑터 wiring 전에 parsing 로직 검증.

## 미완성 / 다음 sprint로

- **blob URL이 어댑터에 도달해도 직접 load 안 됨**: Live2DModel.from(blobURL)은 manifest를 fetch하지만 sibling 파일을 ".../moc3"같이 상대 경로로 시도하는데 blob URL은 디렉터리 의미가 없어 404.
  → 1.3b에서 model3.json 텍스트를 직접 읽어 sibling 경로를 blob URL로 rewrite 후 새 blob 만들어 그걸 어댑터에 전달.
- **Spine atlas의 page 참조도 같은 문제**: spine-pixi-v8 Assets는 atlas 텍스트 첫 줄의 PNG 이름을 atlas와 같은 디렉터리에서 찾음. atlas 텍스트 rewrite 또는 Pixi Assets에 alias 미리 등록.
  → 1.3b에서.

## 다음

Sprint 1.3b — UploadDropzone을 실제 `usePuppet` 위에 얹어서 드롭→로드까지 한 번에. atlas/manifest rewrite 처리.

