# 09 — Phased Roadmap

Translates the architecture in
[08-recommended-architecture](08-recommended-architecture.md) into
shipping milestones. Each phase delivers user-visible value
independently and can be deferred without blocking earlier phases.

Time estimates assume one focused engineer; double them for less-
focused work or to account for review / polish.

## Phase 1 — Per-layer fixes and FLUX.2 escape hatch  (2–3 weeks)

**Goal**: capture the easy wins identified in
[01-vision](01-vision-and-gap-analysis.md) + [05-ai-stack-survey](05-ai-stack-survey.md)
without changing the data model.

| Work | Owner | Doc reference |
|---|---|---|
| Erode mask 4–8 px inside atlas rect before sending to gpt-image-2 | client | [05](05-ai-stack-survey.md) "Mask conventions" |
| Add canonical-pose render to provider call as `image[2]` | client + adapter | [08](08-recommended-architecture.md) |
| Add Canny silhouette as optional `image[4]` ref | client | [05](05-ai-stack-survey.md) "Reference image strategy" |
| Wire FLUX.2 Edit as 4th provider via fal.ai | server + provider | [05](05-ai-stack-survey.md) |
| Provider routing rule: gpt-image-2 default, FLUX bulk fan-out | client | [05](05-ai-stack-survey.md) "Costs at scale" |
| Update OpenAI prompt to acknowledge Cubism context | provider | [10](10-prompt-engineering.md) |
| Progress UI: per-call status when running ≥3 calls in sequence | UI | [12](12-ux-flow.md) |

**Ship criteria**:

- Seam contamination across atlas neighbours drops to <1% (visual
  inspection of 20 sample edits).
- Canonical-pose render attached on 100% of OpenAI generate calls.
- FLUX.2 Edit available behind a provider selector with `fal.ai`
  key.
- Existing user workflows unbroken (smoke test all five built-in
  samples + 3 user-uploaded models).

**Not in scope**: semantic groups, intent layer, tint path.

## Phase 2 — Semantic groups + tint fast-path  (4–6 weeks)

**Goal**: introduce the semantic-group abstraction and ship the
chromatic editing experience that 60%+ of casual user intents fall
into. Headline feature: "change hair color to red" works in one
slider drag.

| Work | Owner | Doc reference |
|---|---|---|
| IDB schema v8: add `semanticGroups` table, `semanticGroup` field on Layer | persistence | [11](11-data-model-evolution.md) |
| Classifier: rule-engine over parameter names + parent-deformer names + CLIP embeddings | adapter + lib/avatar | [03](03-live2d-anatomy.md) "Naming conventions" |
| Migration: run classifier on existing puppets on first open after upgrade | persistence | [11](11-data-model-evolution.md) |
| Group review modal: present classifier results, let user reassign | UI | [12](12-ux-flow.md) |
| LayersPanel: add Groups tab listing semantic groups | UI | [12](12-ux-flow.md) |
| Adapter API: `setMultiplyColor(partIndex, rgb)` + `setScreenColor(partIndex, rgb)` | adapter | [03](03-live2d-anatomy.md) "multiplyColor" |
| Tint UI: HSV picker per group, sliders for hue/sat/val | UI | [12](12-ux-flow.md) |
| Tint math: HSV-to-multiply-screen conversion preserving relative palette | lib/avatar | [04](04-multipart-problem.md) "Architecture A" |
| Lock flags: per-drawable `groupLocked` and per-group `locked` | persistence + UI | [08](08-recommended-architecture.md) "Lock semantics" |
| Provenance log: tint edits write to `editProvenance` | persistence | [08](08-recommended-architecture.md) |

**Ship criteria**:

- Classifier matches a 50-model golden set with ≥90% accuracy on
  primary groups (hair_*, face_*, top, bottom).
- User can recolor hair on Hiyori, Mao Pro, and 3 BOOTH samples
  in under 10 seconds end-to-end.
- Tint edits survive a full export → re-import cycle without
  metadata loss.
- Lock flags prevent group-level operations on flagged drawables
  (verified by test).

**Not in scope**: intent layer (manual UI for now), AI orchestrator.

## Phase 3 — Intent layer + sequential AI orchestrator  (6–9 weeks)

**Goal**: ship the "type a sentence, get a coherent edit" headline
flow. Handles non-tint intents via sequential reference chaining
across semantic groups.

| Work | Owner | Doc reference |
|---|---|---|
| Intent parser: chat-LLM pre-pass with structured response schema | server | [10](10-prompt-engineering.md) "Intent parsing" |
| Intent dispatcher: routes to tint or AI orchestrator based on parsed intent | client | [08](08-recommended-architecture.md) |
| AI orchestrator: ranks drawables, picks anchor, threads references | client | [08](08-recommended-architecture.md) "Generate orchestrator" |
| Palette extractor: k-means on anchor result, surface in subsequent prompts | client | [10](10-prompt-engineering.md) "Palette anchoring" |
| Reference rotation: cap at 4 refs, prioritise most-recent + anchor | client | [05](05-ai-stack-survey.md) |
| Orchestrator UI: shows progress per drawable, allow per-drawable abort/regen | UI | [12](12-ux-flow.md) |
| Per-group preview: render-canvas snapshot of partial edits | UI + adapter | [12](12-ux-flow.md) |
| Per-group accept / reject / regenerate | UI | [12](12-ux-flow.md) |
| Provenance: AI edits write full payload (prompt, model, refs) to log | persistence | [08](08-recommended-architecture.md) |

**Ship criteria**:

