# 2026-05-07 — Export Model: edit가 atlas 픽셀에 베이크된 zip

[`45 sprint_4_4`](2026-05-07_45_sprint_4_4_export_zip.md)는 "내가 다시 import해서 같은 편집 세션을 복원"하는 sidecar zip이다. 사용자 피드백으로 진짜 필요한 두 번째 export 형식이 따로 있다는 게 분명해졌다 — **편집이 atlas 픽셀에 그대로 박혀서 외부 도구에서 그대로 보이는 모델 zip**.

## 두 export의 차이

| | save (.geny-avatar.zip) | export model (.zip) |
|---|---|---|
| 목적 | 같은 편집기로 round-trip | Spine/Cubism 표준 도구에서 재생 |
| Atlas | pristine (수정 X) | **모든 edit이 픽셀에 베이크됨** |
| Sidecar | `avatar.json` + `overrides/` + `LICENSE.md` | 없음 — 표준 puppet 구조만 |
| Variants | 보존 | 없음 (한 frozen state) |
| Visibility | sidecar visibility 맵으로 복원 | 숨긴 layer는 atlas에서 erase됨 |
| Mask | sidecar PNG, 적용은 import 시 | `destination-out`으로 atlas에 직접 |
| AI texture | sidecar PNG, 적용은 import 시 | `source-over` + 삼각형 clip으로 atlas에 직접 |

## 변경 surface

### 신규 — `lib/export/bakeAtlas.ts`

`bakeAtlasPages(input)` — adapter-agnostic. 라이브 GPU는 절대 안 건드리고 (사용자 화면 깜빡임 방지) 별도 OffscreenCanvas / `<canvas>`에서 합성:

1. pristine source bitmap (`adapter.getTextureSource(textureId)`)
2. `source-over` + 삼각형 clip으로 모든 layer의 texture override
3. `destination-out`으로 모든 mask
4. **`destination-out`으로 visibility=false인 layer의 footprint erase**
5. `canvas.toBlob` → PNG

순서는 `applyOverrides.ts`와 동일 (텍스처 → 마스크) + visibility erase가 마지막. 합성 헬퍼는 별도 헬퍼 함수로 분리해 양쪽 코드 중복 최소화 (단, 한쪽이 GPU swap, 한쪽이 PNG dump이라 100% 통합은 안 함).

#### Visibility erase의 미묘한 룰

erase 대상은 `visibility[layer.id] === false` AND `layer.defaults.visible === true`인 layer만. 즉 **사용자가 명시적으로 끈** layer만 atlas에서 지움.

**기본 hidden인 layer는 안 지운다**. 이유: Cubism puppet의 기본 모션이 opacity=0이던 part를 raise해서 표시할 수도 있는데, atlas가 비어있으면 모션이 의미 잃는다. Spine에서도 default 어태치먼트가 null인 슬롯은 어차피 안 보이니 erase가 무의미.

이 룰 덕분에:
- 기본 visible → 사용자가 끔 → erase ✓
- 기본 hidden → 안 건드림 → erase 안 함 ✓ (모션 보존)
- 기본 hidden → 사용자가 켰다 다시 끔 (visibility 맵이 현재값 false) → erase 안 함 ✓ (default 상태로 돌아간 것)
- 기본 visible → 사용자가 껐다 다시 켬 → erase 안 함 ✓

### 신규 — `lib/export/buildModelZip.ts`

`buildModelZip(input)` — bake 결과를 원본 puppet 파일들과 묶어서 한 zip으로:

1. `loadPuppet(puppetId)` → 원본 모든 파일 (model3.json / moc3 / motions / cdi3 / atlas / skel 등)
2. **runtime별 page-index → bundle-path 매핑 빌드:**
   - **Cubism**: `model3.json` JSON 파싱 → `FileReferences.Textures[i]`. manifest의 디렉터리 prefix 결합.
   - **Spine**: `.atlas` 텍스트 파싱 → 페이지 헤더 라인 (이미지 확장자로 끝나면서 다음 라인이 `size:`로 시작하는 것). atlas 디렉터리 prefix 결합 + basename fallback.
3. `bakeAtlasPages` 호출
4. zippable 빌드: 모든 원본 entry를 그대로 복사하되, atlas page에 해당하는 path는 baked PNG bytes로 교체
5. `zipSync` (level 6) → Blob

