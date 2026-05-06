# 2026-05-06 — Sprint 1.3c: Dexie persistence + asset library

Phase 1.3 세 번째 sub-sprint. 사용자가 업로드한 자산이 새로고침 후에도 살아있도록, 그리고 자산 라이브러리에서 다시 골라 로드할 수 있도록.

## 결정

### 저장 단위 = "Bundle"

자산 1개당 다음을 IndexedDB에 저장:
- **Manifest entry** (puppet 메타) — id, name, runtime, createdAt, fileCount, totalSize, originNote(선택, 1.3d), thumbnailBlob(선택)
- **Files** — `BundleEntry` 단위로 path, size, blob을 통째로 저장. 어댑터가 받는 입력으로 즉시 재구성 가능하도록.

같은 puppet을 다시 올렸을 때(filename·size·전체 byte hash로 식별)는 새 entry 만들지 않고 같은 entry를 update.

### Schema

Dexie v1, 두 개의 store:
- `puppets`: `[id, name, runtime, version, createdAt, updatedAt, fileCount, totalSize, originNote?, thumbnailBlob?]`
- `puppetFiles`: `[id, puppetId, path, size, blob]` — 파일 1개당 한 row, `puppetId + path` index

### Reload 흐름

자산 라이브러리에서 puppet 클릭 →
1. `puppetFiles.where(puppetId)`로 모든 파일 fetch
2. `BundleEntry[]`로 재구성 (Map 인덱싱)
3. parseBundle 대신 manifest rewrite를 직접 호출 (filename detect는 이미 알고 있음 — runtime 메타에 저장됨)
4. `loadInput` 만들어서 어댑터에 넘김

또는 더 단순하게: 1.3a 흐름과 같이 `parseBundle(files)` 다시 호출해도 됨 (파일 객체 vs Blob/path). `parseBundle`이 File을 받지만 IndexedDB 복원은 path+blob이라 새 헬퍼 `parseFromEntries(entries)`가 필요. 또는 BundleEntry → 가짜 File 객체 만들어서 `parseBundle` 재사용.

판단: **`parseBundle`을 BundleEntry[]도 받도록 확장**. file → entry로 가는 path는 그대로 두고, entry array를 직접 받는 path도 추가.

### 자산 라이브러리 페이지

`/library` 또는 홈 통합. 그리드 + 각 자산 카드:
- thumbnail (없으면 placeholder)
- 이름, runtime 뱃지, fileCount + totalSize
- 클릭 → `/poc/upload?puppet={id}` 로드 또는 직접 그 페이지에서 로드
- 우상단에 delete 버튼 (확인 모달 후)

이번 sprint에서 thumbnail 자동 생성은 하지 않음 (1.3d 또는 추후) — placeholder만.

## 스코프

- `pnpm add dexie`
- `lib/persistence/db.ts` — Dexie schema + 단순 helpers (savePuppet, loadPuppet, listPuppets, deletePuppet)
- `lib/upload/parseBundle.ts` — `BundleEntry[]` 입력 path 추가
- `app/poc/upload/page.tsx` — 드롭 후 자동으로 IndexedDB 저장
- `app/library/page.tsx` (또는 `/poc/library`) — 자산 그리드 + 클릭 시 로드
- 홈 카드에 link 추가

## 진행 노트

### 17:50 — Dexie 4.4.2 설치

`pnpm add dexie`. IndexedDB wrapper, ~50KB gzipped, EntityTable typed API.

### 18:00 — `lib/persistence/db.ts`

Dexie schema v1, 두 stores:
- `puppets`: 메타데이터 (id, name, runtime, version, createdAt, updatedAt, fileCount, totalSize, origin?, thumbnailBlob?)
- `puppetFiles`: 파일 1개당 row, `[puppetId+path]` 복합 인덱스

API:
- `savePuppet(input)` — Promise<PuppetId>. 새 id 생성, 트랜잭션으로 메타 + 파일들 한 번에 insert
- `listPuppets()` — `orderBy("updatedAt").reverse()` 최신순
- `loadPuppet(id)` — `{row, entries}` BundleEntry[]로 재구성
- `deletePuppet(id)` — 트랜잭션으로 메타 + 파일들 삭제
- `updatePuppet(id, patch)` — 부분 업데이트 (origin 메모 같은 후속 1.3d용)

