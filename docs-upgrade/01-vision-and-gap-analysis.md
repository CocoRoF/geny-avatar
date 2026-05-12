# 01 — Vision and Gap Analysis

## The vision in one sentence

> A user opens any Live2D puppet, types **"give her red hair and a school
> uniform"**, and the editor returns a coherent, atlas-edited model
> within a minute — character identity preserved, animation integrity
> preserved, every related drawable consistently updated.

That's the bar. Everything else is sub-goal.

## What "coherent" means

Concretely the model has to satisfy four constraints simultaneously:

1. **Cross-part visual coherence.** A character's "hair" in a typical
   anime VTuber model is 12–25 distinct drawables (front bangs, side
   hair L/R, back hair, ahoge, hair shadow on face, hair highlights,
   hair accessories — see [03-live2d-anatomy](03-live2d-anatomy.md)
   §1). When the user asks for red hair, every one of those drawables
   has to receive a matching red — same hue, same shading direction,
   same gloss highlights. Today the user has to regenerate each part
   independently and pray for consistency.

2. **Character identity preservation.** The face, body proportions,
   eye shape, and any features the user *didn't* ask to change must
   come back recognisably the same person. A "hair recolor" that
   subtly redraws the face is a failure even if the hair is perfect.

3. **Animation integrity.** Cubism deforms drawables by parameter
   (head turn, hair sway, eye blink) every frame. The edited atlas
   must look correct at *every* parameter combination, not just the
   rest pose. UV islands are static; what gets painted into a UV
   island must respect the island's silhouette and its rendering
   context (clip masks, multipliers, blend mode).

4. **Reversibility.** Any edit must be undoable, comparable to the
   pre-edit state, and discardable per-part without re-running the
   whole job.

## Where we are today

The editor as shipped at v0.3.x covers a slice of this:

| Capability | State | Where in the code |
|---|---|---|
| Per-layer texture edit via gpt-image-2 | ✅ Shipped | [`GeneratePanel.tsx`](../components/GeneratePanel.tsx) |
| Per-layer mask paint (DecomposeStudio) | ✅ Shipped | [`DecomposeStudio.tsx`](../components/DecomposeStudio.tsx) |
| Per-layer paint (direct pixel paint) | ✅ Shipped | DecomposeStudio Paint mode |
| Multi-island auto-detection + per-island prompts within one layer | ✅ Shipped | [`connectedComponents.ts`](../lib/avatar/connectedComponents.ts) |
| Manual region painting in split mode | ✅ Shipped | DecomposeStudio Split + `useRegionMasks` |
| Reference-image attachment for style anchor | ✅ Shipped | `useReferences` + multi-image gpt-image-2 |
| Prompt refinement via chat model | ✅ Shipped | `/api/ai/refine-prompt` |
| Per-layer history (save → revert → apply) | ✅ Shipped | `useHistory` (decompose) + AI jobs in IDB |
| Undo/redo within a single mask/paint session | ✅ Shipped | `useHistory` hook |
| Atlas-bake on save (texture override → atlas page) | ✅ Shipped | [`applyOverrides.ts`](../lib/adapters/applyOverrides.ts) |
| **Cross-part coherent edit** (the headline feature) | ❌ Missing | — |
| **Semantic part grouping** (what is "hair") | ❌ Missing | — |
| **Whole-character intent** ("give her a school uniform") | ❌ Missing | — |
| **Pose-aware rendering for AI input** | ❌ Missing | — |
| **Tint fast-path** (multiplyColor without AI) | ❌ Missing | — |

The current model assumes the user is *the artist deciding which
atlas region to edit*. The vision assumes the user is *the
commissioner describing the result they want* — geny-avatar should
figure out which regions that implies.

## The gap, in four problem statements

### Problem 1 — There is no "hair" in our domain model.

Cubism gives us drawables and parts; geny-avatar lifts them into
Layers; gpt-image-2 sees a rectangular crop of an atlas page. None
of those layers know about each other. There is no representation
for "these 18 drawables together constitute a hair group", and the
UI has no way to address that group. Adding it requires:

- A classifier (rule-based + embedding-based fallback) to bucket
  drawables into semantic groups at import time.
- A persisted `semanticGroup` field on layers, editable by the user
  when the classifier is wrong.
- UI surfaces that operate on groups.

### Problem 2 — Independent generation produces independent results.

Even when the user knows which 18 drawables are hair, the current
pipeline can only generate each one in isolation. Each call to
gpt-image-2 sees only that drawable's rectangle. The shading
direction, gloss highlights, and hue chosen for the front bangs
have no way to coordinate with the back hair. Reference images
help but only weakly: they bias the model toward a style, they
don't enforce specific RGB consistency.

To fix this, we need one of:

- **Unified-render generation** — composite all hair drawables into
  one off-screen "hair sheet", generate once, slice back to atlas
  islands. Strictly better for consistency, but requires
  rotation-aware packing and UV-aware un-packing.
- **Sequential conditioning** — generate hair-front first, use the
  result as a hard reference for subsequent hair-* calls. Same idea
  as IP-Adapter but with N rounds.
- **Tint-only path** — if the request is purely chromatic ("make hair
  red"), skip AI and write `multiplyColor` per drawable, which is
  guaranteed-consistent and free.

### Problem 3 — Whole-character intents have no entry point.

"Give her a school uniform" requires:

1. Identifying which groups change: top, bottom, accessories
   (collar/tie/socks/shoes), and possibly hair-accessory.
2. Generating consistent texture variants for each.
3. Possibly *removing* drawables that don't belong (existing skirt
   if uniform has pants).
4. Possibly *adding* drawables (necktie if uniform has one).

Steps 3 and 4 require mesh-level edits that Cubism's atlas-only
editing path explicitly forbids unless we have the `.cmo3` source.
For runtime-only models we can hide drawables (`partOpacityOverrides`)
and re-purpose existing ones, but additions are impossible without
the editor. **Scope decision:** v2 only does what's possible with
atlas-only access. Mesh edits are a separate v3+ track.

### Problem 4 — The AI can't see the character; only crops of its atlas.

gpt-image-2 sees `[image 1]` = a layer's atlas rectangle. It does
NOT see the rendered character. So when the prompt is "her face
matches her hair colour" the model has no idea what the face looks
like. The reference-image ride-along helps but is brittle: refs are
limited to 4 in gpt-image-2's `image[]` array, they pollute the
conditioning equally regardless of which slot is being edited, and
the model often confuses which ref belongs to which slot.

A better setup: **render the puppet at canonical pose**, send that
rendered image as `[image 1]` alongside a mask covering the edit
region. The model sees the whole character + knows where to edit.
Output is then UV-back-projected into atlas pages. This is the
"projection paint" / Substance-Painter pattern applied to 2D
rigged puppets. Doable, technically non-trivial.

## Out of scope (for this docs folder)

- **Audio/voice features.** Lipsync, TTS, voice clone. Geny owns that.
- **Animation authoring.** Motions, expressions, hit areas. Already
  designed in `docs/plan/09_editor_animation_tab.md`.
- **Model import enhancements** unrelated to editing (e.g., better
  Spine import). Tracked in main `docs/plan/`.
- **Account / billing / sharing.** This folder is purely about
  editing power.

## North-star metric

A success looks like: a non-artist user picks a Live2D model they
downloaded from BOOTH, types one sentence, gets a coherent
recoloured / re-clothed character in under 90 seconds, and the
result holds up under face-tracking deformation (head turn,
blink, hair sway) without visible seams or palette drift.

We measure this with the eval pipeline in
[13-failure-modes-and-eval](13-failure-modes-and-eval.md).