매칭 실패 시 (manifest 손상, atlas 포맷 이상) 원본 PNG 그대로 보존하고 warning 기록 — 안전한 fallback.

### `ExportButton` 두 모드

기존 한 버튼 → 두 버튼 나란히:
- `save` (회색 border): 기존 sidecar zip
- `export model` (accent border): 새 baked zip

builtin sample은 둘 다 disabled (IDB row 없음). 어댑터/avatar가 아직 로드 중이면 `export model`만 disabled.

라벨이 `saving…` / `baking…`으로 분리돼 어떤 모드 진행 중인지 명확. 콘솔 로그도 `[export:save]` / `[export:model]`로 prefix 분리 + baked page 카운트 + unmatched 카운트 출력.

### 페이지 와이어링

3개 edit 페이지에 `<ExportButton puppetId={...} adapter={adapter} />`. adapter prop만 추가.

## 의도적 한계

- **builtin export 여전히 X**: IDB puppetFiles row가 없으니 둘 다 불가능. 의도적.
- **재로드 시 동일 zip 보장 X**: bake는 deterministic하지만 PNG 인코딩이 환경마다 약간 다를 수 있음. 의미적 동일성만 보장.
- **삼각형 clip 정확도**: Spine MeshAttachment / Cubism mesh의 UV가 ≥3개 이상 정점일 때만 정확. region attachment는 quad으로 fallback (`applyOverrides.ts`와 동일 정밀도).
- **Visibility erase는 destination-out**: atlas에서 픽셀이 지워지는 것이라 `.skel` / `.moc3`의 attachment metadata는 그대로. 외부 도구가 어태치먼트의 region을 명시적으로 표시한다고 알리는 시각적 cue가 있다면 (alpha=0인 빈 region) 그걸로 표현됨. 일반적으로는 투명 = 안 보임이라 OK.
- **Animation 영향 분석 X**: 애니메이션이 erased part를 다시 visible로 만들면 빈 영역이 보임. 사용자 결정 — atlas erase는 강제 비표시 의도.
- **Live2D Pose / Expression 그룹은 영향 X**: 이번 변경은 visibility/mask/texture 3개 채널만 다룸.

## 검증

- typecheck 통과
- biome 통과
- `next build` 통과

## 시각 검증 가이드

```bash
git pull && pnpm install && pnpm dev

# 사용자 검증 패스 (Phase 4 verification + 이번 추가):
# 0. /poc/upload에 Cubism 또는 Spine puppet 드롭 → autoSave → /edit/<id> 진입
# 1. 일부 part hide (예: 옷의 한 layer)
# 2. DecomposeStudio로 한 layer에 mask 그리기 (예: 머리 일부 erase)
# 3. GeneratePanel로 한 layer에 AI texture generate → apply (예: 다른 옷)
# 4. 헤더의 "save" 클릭 → .geny-avatar.zip 다운로드 (sidecar)
#    - 다시 import (/poc/upload에 드롭) → /edit/<newId>로 이동, 동일 모습 (Variants까지 복원)
# 5. 헤더의 "export model" 클릭 → 일반 .zip 다운로드 (baked)
#    - zip을 풀어 atlas PNG를 이미지 뷰어로 열어 보기:
#      * hidden part의 영역이 transparent로 erase됨
#      * mask 영역이 transparent로 erase됨
#      * AI texture가 합성되어 들어있음
#    - 풀어진 폴더를 그대로 다시 /poc/upload에 드롭 (혹은 ZIP 그대로) → 새 puppet으로 등록
#      * editor가 그 zip을 일반 puppet bundle로 인식 (avatar.json 없음)
#      * 모든 edit이 atlas에 베이크되어 있어 hide/mask/AI 표시가 그대로 유지됨
#      * 단, Variants는 사라짐 (frozen state)
# 6. 콘솔: [export:model] ... · baked=N unmatched=0 — unmatched가 0이어야 정상
# 7. 외부 도구 검증 (선택): 풀어진 폴더를 spine-runtime 또는 Live2D Cubism Viewer에 로드 →
#    동일 결과 확인
```

## 다음

사용자 검증 후 결정. Phase 4가 이번 추가로 마무리되며, V1 시나리오 C ("export 후 다시 import해 동일 상태 재현") + 새로운 시나리오 ("외부 도구에 던질 수 있는 baked puppet zip 만들기")가 둘 다 커버됨.
