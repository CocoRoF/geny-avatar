# progress/

Folder where the progress log of geny-avatar upgrade work accumulates.

- Analysis body: the 14 documents in the sibling folder `..` (docs-upgrade).
- Execution plan: the 5 documents in the sibling folder [`../plan/`](../plan/).
- This folder (`progress/`): leaves **a trace of the work actually done**, one unit at a time.

## File naming convention

```
progress/
  README.md                 ← this file (guide + index)
  YYYY-MM-DD-<slug>.md      ← per-work-unit entry
```

- One entry = one piece of work (1 to a few commits, roughly 1 PR).
- The date is the start date of the work (KST).
- `<slug>` is a short ASCII / digits / hyphens. e.g. `phase1-1-mask-erosion`.
- Multiple entries on the same day are distinguished by suffix: `2026-05-12-phase1-1-mask-erosion.md`,
  `2026-05-12-phase1-2-canonical-pose.md`.

## Entry format

Fill in the following items in each file. Keep it to a 3–8 line summary, not long prose.

```markdown
# <YYYY-MM-DD> Phase<N>.<task#> — <short title>

**Phase / task**: Phase N task #
**Status**: in-progress | done | blocked
**Related plan**: [plan/0X-PhaseN.md](../plan/0X-PhaseN.md) task #

## Changes
- Files touched / key changes (a line or two each).

## Verification
- How it was checked. Numbers if there are measurements.

## Decisions
- Anything decided along the way. Note it if it diverged from the plan.

## Impact
- Effect on later work / other phases.

## References
- Commit hash / PR link / external material, etc.
```

## Operating rules

- Create the entry file **right after work starts**. Status `in-progress`.
- Update the same file **when work ends**. Status `done` or `blocked`.
- Don't write long analysis / retrospectives inside an entry. Update the
  analysis docs under [`../`](..) for retrospective / decision bodies when needed.
- The progress log is **append-only**. Correct mistakes in a later entry;
  never rewrite an earlier entry after the fact.
- For blocked work, state the reason it's blocked in the entry, and once
  unblocked follow up with a new entry.

## Index (newest on top)

Add a line here whenever work is added.

