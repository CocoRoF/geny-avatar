# 2026-05-06 — Sprint 1.3b: UploadDropzone + 실제 로드

Phase 1.3 두 번째 sub-sprint. 1.3a의 parseBundle 결과를 어댑터에 연결해 실제 puppet이 화면에 뜨게 만든다.

## 핵심 문제: blob URL은 디렉터리가 없다

`Live2DModel.from(blobURL)`이 manifest를 fetch해도 `FileReferences.Moc: "Hiyori.moc3"`를 base URL의 형제 경로로 fetch 시도 → blob URL은 base directory 의미 없음 → 404.

Spine atlas도 같은 문제 — 첫 줄의 `spineboy-pma.png`를 atlas의 source URL 디렉터리에서 찾는데 blob에는 디렉터리 없음.

## 해결 — manifest/atlas 텍스트 자체를 rewrite

manifest나 atlas의 텍스트를 *읽고* 안에 든 file 참조를 모두 blob URL로 교체한 새 텍스트로 새 Blob 만들기. 어댑터에는 그 새 blob의 URL을 넘김. 더 이상 base directory가 의미 없음 — 모든 참조가 절대 blob URL.

### Live2D model3.json

JSON이라 단순 — `FileReferences`를 walking, string 값마다 entries map에서 path 찾아 blob URL로 치환.

### Spine atlas

텍스트 형식:
```
spineboy-pma.png
size: 1024, 256
filter: Linear, Linear
[regions...]

second-page.png
size: ...
[regions...]
```

각 페이지의 첫 줄이 PNG 이름. line 단위로 파싱하면서 `.png`/`.jpg`/`.jpeg`/`.webp`로 끝나고 콜론 없는 한 줄을 페이지 이름으로 식별 → 그 줄을 blob URL로 교체.

## 스코프

- `lib/upload/rewrite.ts` — `rewriteLive2DManifest` + `rewriteSpineAtlas`
- `parseBundle.ts` 업데이트 — rewrite한 새 blob을 `loadInput`의 entry로 사용
- `components/UploadDropzone.tsx` — 재사용 가능한 드롭존 (debug 페이지에 있던 거 추출)
- `app/poc/upload/page.tsx` — 드롭존 + `usePuppet`으로 실제 로드 + 미리보기
- 홈에 링크

## 진행 노트

### 16:55 — `lib/upload/rewrite.ts`

두 함수:

**`rewriteLive2DManifest(manifest, entries, warnings, urls): Promise<Blob | null>`**
- model3.json 텍스트 읽고 JSON.parse
- `FileReferences` 안의 모든 string path를 lookup → blob URL로 치환
  - `Moc`, `Textures[]`, `Physics`, `Pose`, `UserData`, `DisplayInfo`, `Motions[group][i].File`
- 누락은 warnings에 누적 + 원 path 그대로 두기 (어차피 fail할 거지만 더 명확한 에러)
- 새 JSON 직렬화 후 새 Blob 반환
- parse 실패 시 null 반환 → caller가 명확한 에러로 fail

**`rewriteSpineAtlas(atlas, entries, warnings, urls): Promise<Blob>`**
- atlas 텍스트 line별로 walking
- `^[^\s:][^\n:]*\.(png|jpg|jpeg|webp)$` 정규식으로 페이지 이름 line 식별 (콜론 없고, 인덴트 없고, 이미지 확장자로 끝남)
- 매칭된 line을 entries map에서 lookup → blob URL로 치환
- 페이지 누락은 warnings에 누적
- 새 텍스트 직렬화 후 새 Blob 반환

`lookup(map, baseDir, ref)` 헬퍼가 4가지 후보를 시도 (baseDir 적용·미적용 × `./` 제거·미제거) — manifest의 path 표기가 다양해서.

### 17:08 — parseBundle 갱신

Spine builder + Live2D builder가 이제 rewrite 함수를 호출. rewrite 결과 blob의 URL을 `loadInput.atlas` / `loadInput.model3`에 박음. 어댑터는 그 URL을 fetch하면 manifest/atlas 안의 모든 file 참조가 absolute blob URL이라 sibling resolution이 깨끗하게 작동.

### 17:15 — `components/UploadDropzone.tsx`

drag-drop API + `<input type=file multiple>` fallback. props: `onFiles(files)`, `className`, `hint`. 1.3a 디버그 페이지의 인라인 드롭존을 추출. 같은 컴포넌트가 1.3b/1.3c/1.4 등 여러 곳에서 재사용.

### 17:25 — `/poc/upload/page.tsx`

좌측: 드롭존 (idle 상태) 또는 Pixi 캔버스 (loaded 상태). header에 status + warnings.
우측: 애니메이션 라디오 + 레이어 토글 (검색·bulk).
`usePuppet({ input: bundle?.ok ? bundle.loadInput : null, host, onMount })` — input이 null이면 캔버스 안 mount. drop으로 input 바뀌면 자동 reload.
`fitDisplayObject`가 runtime에 따라 다른 fit (Live2D는 native size 기반, Spine은 heuristic).
`disposeBundle`을 cleanup effect에서 호출 — bundle 교체 시 + unmount 시 blob URL 회수.

### 17:35 — 검증

- typecheck 0 (initial: 1 error fixed — `bundle.detection`이 union narrowing 안 되는 건 `bundle.ok` 명시적 가드로 해결)
- lint 0 (1 unused warning fixed — `app` 변수 destructure 제거)
- build 통과 (`/poc/upload` 4.95KB / 280KB First Load)

홈 페이지에 `/poc/upload` 카드 링크 추가.

## 산출물

| 파일 | 역할 |
|---|---|
| `lib/upload/rewrite.ts` | model3.json + atlas → 모든 file 참조를 blob URL로 치환한 새 Blob |
| `lib/upload/parseBundle.ts` | rewrite 결과 사용으로 갱신 |
| `components/UploadDropzone.tsx` | 재사용 가능 드롭존 |
| `app/poc/upload/page.tsx` | 드롭→로드→미리보기 + 레이어 토글 |
| `app/page.tsx` | 홈에 카드 추가 |

## 시각 검증 (사용자)

```bash
git pull && pnpm dev
# /poc/upload 진입
# (1) public/samples/hiyori/ 안의 모든 파일 다중 선택해 드롭
#     → Hiyori가 화면에 떠야 함, idle motion 재생, 24 parts 토글 가능, hide all 작동
# (2) public/samples/spineboy/ 안의 .skel + .atlas + .png 드롭
#     → spineboy가 떠야 함, portal 등 11개 애니메이션, 52 slots 토글
# (3) ZIP으로 묶어 드롭 → 같은 결과
```

이번 sprint의 시연 가치가 매우 큼 — V1 시나리오 A·B의 "올리고 보고 토글까지" 단계가 본격 작동.

## 미완성 / 다음 sprint

- **IndexedDB 영구 저장 없음** — 새로고침하면 사라짐. Sprint 1.3c.
- **자산 출처 메모 미입력** — 1.3d.
- **자산 다양성 회귀 미검증** — 사용자가 인터넷 자산 들고 와서 검증 (1.3d).

## 다음

Sprint 1.3c — Dexie + IndexedDB persistence + 자산 라이브러리 페이지.

