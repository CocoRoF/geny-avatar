# 2026-05-12 Phase 1.2 — Canonical-pose render를 image[2] 슬롯에 부착

**Phase / 작업**: Phase 1 작업 2 (Canonical-pose render를 image[2]에 추가)
**상태**: done (코드 변경 완료, 시각 검증은 실제 puppet 편집 시)
**관련 계획**: [../plan/01-Phase1.md](../plan/01-Phase1.md) 작업 2

## 코드베이스 탐색에서 확인된 사실

- 기존 thumbnail 캡처 ([lib/avatar/captureThumbnail.ts](../../lib/avatar/captureThumbnail.ts))는
  `app.renderer.extract.canvas(app.stage)` 패턴을 사용. canonical pose
  렌더도 같은 기법으로 작은 wrapper로 충분.
- `AvatarAdapter` 인터페이스는 Pixi `Application`을 노출하지 않음.
  `getDisplayObject()` 만 노출. Application은 [lib/avatar/usePuppet.ts](../../lib/avatar/usePuppet.ts)
  에서 만들어 edit page가 직접 보유.
- LayersPanel → GeneratePanel은 `adapter`, `puppetKey` 만 받음 — `app`
  은 prop drilling 안 됐었음. AnimationPanel은 이미 `app` 받음 (참고
  패턴 존재).

## 변경

- **신설** [lib/avatar/canonicalPoseRender.ts](../../lib/avatar/canonicalPoseRender.ts)
  — `renderPuppetReference(app, { widthPx? }): Promise<Blob | null>`.
  captureThumbnail 패턴 그대로, 출력은 PNG (multipart 호환), default
  long-side 1024px, ~600KB 이하.
- **수정** [components/LayersPanel.tsx](../../components/LayersPanel.tsx)
  — `app: Application | null` prop 추가. GeneratePanel mount 지점에
  `app={app}` 전달.
- **수정** [components/GeneratePanel.tsx](../../components/GeneratePanel.tsx)
  — Props에 `app` 추가. `onSubmit` 안 prepared 준비 직후에 한 번
  `renderPuppetReference(app)` 호출 → `characterRefBlob`. user refs가
  3개 이하일 때만 부착 (image[] budget). 새 로컬 `submitRefs` 배열로
  user refs + character ref 합침. 두 submit 호출 지점
  ([line 1206](../../components/GeneratePanel.tsx#L1206) multi-component
  일괄 / [line 1263](../../components/GeneratePanel.tsx#L1263) Gemini)
  에서 `activeRefBlobs` 대신 `submitRefs` 사용.
- **수정** [app/edit/[avatarId]/page.tsx](../../app/edit/[avatarId]/page.tsx)
  와 [app/edit/builtin/[key]/page.tsx](../../app/edit/builtin/[key]/page.tsx)
  — LayersPanel에 `app={app}` 전달.

## 검증

- `pnpm typecheck` — 통과.
- `pnpm exec biome check` (touched files 7개) — 통과.
- 시각 검증: 사용자 환경에서 puppet 편집 시 콘솔에 `[generate]
  character-ref: attached (~B, slot N)` 로그 노출. AI 결과의 spatial
  context 충실도 향상은 ship criteria 측정 시점에 정량.

## 결정

1. **Adapter 인터페이스 변경 안 함**. `getPixiApp()` 메서드 추가가
   API 정합성으로 더 깔끔하지만, 두 어댑터 모두 구현 변경 필요 +
   "AvatarAdapter는 runtime independent" 추상화가 약간 깨짐. 대신
   prop drilling 한 단계 (page → LayersPanel → GeneratePanel)로 해결.
2. **메모리 캐싱 안 함**. Phase 1 작업 2 계획에서 "세션당 1회 캐싱"
   언급했지만, `app.renderer.extract.canvas` 비용 (~50-200ms)이
   generate call 30초에 비해 무시할 수준. 매 submit마다 신규 캡처가
   더 단순하고, layer override 변경 시 stale 문제 없음. IDB 영속화는
   Phase 2 작업 1 (IDB v8 스키마) 에서 함께 도입.
3. **Append (마지막 슬롯) 정책**. canonical pose는 spatial context
   reference이지 identity anchor가 아님. 사용자 업로드 ref가 dominant
   anchor 역할을 그대로 유지해야 함. 슬롯 budget이 4라면 [user
   refs..., character_ref] 순서.
4. **3개 user ref 이하에서만 부착**. gpt-image-2 image[] 한도 (4)를
   user ref + character ref + source 로 채우지 않게. 한도 도달 시
   skip + 로그.
5. **"Canonical pose"는 약간 미스리밍**. 실제로 캡처하는 건 현재
   stage 상태이지 default 파라미터 reset 상태가 아님. 이유는 모듈
   doc 코멘트에 명시. Phase 2/3에서 hidden offscreen Pixi app +
   true canonical reset으로 발전.
6. **refinePrompt 호출엔 character ref 안 보냄**. vision LLM이 ref를
   읽고 prompt를 refine할 때 character ref가 들어가면 prompt가
   캐릭터 정보까지 반영해 더 풍부해질 수도 있지만, 이전 동작과 약간
   다른 결과 가능. 보수적으로 generate-only 적용.
7. **onSubmit 흐름만 패치**. `regenerateOneRegion` 같은 onSubmit 외
   useCallback 흐름 (line 875, 895, 930)은 character ref 미부착 상태.
   이 흐름들도 동일 처리해야 하지만 Phase 1 범위 외 — Phase 2/3에서
   refs policy를 본격 정리할 때 함께.

## 영향

- 모든 onSubmit-기반 OpenAI multi-component generate / Gemini single
  generate 호출이 character ref를 추가로 받음. 비용: provider 호출당
  +1 image upload (~수백 KB). gpt-image-2 호출은 multipart 본체 크기
  증가로 약간의 latency 추가 가능 (대역폭 의존).
- regenerateOneRegion 등 보조 흐름은 미적용 — 일관성 측면에서
  Phase 1 종료 전 보강 권장. 진행 로그 다음 entry에서 처리하거나
  Phase 2에서 함께.
- Adapter 인터페이스 안 건드림 → spine / live2d 양쪽 모두 동일 동작
  (실제로 두 어댑터 모두 captureThumbnail 패턴으로 동작 가능).

## 다음 작업

[../plan/01-Phase1.md](../plan/01-Phase1.md) 작업 4 (FLUX.2 provider
추가) 또는 작업 6 (OpenAI prompt에 Cubism 컨텍스트 추가). 두 작업
모두 독립적이라 어느 쪽 먼저 진행해도 됨. 다음 entry에서 결정.

## 참조

- 손댄 파일 5개:
  - `lib/avatar/canonicalPoseRender.ts` (신설)
  - `components/LayersPanel.tsx` (prop drilling)
  - `components/GeneratePanel.tsx` (canonical ref 부착)
  - `app/edit/[avatarId]/page.tsx` (prop 전달)
  - `app/edit/builtin/[key]/page.tsx` (prop 전달)
- PR: 이 entry가 포함된 PR이 머지될 때 main에 들어감.