SSR 안전: `db()`이 `indexedDB` 부재시 throw, 클라이언트에서만 호출.

### 18:15 — `parseBundle` BundleEntry[] 입력 지원

기존 File / File[] / ZIP File 외에, **이미 BundleEntry로 정규화된 array**도 받아 같은 검출·rewrite 파이프라인을 태움. IndexedDB에서 `loadPuppet` → `entries: BundleEntry[]` → `parseBundle(entries)` → `loadInput`.

`isBundleEntryArray` 가드 — 첫 element가 path string + Blob이고 File 인스턴스가 아니면 BundleEntry로 인식. File도 Blob을 상속하지만 File 체크로 분기.

### 18:25 — `/poc/upload` 자동 저장 + URL 쿼리 로드

- 드롭 → parseBundle → 성공 시 백그라운드 `savePuppet` (UI 막지 않음, 저장 실패는 헤더에 표시만)
- `?puppet=<id>` 쿼리 — `loadPuppet`로 entries 복원 후 `parseBundle(entries)` → 같은 어댑터 path
- `inferBundleName` — manifest 파일명·ZIP 이름·공통 부모 폴더 순으로 합리적 라벨 추론
- 헤더에 saveStatus chip + library 링크 + clear 버튼

`useSearchParams`는 Next.js 15에서 `<Suspense>` 안에 두어야 prerender 안전 → 페이지를 `UploadPocPage` (suspense wrapper) + `UploadPocInner` 로 분리.

### 18:40 — `/poc/library` 자산 그리드

- listPuppets → 카드 그리드 (1/2/3 컬럼 반응형)
- 카드: runtime 뱃지 + name + fileCount/totalSize + relative time + delete 버튼
- 클릭 → `/poc/upload?puppet=<id>`로 navigation
- 빈 상태 — 업로드 페이지 안내
- delete 컨펌 모달 (`window.confirm`)

### 18:50 — 검증

- typecheck 0
- lint 0 (1 react-hooks deps 경고 fix — `refresh`를 `useCallback`으로)
- build 통과
  - `/poc/library` 2.15KB / 135KB First Load (Pixi 안 import해서 작음)
  - `/poc/upload` 6.07KB / 312KB First Load (Dexie 추가, suspense wrapper)

홈 페이지에 두 카드 추가 (`/poc/upload` 설명 갱신 + `/poc/library` 신규).

## 산출물

| 파일 | 역할 |
|---|---|
| `lib/persistence/db.ts` | Dexie schema + savePuppet/listPuppets/loadPuppet/deletePuppet/updatePuppet |
| `lib/upload/parseBundle.ts` | BundleEntry[] 입력 path 추가 |
| `app/poc/upload/page.tsx` | 자동 저장 + URL ?puppet= 로드 + library 링크 |
| `app/poc/library/page.tsx` | 자산 그리드 + delete |
| `app/page.tsx` | 홈 카드 |
| `package.json` | +1 dep dexie 4.4.2 |

## 시각 검증 (사용자, 시간 될 때)

```bash
git pull && pnpm install && pnpm dev
# /poc/upload — 자산 드롭 → "saved=saved (xxxxxx)" chip 떠야 함
# /poc/library — 그리드에 방금 올린 자산이 카드로 보여야 함
# 카드 클릭 → /poc/upload?puppet=... → 같은 자산 다시 로드 (드롭 안 하고)
# 새로고침 → /poc/library → 자산 여전히 존재
# delete → 카드 사라짐
```

## 미완성 / 다음 sprint

- **자산 출처 메모 입력 UI 없음** — 1.3d. savePuppet API는 origin 받음, 입력 모달만 추가하면 됨.
- **자산 다양성 회귀** — 사용자가 인터넷 자산 들고 와서 80% 통과 검증.
- **thumbnail 자동 생성** — 1.3d 또는 후속.

## 다음

Sprint 1.3d — origin 메모 모달 + thumbnail 자동 캡처 (옵션) + 회귀 가이드.