- Eval set (defined in [13](13-failure-modes-and-eval.md)) shows
  cross-drawable palette variance ≤15% (compared to >40% baseline
  from independent generation).
- "Change hair to wet leather" on Hiyori completes in ≤2 minutes
  with visually coherent results.
- "Give her a school uniform" on a sample model completes the
  multi-group flow within budget (≤5 minutes) and produces
  recognisable, coherent output.

**Not in scope**: render-and-back-project, PSD round-trip.

## Phase 4 — Render-and-back-project  (8–12 weeks, with spike)

**Goal**: the strategic differentiator. Render the puppet, AI edits
the rendered character, we back-project to atlas pages.

**Spike first** (1 week): prototype UV back-projection on Hiyori.
Pick a single edit (recolor jacket), implement pixel-to-triangle-
to-atlas mapping, verify results match the orchestrator path. If
the spike succeeds, commit to the phase; if it fails on
hard-to-fix issues (rotation ambiguity, occlusion), defer Phase 4.

| Work | Owner | Doc reference |
|---|---|---|
| Spike: UV back-projection on a single sample | adapter | this doc |
| Canonical-pose render at full resolution (1024–2048 wide) | adapter | [08](08-recommended-architecture.md) |
| Image-space → drawable-pixel mapping: for every output pixel, find triangle, find atlas rect | adapter | new |
| Per-drawable rotation + padding aware paste | adapter | [03](03-live2d-anatomy.md) "Atlas packing" |
| Occlusion handling: when two drawables overlap in image space, which wins? | adapter | new |
| Group-mask generation in image space: union of all member drawable clip paths | adapter | new |
| Composition: apply back-projected pixels as `layerTextureOverrides` | client | existing |
| Intent dispatcher: route appropriate intents to this path (vs orchestrator) | client | [08](08-recommended-architecture.md) |
| Eval: render at parameter extremes, compare against orchestrator path | qa | [13](13-failure-modes-and-eval.md) |

**Ship criteria**:

- Spike validates: a single AI edit on the rendered character
  back-projects to the right atlas pixels on ≥80% of drawables
  in the target group.
- Production: "Give her a school uniform" via this path produces
  results coherent enough that A/B testing prefers it ≥70% over
  the Phase 3 orchestrator path.
- Animation tests: render at 6 parameter extremes (head turn,
  body angle, hair, breath, blink) — no visible seams or content
  drift.

**Not in scope**: PSD round-trip, mesh edits.

## Phase 5 — PSD round-trip (v4+, deferred)  (12+ weeks)

**Goal**: premium tier. Edit at PSD layer level, re-bake atlas.
Highest quality, narrowest user base.

Gated on:

- `.moc3` write capability (reverse-engineered tooling becoming
  trustworthy). Tracks community work on moc3ingbird.
- Sufficient demand (telemetry showing >5% of users have PSD
  source on import).

Deferred from immediate roadmap. Tracking only.

## Sequencing rationale

Why this order:

- **Phase 1 first** because it's pure debt + ships fastest. No new
  abstractions, lowest risk, immediate quality wins.
- **Phase 2 next** because the tint path is high-value for low
  cost AND it establishes the semantic-group infrastructure that
  Phase 3 depends on.
- **Phase 3 after Phase 2** because the AI orchestrator can't
  operate without semantic groups defined.
- **Phase 4 gated on spike** because UV back-projection has
  technical unknowns that could compress what we deliver. Don't
  commit time until the spike succeeds.
- **Phase 5 deferred** because `.moc3` write is community-RE work
  with reliability unknowns. Reassess quarterly.

## Cross-phase commitments

These apply to every phase:

1. **Backward compatibility.** No phase breaks existing puppet
   files / IDB / saved sessions. Migrations are one-way; old data
   continues to work.
2. **Per-layer pipeline stays as the primitive.** Every phase that
   does AI work eventually calls into `submitGenerate` +
   `setLayerTextureOverride`. The orchestrator is a layer above,
   not a replacement.
3. **Provenance is mandatory.** Every edit, regardless of phase,
   writes to `editProvenance`. This is the user's audit trail.
4. **Lock flags are honoured.** No phase, no orchestrator, no
   AI path edits a drawable with `groupLocked = true`.
5. **Animation eval before commit.** Every phase's edits get
   rendered at parameter extremes before the user can save the
   variant. Bad seams catch here, not in production.

## Risk register

| Risk | Phase | Mitigation |
|---|---|---|
| Classifier accuracy too low on non-standard models | 2 | Review modal on import; user override always available |
| Tint math fails on multi-color source (gradient hair) | 2 | Histogram-aware multiplier; fall back to per-pixel hue shift |
| Sequential AI drift accumulates across N calls | 3 | Re-anchor every 4 calls; allow user to nominate a different anchor |
| Cost per session escalates with multi-group intents | 3 | Default cap at 30 calls per session; warn user beyond |
| UV back-projection fails on rotated islands | 4 | Spike validates this exact case first |
| Foundation model API changes (gpt-image-2 → -3) | All | Provider abstraction at `lib/ai/providers/` already isolates this |
| Cultural backlash from artists | All | Provenance markers + lock flags + opt-in defaults |

## Sequencing decision points

After each phase ships, before starting the next:

- **Did the previous phase ship the success criteria?** If not,
  hold and iterate rather than stacking on broken foundations.
- **Did we learn anything that changes the next phase's design?**
  Update the corresponding doc in this folder; don't let plans
  drift.
- **Is the team's appetite still aligned with the original
  vision?** If user research shows people want something
  different, replan instead of executing inertia.

Decision points are explicit; phases aren't a treadmill.
