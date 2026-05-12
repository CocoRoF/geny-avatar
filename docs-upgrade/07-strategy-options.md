# 07 — Strategy Options

Five distinct architectural approaches to delivering the
[01-vision](01-vision-and-gap-analysis.md). Each is described with
its core idea, what it enables, what it doesn't, and a verdict.

The point of this doc is to make the trade-offs explicit before
committing in [08-recommended-architecture](08-recommended-architecture.md).
The reader should be able to disagree with the recommendation by
pointing at one of the options below.

## Option 1 — "Better single-layer" (incremental)

**Core idea:** keep the per-layer editing model. Improve the
per-layer experience. No semantic groups, no cross-layer
coordination beyond what already exists (references).

Concrete improvements:

- Mask erosion before sending to gpt-image-2 (4–8 px) to prevent
  seam contamination.
- Better prompt refinement with explicit Cubism-aware language
  ("this is one drawable of a layered 2D rigged puppet").
- Add FLUX.2 Edit as a second provider for cost-sensitive bulk.
- Show better progress UI for multi-region within-layer flows.

**What it enables**: marginal quality improvements. Faster bulk
edits via FLUX. Lower seam artifact rate.

**What it doesn't enable**: cross-layer coherence. The user still
opens 20 panels to recolor 20 hair drawables. No "change hair
color" intent.

**Cost**: 2–3 weeks of focused work. No data model change. No new
UI surfaces. Compatible with all current users.

**Verdict**: necessary but insufficient. Captures the easy wins
without addressing the headline gap. **Include as Phase 1 of the
roadmap; don't commit the whole upgrade to this.**

## Option 2 — "Semantic groups + tint-only" (groups light)

**Core idea:** introduce semantic groups (hair / face / top /
bottom / accessory / etc.) but only operate on them via the tint
fast path (multiplyColor). No AI changes per-group; AI still
happens at the layer level as today.

Concrete additions:

- Classifier runs at import: tags each drawable with semantic
  group. User can override.
- New UI surface: "Groups" tab in the layers panel. Each group
  has a color swatch, opacity slider, tint sliders.
- Tint applies as `multiplyColor` on every member drawable.
- "Lock group" flag prevents accidental layer edits.

**What it enables**:

- Chromatic edits are instant, free, animation-safe. "Make hair
  red" is one slider drag.
- The semantic group concept exists, ready for AI extensions.
- Per-group "lock" gives artist-control / opt-out for users
  worried about AI bleed.

**What it doesn't enable**: material changes (cotton → leather),
adding/removing gloss highlights, shading direction changes. All
require AI.

**Cost**: 4–6 weeks. Schema change (add `semanticGroup` to
layers + groups table). Classifier implementation. Tint UI.

**Verdict**: huge win for low engineering cost. The tint path
covers ~60% of casual user intents (recolors). Should ship as
Phase 2.

## Option 3 — "Sequential reference chaining" (groups + AI)

**Core idea**: Option 2 + use the semantic groups to orchestrate
sequential AI generation. For non-tint group-level intents
(material change, style change), generate drawables one at a time
in the group, each subsequent call seeing prior outputs as
references.

Concrete additions on top of Option 2:

- Group-level "Generate with AI" button.
- Orchestrator picks generation order (largest/most-visible
  drawable first).
- After each successful generation, the result joins the reference
  list for subsequent calls in the same group.
- Palette extraction from the first ("anchor") result: dominant
  colors as additional prompt context.
- Progress UI showing each drawable's status in the group.

**What it enables**:

- "Change hair to wet leather" works coherently across all hair
  drawables.
- "Give her a school uniform" can run top/bottom/accessory groups
  sequentially with shared style anchor.
- The user expresses high-level intent; orchestrator translates to
  N per-drawable calls.

**What it doesn't enable**:

- True one-shot consistency (sequential drift is still possible).
- Adding/removing drawables (mesh edits).
- "Render the whole character at canonical pose and edit there"
  approaches.

**Cost**: 6–9 weeks on top of Option 2. New orchestrator service.
Heavier eval needed (sequential edits have more failure modes).

**Verdict**: this is the headline upgrade. Should ship as Phase 3,
right after Phase 2 (semantic groups + tint).

## Option 4 — "Render-and-project" (full character intent)

**Core idea**: render the puppet at canonical pose to a single
image. Send that image + a mask to AI. Back-project the AI output
to atlas pages via UV mapping. The AI sees the whole character
and edits it as one image; we slice the result back to atlas.

Concrete additions on top of Option 3:

- Canonical-pose renderer (we already have this — pixi-live2d-
  display renders the model at rest).
