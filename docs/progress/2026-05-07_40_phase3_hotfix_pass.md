# 2026-05-07 — Phase 3 hotfix pass

[`39_phase3_complete`](2026-05-07_39_phase3_complete.md) 이후 사용자 시연 중에 드러난 9개의 결함을 잡는 hotfix 묶음. 각 fix는 atomic 커밋이라 필요시 개별 revert 가능.

## 사용자 발견 결함

### A. AI 입력 품질 — OpenAI gpt-image-2 결과가 어둡거나 엉뚱

OpenAI가 transparent padding을 어두운 영역으로 해석해서 입술 등이 검게 칠해지거나, mask가 sparse fragments라 모델이 footprint를 못 잡고 무관한 형상(peace-sign hand 등)을 생성.

- `7944ff1` Fix GeneratePanel source preview not rendering — extract와 paint를 두 effect로 분리 (ref가 같은 tick에 안 붙음)
- `2717d2e` Fix OpenAI 400 'Unknown parameter: quality' — `quality`/`size`/`response_format` form field 제거. 공개 docs는 거짓말, 엔드포인트가 모델별 strict validation
- `6a9904e` Make OpenAI generation pixel-stable — footprint mask + 1024² scaled crop
- `ff09e80` Revert always-on OpenAI mask — 사용자가 그렸을 때만 보냄 (always-on이 dense fragments로 모델을 혼란스럽게 함)
- `d2e04cb` White pad + bbox mask — transparent를 white로 채워 dark-bias 제거, mask는 layer rect 통째 (binary bbox)

### B. Mask + gen 합성 — 두 편집이 서로를 지우는 문제

DecomposeStudio mask와 GeneratePanel 결과를 동시 적용하면 mask가 새 텍스처도 같이 erase하거나 ("AI가 그린 픽셀 위에 mask 구멍이 뚫림"), 반대로 새 텍스처가 mask를 덮어씀.

- `6f65a31` Don't erase fresh AI texture with the mask that produced it — apply 시 mask는 pristine source에만 적용, 생성 텍스처는 그 위에 덧씌움
- `d480b60` Make mask + gen compose as the user expects — composite 순서: source → texture (source-over + 삼각형 clip) → mask (destination-out)
- `86445e7` Unified texture editor — source previews show current visible state — DecomposeStudio/GeneratePanel이 각각 "지금 보이는 그대로"를 source로 캡처, 두 편집 흐름이 같은 시작점을 공유
- `17e5e49` GeneratePanel: keep AI input dense even with a saved mask — `aiSourceCanvasRef` (pre-mask, post-gen)와 `previewSourceRef` (post-mask, post-gen) 분리. AI 모델은 dense source를 받고, 미리보기는 사용자가 보는 그대로
- `b954393` Stop sending DecomposeStudio mask to OpenAI — mask는 live-render 단계에서만 의미. AI 호출에서는 완전히 제외 (모델은 sparse mask를 부정확하게 해석함)

### C. Cubism layer 누락 — 다리 텍스처가 panel에서 사라짐

`Phase 2.6`에서 도입한 dedup 휴리스틱이 visible 텍스처가 있는 part까지 hide하거나, multi-page part의 non-dominant page 콘텐츠를 통째 드롭.

- `8de0484` Stop hiding 'clip-role' parts — 다른 drawable의 mask로 *동시에* 쓰이는 part는 자기 자체 visible content도 가질 수 있음. dedup 필터에서 빼고 진단 로그로 강등
- `3c48cf7` Live2DAdapter: split multi-page parts into per-page layers — direct drawables가 ≥2 atlas page에 걸친 Cubism part는 (part, page) 쌍마다 Layer 하나씩. externalId에 `#p{idx}` suffix → IDB job history도 page별 안정 키. 이전엔 dominant page만 노출돼서 다리 메시가 panel에서 사라졌음

## 사용자가 못박은 원칙 (이번 hotfix에서 확정)

> "이 중복처리 로직이 설령 중복을 제대로 처리하지 못하는 부분이 있더라도 절대 특정 텍스처 part를 누락되게 만들면 안 되는거야."

→ Layer dedup은 "panel UX 정리"용이지 "데이터 손실 방지" 위에 올라가지 않음. 의심스러우면 노출 (false positive 1개 < missing texture 1개).

## 검증

- typecheck 통과
- biome 통과
- `next build` 통과
- 시각 검증: Hiyori + 자체 puppet 두 개로 mask+gen 합성, multi-page part 편집, OpenAI/Gemini 양쪽 결과 품질 확인

## 알려진 잔여 한계

`39_phase3_complete`의 한계 목록은 그대로 유효:
- Replicate full 구현 X (shape-only stub)
- OpenAI non-square layer는 padding으로 약간의 quality loss
- History 정리 UI X (`deleteAIJob` 헬퍼만 export)
- Cancel API X

## 다음

Phase 4 (Variant System & Export) 진입. [`41_phase4_kickoff`](2026-05-07_41_phase4_kickoff.md) 참고.
