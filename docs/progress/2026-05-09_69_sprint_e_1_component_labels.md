# 2026-05-09 — Sprint E.1: Per-component naming + persistence

[`68 e_kickoff`](2026-05-09_68_e_kickoff.md) 의 첫 atomic sprint. auto-detect된 region을 사용자가 의미 있는 이름으로 명명하고 panel 닫고 다시 열어도 그대로 유지. region 1/2/3 같은 익명 라벨 → "torso", "shoulder frill", "back panel" 처럼 사용자 의도가 모델에게 직접 전달.

## 변경 surface

### `lib/persistence/db.ts` — IDB v8

- 신규 store: `componentLabels`
- 신규 row type: `ComponentLabelsRow = { id, puppetKey, layerExternalId, labels: Record<string, string>, updatedAt }`
- index: `[puppetKey+layerExternalId]` (단일 access pattern), bare `puppetKey` (cascade delete 대비)
- helpers: `loadComponentLabels`, `saveComponentLabels`, `deleteAllComponentLabelsForPuppet`

### `lib/avatar/id.ts`

- `ID_PREFIX.componentLabel = "cl"` 추가

### `lib/avatar/useComponentLabels.ts` (신규)

- `useComponentLabels(puppetKey, layerExternalId)` — labels map 로드 + edit + 400ms debounced save
- `componentSignature(bbox)` — `${x}_${y}_${w}_${h}` stable key. 같은 layer source → 같은 component → 같은 signature.

### `components/GeneratePanel.tsx`

- 각 region tile에 inline `<input type="text">` 이름 입력칸 추가 (썸네일 옆, bbox info 위)
- placeholder: "name (e.g. torso, frill)"
- 입력 시 `setComponentLabel(sig, value)` 호출 → debounced IDB 저장
- region tile의 textarea placeholder도 동적: name 있으면 `${name} — what should fill this region?`, 없으면 `region N — what should fill this island?`
- onSubmit prompt 조합 변경:
  - name 있고 per-region 있음: `${baseText}\n\nFor [image 1] (region '${name}' (${idx+1} of N, WxH px)): ${perRegion}`
  - name 있고 per-region 없음: `${baseText}\n\n[image 1] is the ${name} region.` (이름만으로도 의도 전달)
  - name 없고 per-region 있음: `${baseText}\n\nFor [image 1] (region N of M, WxH px): ${perRegion}`
  - 둘 다 없음: `baseText` 그대로
- 진단 로그에 region label 추가 — "source split into N components" 줄 + "per-region prompts" 줄 모두

## 의도적 한계

- **signature 안정성**: bbox 픽셀 단위 정확 매치 필요. layer source가 1px 라도 변하면 (e.g. 텍스처 override 일부 변경) 다른 signature → 이름 사라짐. 일반 사용 (같은 layer 반복 generate)에서는 안정적.
- **debounced save 400ms**: 사용자가 빠르게 입력해도 멈추면 0.4s 뒤 IDB 한 번. panel close 시 마지막 timeout 클리어 — 직전 입력은 저장 안 될 수 있음. flush가 필요해지면 unmount 시 강제 save 추가 가능.
- **manual regions와는 별개**: E.1은 auto-detect 결과의 라벨링만. E.2 의 manual region이 도입되면 manual region 자체에 name 필드가 들어감 (`regionMasks` row 안에). E.1 라벨은 manual region이 활성일 땐 안 쓰임.
- **export ZIP 미포함**: componentLabels는 IDB-only. export/import 통합은 후속.

## 검증

- typecheck 통과
- biome 통과
- `next build` 통과

## 시각 검증 가이드

```bash
git pull && pnpm install && pnpm dev

# 1. 上身 (multi-component) layer 진입
# 2. REGIONS 섹션 각 tile에서:
#    - 썸네일 옆 위쪽에 새 텍스트 입력칸 등장 (placeholder "name (e.g. torso, frill)")
#    - region 1: "torso" 입력
#    - region 2: "shoulder frill" 입력
#    - region 3: "frill" 입력
# 3. 패널 close → 다시 same layer 열기
#    → 입력했던 이름이 그대로 채워져 있어야 함 (IDB persist 확인)
# 4. 각 region textarea placeholder가 "torso — what should fill this region?" 처럼 이름 반영
# 5. 사용자 입력 + generate → 콘솔 [ai/submit] 그룹:
#    - "source split into 3 components" 줄에 각 component label 출력
#    - "per-region prompts" 줄에 region별 label + text
# 6. 모델에 보내는 prompt는 "[image 1] is the torso region." 또는 "For [image 1] (region 'torso' ...)" 처럼 명시적 라벨
# 7. region 명에 빈 문자열 입력 → IDB row에서 그 키 삭제 → 다음 mount 시 빈 상태로 복원
```

다음: Sprint E.2 — DecomposeStudio에 region split mode 추가. SAM 클릭 + brush로 사용자가 직접 region 정의.