- UV back-projection: for every output pixel, find which triangle
  it belongs to (using the drawable's mesh), look up the
  drawable's atlas page + position, paint the back-projected
  pixel.
- Group mask generation: union of all member drawables' clip
  paths in image space.
- Composition: applies as a `layerTextureOverride` to each
  affected drawable simultaneously.

**What it enables**:

- The AI sees the character, not just an atlas crop. Vastly better
  spatial context.
- "Give her a uniform" can be one AI call (the model paints the
  full character with the new outfit) and we back-project to all
  affected drawables.
- Effectively solves cross-part consistency by construction.

**What it doesn't enable**:

- Mesh edits (still atlas-only).
- Edits at extreme parameter values (rendering is at canonical
  pose; deformations at extremes may show artifacts).
- Cross-atlas-page edits when drawables overlap in image space —
  back-projection needs disambiguation rules.

**Cost**: 8–12 weeks. UV back-projection is the unsolved
technical work — pixel → triangle → atlas-rect mapping with
rotation + padding awareness. Reference: Substance Painter
projection paint, but for a 2D rigged puppet not a 3D mesh.

**Verdict**: this is the strategic differentiator. Nobody has
shipped this for Live2D. Should be Phase 4. The risk: technical
unknowns may compress what we deliver. Need a spike before
committing.

## Option 5 — "Project from PSD source" (premium tier)

**Core idea**: when the user uploads the model's PSD source (or
`.cmo3`), edit at the PSD layer level (where there's no atlas
packing) and re-bake the atlas afterward.

This is the workflow that paid VTuber commission artists use today
when they own the model's source.

Concrete additions:

- PSD parser (psd.js or similar) to lift layers into our domain.
- Layer-to-drawable mapping (Cubism Editor's PSD layer name = mesh
  ID convention).
- Atlas re-bake: pack edited layers back into a fresh atlas page.
- `.moc3` UV rewrite to match new atlas positions [VERY HARD —
  closed format, need OpenL2D/moc3ingbird-style write capability
  which doesn't exist].

**What it enables**:

- Strictly best quality. AI edits at source resolution before atlas
  packing kicks in. No rotation, padding, or fragmentation.
- Mesh additions / removals possible at PSD level if we can write
  back to `.cmo3`.

**What it doesn't enable**:

- Anything for users with runtime-only models (most users).
- Trust: `.moc3` write capability is community-reverse-engineered.
  Breakage probability per model is non-trivial.

**Cost**: 12+ weeks. Most of the cost is the `.moc3` round-trip,
which may not be achievable safely.

**Verdict**: low priority. v4+ feature gated on whether
`.moc3` round-trip becomes reliable. Most users don't have PSD
source so this serves a narrow slice. Keep on the strategic map
but don't commit until other tracks land.

## Trade-off matrix

| | Op1 | Op2 | Op3 | Op4 | Op5 |
|---|---|---|---|---|---|
| Cross-part coherent edits | ❌ | ✅ tint only | ✅ AI w/ chain | ✅✅ unified | ✅✅✅ source |
| Whole-character intent | ❌ | partial | ✅ | ✅✅ | ✅✅✅ |
| Animation-safe by construction | ✅ | ✅ | mostly | mostly | ✅✅ |
| Cost per session | Low | Lower | High | Mid | Lower |
| Latency per session | Low | Instant tint | High | Mid | Mid |
| Engineering weeks | 2–3 | 4–6 | 6–9 | 8–12 | 12+ |
| Risk | Low | Low | Medium | High | Very high |
| Adds new abstractions | None | Groups | Groups+orch | Groups+proj | Groups+PSD |
| User base served | Existing | All | All | All | Premium |

## Why not just pick one?

Each option is best at something the others aren't. The right
strategy is to **layer them in order**, with each phase paying for
itself before the next is approved. The phasing is laid out
concretely in [09-phased-roadmap](09-phased-roadmap.md):

- **Phase 1** = Option 1 (incremental). Ships in weeks. No risk.
- **Phase 2** = Option 2 (groups + tint). Ships in 1-2 months.
  Headline feature for the casual tier.
- **Phase 3** = Option 3 (sequential AI). Ships in 2-3 months
  after Phase 2. The "ship it" moment for power features.
- **Phase 4** = Option 4 (render-and-project). v3+. Strategic
  bet; requires technical spike to commit.
- **Phase 5** = Option 5 (PSD path). v4+. Premium tier; ships if
  `.moc3` round-trip becomes safe.

The recommendation in [08-recommended-architecture](08-recommended-architecture.md)
selects this phasing and freezes the architectural commitments at
each step.

## What we explicitly reject

- **Train a custom Live2D-specific image model.** Cost-prohibitive,
  fine-tuning is hard, doesn't generalise across artists' styles.
  Better to lean on foundation model improvements.
- **Force users into a templated topology like VRoid.** Loses the
  diversity of BOOTH-uploaded characters. Wrong fit for the
  problem we're solving.
- **Bypass Live2D entirely (Viggle-style).** Different product;
  not an extension of geny-avatar.
- **Real-time AI editing as the user types.** Even FLUX.2 Schnell
  is 2s/image; full character render-and-edit is 10s+. Streaming
  preview is impractical, batch confirmation is the right UX.