| Date | File | Phase | PR | Status |
|---|---|---|---|---|
| 2026-05-13 | [2026-05-13-mask-soft-blend.md](2026-05-13-mask-soft-blend.md) | 1.x mask-soft (feather) | (this PR) | done |
| 2026-05-13 | [2026-05-13-blend-mode-selectable.md](2026-05-13-blend-mode-selectable.md) | 1.x blend mode UI | [#32](https://github.com/CocoRoF/geny-avatar/pull/32) | done |
| 2026-05-13 | [2026-05-13-postprocess-mask-blend.md](2026-05-13-postprocess-mask-blend.md) | 1.x hard mask blend | [#31](https://github.com/CocoRoF/geny-avatar/pull/31) | done |
| 2026-05-13 | [2026-05-13-openai-timeout-and-mask-ref-alignment.md](2026-05-13-openai-timeout-and-mask-ref-alignment.md) | 1.x timeout + dim align | [#30](https://github.com/CocoRoF/geny-avatar/pull/30) | done |
| 2026-05-13 | [2026-05-13-mask-as-reference-hint.md](2026-05-13-mask-as-reference-hint.md) | 1.x Option X (mask = hint) | [#29](https://github.com/CocoRoF/geny-avatar/pull/29) | done |
| 2026-05-13 | [2026-05-13-inpaint-oversized-frame.md](2026-05-13-inpaint-oversized-frame.md) | 1.x oversized frame | [#28](https://github.com/CocoRoF/geny-avatar/pull/28) | done |
| 2026-05-13 | [2026-05-13-falai-flux-pro-fill.md](2026-05-13-falai-flux-pro-fill.md) | 1.x FLUX pro fill | [#27](https://github.com/CocoRoF/geny-avatar/pull/27) | done |
| 2026-05-13 | [2026-05-13-openai-inpaint-path.md](2026-05-13-openai-inpaint-path.md) | 1.x OpenAI inpaint | [#26](https://github.com/CocoRoF/geny-avatar/pull/26) | done |
| 2026-05-13 | [2026-05-13-inpaint-source-padding-and-prompt.md](2026-05-13-inpaint-source-padding-and-prompt.md) | 1.x char hallucination | [#25](https://github.com/CocoRoF/geny-avatar/pull/25) | done |
| 2026-05-13 | [2026-05-13-mask-roundtrip-and-preview.md](2026-05-13-mask-roundtrip-and-preview.md) | 1.x mask roundtrip | [#24](https://github.com/CocoRoF/geny-avatar/pull/24) | done |
| 2026-05-13 | [2026-05-13-embedded-mask-format-and-context.md](2026-05-13-embedded-mask-format-and-context.md) | 1.x inpaint convention | [#23](https://github.com/CocoRoF/geny-avatar/pull/23) | done |
| 2026-05-13 | [2026-05-13-fix-decompose-wrapper-remount-loop.md](2026-05-13-fix-decompose-wrapper-remount-loop.md) | 1.x crash fix | [#22](https://github.com/CocoRoF/geny-avatar/pull/22) | done |
| 2026-05-13 | [2026-05-13-embedded-hide-split-paint.md](2026-05-13-embedded-hide-split-paint.md) | 1.x mode hide | [#21](https://github.com/CocoRoF/geny-avatar/pull/21) | done |
| 2026-05-13 | [2026-05-13-decompose-embedded-in-mask-tab.md](2026-05-13-decompose-embedded-in-mask-tab.md) | 1.x MASK = DecomposeStudio | [#20](https://github.com/CocoRoF/geny-avatar/pull/20) | done |
| 2026-05-13 | [2026-05-13-mask-tab-full-features.md](2026-05-13-mask-tab-full-features.md) | 1.x MASK full | [#19](https://github.com/CocoRoF/geny-avatar/pull/19) | done |
| 2026-05-13 | [2026-05-13-mask-tab-fixes.md](2026-05-13-mask-tab-fixes.md) | 1.x MASK fixes | [#18](https://github.com/CocoRoF/geny-avatar/pull/18) | done |
| 2026-05-13 | [2026-05-13-generate-mask-tab.md](2026-05-13-generate-mask-tab.md) | 1.x MASK tab UI | [#17](https://github.com/CocoRoF/geny-avatar/pull/17) | done |
| 2026-05-13 | [2026-05-13-inpaint-mask-from-source-alpha.md](2026-05-13-inpaint-mask-from-source-alpha.md) | 1.x ControlNet f/u | [#16](https://github.com/CocoRoF/geny-avatar/pull/16) | done |
| 2026-05-13 | [2026-05-13-falai-inpainting-model.md](2026-05-13-falai-inpainting-model.md) | 1.x ControlNet | [#15](https://github.com/CocoRoF/geny-avatar/pull/15) | done |
| 2026-05-13 | [2026-05-13-phase1-3-verification-result.md](2026-05-13-phase1-3-verification-result.md) | 1.3 verification result | [#14](https://github.com/CocoRoF/geny-avatar/pull/14) | done |
| 2026-05-13 | [2026-05-13-falai-no-character-features.md](2026-05-13-falai-no-character-features.md) | 1.4 hotfix (3rd) | [#13](https://github.com/CocoRoF/geny-avatar/pull/13) | done |
| 2026-05-13 | [2026-05-13-falai-skip-canonical-ref.md](2026-05-13-falai-skip-canonical-ref.md) | 1.2/1.4 hotfix | [#12](https://github.com/CocoRoF/geny-avatar/pull/12) | done |
| 2026-05-13 | [2026-05-13-falai-prompt-scaffold.md](2026-05-13-falai-prompt-scaffold.md) | 1.4 follow-up | [#11](https://github.com/CocoRoF/geny-avatar/pull/11) | done |
| 2026-05-12 | [2026-05-12-fix-jobs-map-singleton.md](2026-05-12-fix-jobs-map-singleton.md) | infra hotfix | [#10](https://github.com/CocoRoF/geny-avatar/pull/10) | done |
| 2026-05-12 | [2026-05-12-phase1-4-fix-fal-status-405.md](2026-05-12-phase1-4-fix-fal-status-405.md) | 1.4 hotfix | [#9](https://github.com/CocoRoF/geny-avatar/pull/9) | done |
| 2026-05-12 | [2026-05-12-phase1-closure.md](2026-05-12-phase1-closure.md) | 1 (closure) | [#8](https://github.com/CocoRoF/geny-avatar/pull/8) | done |
| 2026-05-12 | [2026-05-12-phase1-5-router.md](2026-05-12-phase1-5-router.md) | 1.5 | [#7](https://github.com/CocoRoF/geny-avatar/pull/7) | done |
| 2026-05-12 | [2026-05-12-phase1-4-falai-provider.md](2026-05-12-phase1-4-falai-provider.md) | 1.4 | [#6](https://github.com/CocoRoF/geny-avatar/pull/6) | done |
| 2026-05-12 | [2026-05-12-phase1-6-cubism-prompt.md](2026-05-12-phase1-6-cubism-prompt.md) | 1.6 | [#4](https://github.com/CocoRoF/geny-avatar/pull/4) | done |
| 2026-05-12 | [2026-05-12-phase1-2-canonical-pose.md](2026-05-12-phase1-2-canonical-pose.md) | 1.2 | [#3](https://github.com/CocoRoF/geny-avatar/pull/3) | done |
| 2026-05-12 | [2026-05-12-phase1-1-mask-erosion.md](2026-05-12-phase1-1-mask-erosion.md) | 1.1 | [#2](https://github.com/CocoRoF/geny-avatar/pull/2) | done |
| 2026-05-12 | [2026-05-12-bootstrap.md](2026-05-12-bootstrap.md) | 0 (setup) | [#1](https://github.com/CocoRoF/geny-avatar/pull/1) | done |
