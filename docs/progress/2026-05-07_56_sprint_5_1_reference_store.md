# 2026-05-07 — Sprint 5.1: Per-puppet reference image store

[`55 phase5_kickoff`](2026-05-07_55_phase5_kickoff.md)의 첫 sub-sprint. 인프라만 — generation에 영향 X. Sprint 5.2가 multi-image API 호출에 이걸 흘려넣는다.

## 변경 surface

### IDB v7 — `puppetReferences` store

```ts
type ReferenceRow = {
  id: ReferenceRowId;        // newId(ID_PREFIX.reference) — "rf_..."
  puppetKey: string;          // PuppetId 또는 "builtin:<key>"
  name: string;                // 업로드 파일 이름 (rename UI는 후속)
  blob: Blob;                  // PNG/JPEG/WebP 그대로 — gpt-image-2 multi-image 슬롯은 포맷 자유
  createdAt: number;
};
```

복합 인덱스 `[puppetKey+createdAt]` — panel "이 puppet의 ref 최신순" 쿼리 한 번에. 단일 `puppetKey` 인덱스는 puppet 삭제 시 일괄 정리 경로용.

### CRUD helpers (`lib/persistence/db.ts`)

- `saveReference({ puppetKey, name, blob })` → 새 row id
- `listReferencesForPuppet(puppetKey)` → 최신순 array
- `deleteReference(id)`
- `deleteAllReferencesForPuppet(puppetKey)` — puppet 삭제 cascade (현재는 사용 안 함, future-proof)

### `useReferences(puppetKey)` 훅

`useVariants` / `useLayerOverridesPersistence` 와 동일 패턴:
- mount + key 변경 시 IDB fetch
- `upload(file)` — File → Blob 그대로 IDB
- `remove(id)` — IDB 삭제
- `puppetKey === null`이면 빈 list + no-op (autoSave 전 /poc/upload 케이스)

### `ReferencesPanel` 컴포넌트

Sidebar 새 섹션. ToolsPanel과 VariantsPanel 사이에 위치.

- 헤더: `References (N)` + `+ upload` 버튼 (multi-file)
- Total bytes 표시 + "each ref adds API cost + latency" 힌트
- 3-col thumbnail grid
- 행 hover 시 우측 상단 `×` 삭제 버튼 (confirm 후)
- `puppetKey === null`이면 hint만 표시
- 빈 상태: "Upload character or style reference images. ... 톤 일관성" 안내문

#### Blob URL 풀 관리

References 변경 시 새 row는 `URL.createObjectURL` 발급, 사라진 row는 `URL.revokeObjectURL`. `useRef`로 풀 보관해서 useMemo 안에서 in-place 재사용 — 같은 이미지 반복 디코드 방지. 컴포넌트 unmount 시 모든 URL revoke.

### 페이지 와이어링

3개 edit 페이지 모두 sidebar 구조 그대로:

```
ToolsPanel
ReferencesPanel    ← 신규
VariantsPanel
LayersPanel
```

Sidebar 자체는 `overflow-y-auto` 추가 — Variants / Layers / References 모두 늘어나면 sidebar 자체가 스크롤. LayersPanel 내부 스크롤도 그대로 작동.

## 의도적 한계 (5.2~5.5에서 처리)

- **Generate 호출에 흘려넣기 X**: 5.1은 저장만. 5.2가 OpenAI provider에 multi-image 추가
- **Active toggle UX X**: 모든 ref가 켜진 것으로 가정. 5.3에서 GeneratePanel이 체크박스로 활성 ref 선택
- **History → ref 승격 X**: 5.3
- **Iterative refinement (이전 generation을 ref로) X**: 5.3
- **Rename / tag X**: future polish
- **자동 압축 / resize X**: 사용자 업로드 그대로. 큰 이미지는 cost↑ — UI hint로 인식하게
- **Reference dedup X**: 같은 파일을 두 번 업로드해도 두 row 생김 (의도적 — content가 다를 수 있음)

## 검증

- typecheck 통과
- biome 통과
- `next build` 통과

## 시각 검증 가이드

```bash
git pull && pnpm install && pnpm dev
# DevTools → Application → IndexedDB → geny-avatar 한 번 보고 v7 마이그레이션 확인 (puppetReferences store 등장)

# 1. /edit/builtin/hiyori 또는 업로드된 puppet으로 진입
# 2. sidebar에 새 "References (0)" 섹션 등장 (ToolsPanel 아래, Variants 위)
# 3. "+ upload" → 임의 PNG/JPEG 1~3장 선택 → grid에 thumbnail 등장
# 4. 행 hover → ×로 삭제 confirm → 사라짐
# 5. 페이지 새로고침 → 같은 puppet 진입 시 ref 살아있음 (IDB 영속성)
# 6. /edit/builtin/hiyori 와 다른 puppet의 ref가 분리되어 있는지 확인 (puppetKey 기반 격리)
# 7. /poc/upload 새 zip 드롭 → autoSave 전엔 "Save to library to attach" hint
# 8. autoSave 후엔 upload 가능
```

## 다음 — Sprint 5.2

`lib/ai/providers/openai.ts` 가 `image[]` 배열로 layer source + active references 전송. 프롬프트 합성 시 ref가 있으면 "Match the visual style and identity..." 같은 자동 힌트 prepend.
