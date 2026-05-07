# 2026-05-07 — Sprint 4.4: Export `*.geny-avatar.zip`

[`41 phase4_kickoff`](2026-05-07_41_phase4_kickoff.md)의 네 번째 sub-sprint. 사용자가 작업한 puppet을 한 ZIP으로 내려받을 수 있는 export 경로를 구현. 4.5 import와 짝으로 동작.

## ZIP 레이아웃

```
my-puppet.geny-avatar.zip
├─ avatar.json             # GenyAvatarExport (메타 + variants + session)
├─ bundle/<path>           # 원본 puppet 파일 그대로 (수정 X)
├─ overrides/masks/<eid>.png      # DecomposeStudio 마스크
├─ overrides/textures/<eid>.png   # AI 생성 atlas 텍스처 (postprocess됨)
└─ LICENSE.md              # origin + AI provenance 정보
```

`<eid>`는 layer의 runtime-stable externalId로 percent-encoded. 이 형식을 4.5 import가 그대로 받음.

## 변경 surface

### 신규 — `lib/export/types.ts`

`GenyAvatarExport` JSON schema. `schemaVersion: 1`. 변경 시 마이그레이션 추가.

```ts
type GenyAvatarExport = {
  schemaVersion: 1;
  exportedAt: number;
  exporter: string;       // "geny-avatar/0.1"
  puppet: { name, runtime, version?, origin?, bundleFiles: string[] };
  variants: ExportedVariant[];   // VariantRow에서 id+puppetKey 제거 (import 시 재생성)
  session: { visibility, masks, textures };
};
```

### 신규 — `lib/export/buildBundle.ts`

`buildExportZip(input)` — 한 번에 ZIP Blob을 만들어 반환. 입력은:

- `puppetId` — IDB에서 bundle 파일과 variants를 끌어오기 위함
- `layers` — Layer.id → externalId 변환용
- `visibilityOverrides`, `layerMasks`, `layerTextureOverrides` — 현재 store 상태

내부 동작:
1. `loadPuppet()` → bundle 엔트리 + 메타 row
2. `listVariantsForPuppet()` → variants
3. Layer.id-keyed 맵을 externalId-keyed로 변환
4. fflate `zipSync`로 표준 deflate 패키징 (level 6)
5. AI provenance 정보 (`listAIJobsForLayer`) → LICENSE.md에 인라인 (informational only — import는 LICENSE를 안 읽음)

Builtin sample은 IDB `puppetFiles` row가 없어서 export 불가능. ExportButton에서 `puppetId === null`이면 disabled로 표시 + tooltip "Save this puppet to the library to enable export".

### 신규 — `components/ExportButton.tsx`

Header 한 칸에 들어가는 작은 버튼. 클릭 시:
1. `buildExportZip(...)`
2. `URL.createObjectURL` + `<a download>` 트리거
3. 5초 후 revoke (브라우저가 다운로드 시작할 시간 확보)
4. busy 동안 "exporting…" 라벨, 실패 시 빨간 작은 텍스트로 메시지 표시

### 페이지 와이어링

- `app/edit/[avatarId]/page.tsx` — 헤더에 `<ExportButton puppetId={puppetId} />` (항상 활성)
- `app/poc/upload/page.tsx` — autoSave 후 활성화 (`puppetId={savedId}`)
- `app/edit/builtin/[key]/page.tsx` — 추가 안 함 (builtin은 export 미지원)

## 의도적 한계

- **builtin export X**: IDB에 puppetFiles row가 없으니 bundle을 못 만듦. 사용자가 Hiyori를 export하려면 먼저 /poc/upload에 업로드 → autoSave → 그 puppet으로 export. 명시적 결정.
- **LICENSE.md 미파싱**: import는 avatar.json만 본다. LICENSE는 사용자/외부 도구를 위한 인간 가독 정보.
- **재export → 같은 zip 보장 X**: zipSync는 deterministic하지만 createdAt/updatedAt 등이 직렬화에 들어가 매번 약간 다름. byte-identity 라운드트립은 보장하지 않음 (의미적 라운드트립만 보장).
- **압축 비율 고정 (level 6)**: 평균적인 균형. 큰 puppet에서 export 속도 < 다운로드 크기를 우선시한다면 추후 옵션화.

## 검증

- typecheck 통과
- biome 통과
- `next build` 통과
- 시각 검증은 Sprint 4.5 import와 묶어서 사용자 검증 패스 (별도 progress 항목)

## 다음 — Sprint 4.5

`*.geny-avatar.zip`을 다시 받아서 IDB에 풀어넣고 `/edit/<newId>`로 이동. 이미 별도 sprint로 분리됨.
