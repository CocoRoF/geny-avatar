# 2026-05-13 hotfix — FLUX 호출에서 canonical-pose ref 제외

**Phase / 작업**: Phase 1 작업 2 / 1.4 follow-up
**상태**: done (fix 적용, 사용자 재검증 필요)
**관련 계획**: [../plan/01-Phase1.md](../plan/01-Phase1.md) 작업 2 + 4

## 문제

[PR #11](https://github.com/CocoRoF/geny-avatar/pull/11)로 FLUX
provider에 composePrompt scaffold 추가 (image_urls[1+]은 spatial
context only, DO NOT transfer colours) 했지만, 사용자 재테스트에서
**FLUX이 image_urls[1] (Phase 1.2 canonical-pose snapshot)을 그대로
머리 자리에 stamp**. 결과 image에 character 전체가 머리 형상으로
합성 — completely broken.

prompt scaffold가 FLUX 동작을 통제하지 못했음.

## 원인

fal.ai flux-2/edit은 `image_urls[]`의 **모든 entry를 visual example
로 강하게 따라간다**. OpenAI gpt-image-2와 의미가 다르다:

- OpenAI gpt-image-2: image[] 다중 entry를 separate role (source vs
  reference)로 인식. 자연어 prompt로 role 명시 가능.
- fal.ai flux-2/edit: image_urls 모든 entry를 "이렇게 그려라" 예제로
  인식. prompt로 role 분리 어려움.

Phase 1.2에서 canonical-pose ref를 OpenAI 정책으로 도입했는데,
GeneratePanel onSubmit이 provider 무관하게 `submitRefs`에 부착해
FLUX 호출에도 흘러갔다. provider별로 다른 정책이 필요한 영역.

## 변경

[components/GeneratePanel.tsx](../../components/GeneratePanel.tsx)
onSubmit — `supportsCharacterRef = providerId === "openai"` 조건
추가. FLUX (또는 다른 provider)일 때 canonical-pose ref 부착 skip.
사용자 명시 ref (`activeRefBlobs`)는 그대로 forward — 사용자가
의도적으로 attach한 style anchor이므로.

콘솔 로그 갱신:
```
[generate] character-ref: skipped (provider=falai doesn't disambiguate ref roles)
```

## 검증

- `pnpm typecheck` ✓
- `pnpm exec biome check components/GeneratePanel.tsx` ✓
- 실호출 재검증: 사용자가 dev 재시작 후 fal.ai FLUX.2로 "white hair"
  다시 → 결과가 정상 머리 형상으로 흰색, character 전체 stamp 없음.
  콘솔에 `character-ref: skipped (provider=falai ...)` 출력 확인.

## 결정

1. **GeneratePanel 단에서 분기**. 더 깔끔한 길은 `ProviderGenerateInput`
   인터페이스에 `spatialContextImage?: Blob` 필드 추가하고 provider가
   알아서 사용 결정. 다만 그건 server route form 필드 추가까지 줄줄
   변경 — 이 hotfix 범위에 비해 큼. 인터페이스 확장은 Phase 3
   orchestrator 작업 시 함께.
2. **사용자 명시 ref는 그대로 유지**. 사용자가 의도적으로 attach한
   reference는 style/identity anchor 의도. 그건 FLUX의 강한 imitation
   동작과 일치.
3. **composePrompt의 "DO NOT transfer colours" 문구**: FLUX 호출에
   user ref만 들어가는 경우 이 문구가 약간 wrong (user가 style anchor
   의도일 수도). 다만 user ref + FLUX 조합의 실측 결과는 아직 없음.
   문구는 그대로 두고 quality 측정 후 조정.

## 영향

- Phase 1.2의 canonical-pose snapshot이 OpenAI 전용으로 좁아짐. FLUX
  호출은 source + 사용자 ref 만으로 진행. spatial context 부재 영향
  은 사용자 측정으로 평가.
- OpenAI 흐름은 변화 없음.
- 인터페이스 변경 없음 — provider-aware 정책이 GeneratePanel 내부에
  국한. 미래 Phase 3에서 `spatialContextImage` 채널로 정식화.

## Phase 1 closure 영향

[2026-05-12-phase1-closure.md](2026-05-12-phase1-closure.md) Criterion
2 (canonical ref 부착 정책) 의 동작 정의가 약간 바뀜 — `OpenAI일
때만` 부착. 사용자 재검증으로 정상 확인 후 closure entry 본문에 반영.

## 다음 단계

사용자 재테스트:

- FLUX "white hair" → 머리 모양 정상 + 흰색 + 외곽 잔존 여부.
- 외곽 잔존 여전 → erode radius 강화 또는 다른 보강.
- 머리 모양 정상이면 큰 issue 해결. 외곽 quality는 별도 fine-tune.

## 참조

- 손댄 파일 1개: `components/GeneratePanel.tsx`.
- PR: 이 entry가 포함된 PR이 머지될 때 main에 들어감.
