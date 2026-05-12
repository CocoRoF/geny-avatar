# docs-upgrade — Next-Generation geny-avatar Plan

This folder holds the analysis and plan for upgrading geny-avatar from a
"per-layer AI texture edit" tool into a **whole-character generative
editor** capable of coherent multi-part edits ("change her hair color
to red", "give her a school uniform"), the way a VTuber commission
artist would think about the job.

The existing [`docs/`](../docs/) folder captured the *original* design
goals through V1. Most of that has shipped. The work that remains is
about the gap between "I can edit one atlas region with AI" (we have
this) and "I can transform an entire avatar coherently" (we don't).
That gap is the subject of this folder.

## How this folder is organised

The docs fall into three tracks, intended to be read in order:

### Track A — Inventory and problem framing (read first)

| # | Doc | Purpose |
|---|-----|---------|
| 01 | [vision-and-gap-analysis](01-vision-and-gap-analysis.md) | What we want to ship, where we are, where the gap is |
| 02 | [current-architecture](02-current-architecture.md) | Technical map of geny-avatar as it exists today |
| 03 | [live2d-anatomy](03-live2d-anatomy.md) | Cubism model internals — parts, drawables, atlas, the geometry of the problem |
| 04 | [multipart-problem](04-multipart-problem.md) | The core challenge: cohesive edits across N parts |

### Track B — Research and options (read second)

| # | Doc | Purpose |
|---|-----|---------|
| 05 | [ai-stack-survey](05-ai-stack-survey.md) | 2026 image-generation toolchain — gpt-image-2, Flux, SDXL, ControlNet, IP-Adapter |
| 06 | [comparable-tools](06-comparable-tools.md) | What other tools do (VRoid, Cubism Editor, Krita AI, etc.) |
| 07 | [strategy-options](07-strategy-options.md) | The 4–5 viable architectural directions, traded off |

### Track C — Decision and execution (read third)

| # | Doc | Purpose |
|---|-----|---------|
| 08 | [recommended-architecture](08-recommended-architecture.md) | The chosen approach + the reasoning |
| 09 | [phased-roadmap](09-phased-roadmap.md) | Concrete milestones — what ships first |
| 10 | [prompt-engineering](10-prompt-engineering.md) | The new prompt patterns that the architecture demands |
| 11 | [data-model-evolution](11-data-model-evolution.md) | IDB schema + store + types changes |
| 12 | [ux-flow](12-ux-flow.md) | The new user journey, from intent to result |
| 13 | [failure-modes-and-eval](13-failure-modes-and-eval.md) | How it can fail, how we detect, how we measure success |

## Reading order recommendations

- **If you're new to the codebase:** Read 02 → 03 → 04 first. Those
  three docs are the technical foundation.
- **If you want the bottom line:** Read 01 → 08 → 09. Vision, choice,
  schedule.
- **If you're implementing a specific phase:** Match the phase in 09 to
  the supporting decision doc — phases reference the docs they depend on.

## Writing conventions

- **Facts vs decisions** — Track A and most of B are facts (what
  exists, what works, what doesn't). Track C is decisions. Mixing them
  in the same doc means later readers can't tell what's
  observed-truth and what's chosen-strategy.
- **Cite the code, not the file path alone.** When a doc references
  current behaviour, link to the exact function + line so future
  drift is detectable.
- **Mark uncertainty.** `[VERIFY]` for claims we haven't tested,
  `[OPEN]` for unresolved design questions. Drop the marker when
  resolved.
- **Don't echo `docs/`.** The original analysis folder has the V1
  context (formats, runtimes, atlas decomposition). When this folder
  needs that material, link to it instead of restating.

## Status — 2026-05-12

Initial scaffold + first pass of all 14 docs. Many sections will be
shallow on first commit; the intent is to set the structure now and
let each doc grow as we learn through implementation phases.
