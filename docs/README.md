# geny-avatar — Documentation Root

This directory holds the `geny-avatar` project's **research / design / progress records.** It is written before the code: every decision is agreed here first, then flows down into implementation.

## The project in one line

> **A 2D Live Avatar editor — a web app (Next.js) that takes a free skeleton sample, tidies its layers, generates and applies textures with generative AI, and lets you refine it right beside a live preview.**

The UI tone references [nikke-db.pages.dev/visualiser](https://nikke-db.pages.dev/visualiser) — its left character list / center preview / right tool-and-layer panel layout. Note, though, that NIKKE's visualiser is a *viewer* that simply displays **Spine 2D 4.0/4.1**, whereas our goal is an **editor + generator**.

## Operating Context — Solo Hobby

This project is **a one-person effort built solo, for fun.** I'm not a business and have no plans for commercial distribution. That shapes every licensing decision:

- Live2D Sample EULA "General Users" — that's us. Commercial use is even permitted.
- Spine runtime evaluation / personal use — passes.
- Third-party free models (e.g. shiralive2d) with "non-commercial OK" clauses — we're non-commercial.
- Copyright on game-extracted assets (e.g. NIKKE) — as long as we don't distribute them externally and only handle them in private experiments, that's our own responsibility.

→ Conclusion: **licensing does not block the project.** We do record asset provenance as metadata, but we don't build any forced flow like a LicenseGuard modal. If the scope ever grows — a shared gallery, commercialization, etc. — we'll revisit it then.

## Two Locked-in Philosophies

These two items take precedence over every later decision.

### P1 — Cubism and Spine are both first-class citizens

We won't do a staged rollout like "build Spine first, add Live2D later." **Both adapters are implemented together from the start.** We bring both up in the Phase 0 PoC, and by the end of Phase 1 puppets in both formats must work identically in the same UI.

**Why**: the free/paid puppets floating around the internet are split almost evenly between the two formats. Supporting only one means the user (= us) can't use half the assets they find. And the shape of the adapter interface is only truly validated by handling both formats at once — an abstraction built against a single format will inevitably break on the second.

### P2 — Uploading a file straight off the internet is the core V1 flow

User-asset upload is a Phase 1 day-1 feature. Not "build with built-in samples first, upload in Phase 2." **Drag-and-drop → automatic format detection → instant preview** is scenario #1 of the V1 demo.

**Why**: our tool's value is "putting new textures on a puppet you already have." If you can't upload your own puppet, the heart of the tool is gone. And in a hobby context the user = us = someone who grabs puppets off the internet to play with, so upload is the entry point we'll use most.

**Scope**: we accept Spine 3.8/4.0/4.1/4.2 + Cubism 2/3/4/5. Packing can be either a ZIP or a folder of individual files. If a format is broken or a version is incompatible, we show a clear error message plus guidance on how to fix it.

## Directory structure

```
docs/
├─ README.md                      # This file. The entry point.
├─ analysis/                      # Fact-gathering. No opinions or decisions here.
│  ├─ INDEX.md
│  ├─ 01_problem_statement.md
│  ├─ 02_format_landscape.md
│  ├─ 03_rendering_runtimes.md
│  ├─ 04_layer_skeleton_model.md
│  ├─ 05_texture_atlas_decomposition.md
│  ├─ 06_generative_ai_texture.md
│  ├─ 07_sample_sources.md
│  ├─ 08_competitive_reference.md
│  └─ 09_open_questions.md
├─ plan/                          # Design and decisions, grounded in analysis.
│  ├─ INDEX.md
│  ├─ 01_north_star.md
│  ├─ 02_architecture.md
│  ├─ 03_tech_stack.md
│  ├─ 04_data_model.md
│  ├─ 05_ai_pipeline.md
│  ├─ 06_ui_ux.md
│  ├─ 07_phased_roadmap.md
│  └─ 08_risks_and_mitigations.md
└─ progress/                      # Chronological work log. One file per unit (sprint/PR).
   ├─ INDEX.md
   └─ 2026-05-06_01_kickoff.md
```

## Reading order

If this is your first time here:
1. [analysis/01_problem_statement](analysis/01_problem_statement.md) — what we're trying to solve
2. [plan/01_north_star](plan/01_north_star.md) — what "done" looks like
3. [analysis/INDEX](analysis/INDEX.md) → jump to a topic of interest
4. [plan/07_phased_roadmap](plan/07_phased_roadmap.md) — how we'll build it in phases
5. [progress/INDEX](progress/INDEX.md) — where we are right now

## Conventions

- Separate fact from opinion. analysis holds only sourced facts; plan holds decisions and rationale.
- Attach a one-line **Why** to every decision, so future-me can follow the reasoning.
- Mark uncertain items with `[VERIFY]` and open questions with `[OPEN]`, and collect them in [analysis/09_open_questions](analysis/09_open_questions.md).
- Always record external libraries / licenses / model sources together with a URL. It must still be traceable a year from now.
- Create the progress record when work *starts*, not after the fact, and finalize it when the PR merges.

## Current status (2026-05-06)

- [x] Directory scaffold
- [x] First research round (formats, runtimes, samples, AI pipeline surface)
- [x] Initial 8 plan documents
- [x] Operating context (solo hobby) settled → no licensing blockers
- [x] P1 (Cubism + Spine both first-class) / P2 (upload day-1) settled
- [ ] Decide the AI backend (start with Replicate → self-hosted ComfyUI later)
- [ ] Phase 0 — both-runtime PoC + lock the adapter interface
- [ ] Phase 1 — both runtimes + upload + layer toggle working
