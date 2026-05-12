# 08 — Recommended Architecture

The strategic answer to [01-vision](01-vision-and-gap-analysis.md),
constrained by [03-live2d-anatomy](03-live2d-anatomy.md) and
[04-multipart-problem](04-multipart-problem.md), informed by
[05-ai-stack-survey](05-ai-stack-survey.md) and
[06-comparable-tools](06-comparable-tools.md), chosen out of
[07-strategy-options](07-strategy-options.md).

**The architecture in one sentence:** introduce a *semantic group*
layer above existing drawables, a *tint-first* execution path,
and a *sequential-conditioning AI orchestrator* for non-tint
edits — keeping the existing per-layer machinery as the low-level
primitive that the new orchestrator drives.

We do this in four phases (see [09-phased-roadmap](09-phased-roadmap.md))
each of which delivers user-facing value before the next.

## The new layered architecture

```
              ┌─────────────────────────────────────────┐
              │  Intent layer (user types one sentence)  │
              │  • prompt parser (chat-LLM pre-pass)     │
              │  • intent classifier:                    │
              │    tint | ai-region | ai-multipart       │
              └─────────────────────────────────────────┘
                                │
                                ▼
              ┌─────────────────────────────────────────┐
              │  Group layer (NEW — Phase 2)             │
              │  • semanticGroup per drawable            │
              │  • {hair, face, eyes, mouth, top,        │
              │     bottom, accessory, other}            │
              │  • user-editable; classifier seeded      │
              └─────────────────────────────────────────┘
                                │
                ┌───────────────┴─────────────────┐
                ▼                                 ▼
   ┌─────────────────────┐         ┌─────────────────────────┐
   │  Tint path           │         │  Generate path           │
   │  (Phase 2)           │         │  (Phase 3)               │
   │  • multiplyColor     │         │  • orchestrator picks    │
   │    per drawable      │         │    canonical drawable    │
   │  • instant + free    │         │  • sequential refs       │
   │  • reversible        │         │  • palette anchor        │
   └─────────────────────┘         │  • per-drawable gen call │
                                   └─────────────────────────┘
                                                │
                                                ▼
   ┌───────────────────────────────────────────────────────┐
   │  Per-layer pipeline (EXISTING — unchanged)             │
   │  GeneratePanel · gpt-image-2 · postprocessGenerated    │
   │  · applyLayerOverrides · atlas page composite           │
   └───────────────────────────────────────────────────────┘
```

The bottom layer is what we have today. **It does not change.**
The new value is built above it. This keeps risk bounded and lets
each phase ship independently.

## The semantic group model

A new domain concept, persisted alongside `layers`:

```ts
type SemanticGroup =
  | "hair_front"
  | "hair_side"
  | "hair_back"
  | "hair_accessory"
  | "face_skin"
  | "face_blush"
  | "eyes"
  | "eyebrows"
  | "mouth"
  | "ears"
  | "neck"
  | "body"
  | "top"           // shirt/jacket/blouse
  | "bottom"        // skirt/pants
  | "footwear"
  | "accessory"
  | "background"
  | "other"

type Layer = {
  // ... existing fields
  semanticGroup?: SemanticGroup       // NEW
  groupConfidence?: number             // 0..1 classifier confidence
  groupSource?: "classifier" | "user"  // who set it
  groupLocked?: boolean                // user-flagged "leave alone"
}
```

Three group sources:

1. **Classifier** (Phase 2): rule + embedding hybrid that runs at
   import. Reads parameter bindings (parts driven by `ParamHair*`
   → hair), parent-deformer names (with localized name patterns
   for JP/CN/EN), and CLIP-style embedding of the atlas crop
   matched against a labeled fixture set (Hiyori, Mao Pro, etc.).
2. **User override**: UI surface in LayersPanel lets the user
   reassign any drawable. Common case: the classifier mis-labels
   "hair_accessory" (e.g. a ribbon) as "accessory". User
   reassigns to "hair_accessory" and the next "change hair color"
   intent picks it up.
3. **Locked**: a per-drawable flag that excludes the drawable from
   group-level operations. The artist-respect lever — addresses
   the cultural concern about "AI bleed into hand-painted parts".

## The intent layer

A new entry point: a single text input where the user describes
the change in plain language. The flow:

```
"change her hair color to red"
        │
        ▼
  chat-LLM parse
        │
        ▼
  { intent: "tint",
    target_groups: ["hair_front","hair_side","hair_back","hair_accessory"],
    tint_params: { hue: 0, saturation: 0.85, value: 0.5 } }
        │
        ▼
  execute tint path
        │
        ▼
  preview + commit
```

Same flow for non-tint:

```
"give her a school uniform"
        │
        ▼
  chat-LLM parse
        │
        ▼
  { intent: "ai-multipart",
    target_groups: ["top","bottom","accessory"],
    style_prompt: "Japanese schoolgirl uniform, navy blazer over
                   white sailor blouse, red ribbon, pleated dark
                   blue skirt with subtle plaid",
    style_anchor_image: <generated reference> }
        │
        ▼
  execute orchestrator (sequential per drawable in group order)
        │
        ▼
  preview, per-group accept/reject, commit
```

The intent layer is the surface that turns "what the user wants"
into "what drawables get touched, how".

## The tint path (Phase 2)

For chromatic intents, generation is bypassed entirely:

```ts
function applyTint(groups: SemanticGroup[], hsv: {h, s, v}) {
  for (const layer of allLayers) {
    if (!groups.includes(layer.semanticGroup)) continue
    if (layer.groupLocked) continue
    // Convert HSV to multiplyColor / screenColor.
    const { multiply, screen } = hsvToTint(hsv, layer.baselineHsv)
    adapter.setMultiplyColor(layer.partIndex, multiply)
    adapter.setScreenColor(layer.partIndex, screen)
  }
}
```

`adapter.setMultiplyColor` is a thin Cubism API call. It writes
to the drawable's per-frame multiplier; the engine's render loop
honours it automatically. Reversal: write `(1,1,1)` back.

The HSV-to-multiplyColor math is non-trivial because multiplyColor
shifts the entire texture, including non-target hues. To pin "make
hair red" without recoloring black hair shadows, we sample the
drawable's pixel histogram (once at import, cached) and compute the
multiply that maps the dominant hue to the target hue while
preserving relative HSV of other pixels. [VERIFY] — needs prototype
testing.

## The generate orchestrator (Phase 3)

The orchestrator turns "regenerate this group with style X" into a
sequence of per-drawable calls:

```
orchestrate(group, style):
  1. Rank drawables in group by visual prominence:
     - largest UV area first
     - face-relative position (front > side > back)
     - parameter binding (drawables on motion-key params first)
  2. anchor = drawables[0]
  3. Generate anchor:
     - call gpt-image-2 with the style prompt + the puppet's
       canonical-pose render as image[2]
     - postprocess (alpha-enforce to drawable's clip path)
     - extract dominant palette (k-means, 5 colors)
  4. For each subsequent drawable in group:
     - call gpt-image-2 with:
       image[1] = drawable crop
       image[2] = canonical-pose puppet
       image[3] = anchor result
       image[4] = optional: most recent prior drawable result
       prompt = style + "match palette to [image 3]: " + palette
     - postprocess + emit
  5. Compose all results into layerTextureOverrides
  6. Surface preview to user
```

Rotation, padding, alpha-clip all handled by the existing per-layer
pipeline. The orchestrator's job is **selecting the right anchor,
threading the right references, and gating quality**.

## The canonical-pose render

A new artifact: a single PNG of the puppet at rest, full character
visible. Generated once per session, cached. Used as the
"spatial context" reference in every AI call.

```ts
function renderCanonicalPose(adapter: AvatarAdapter): Promise<Blob> {
  // The adapter renders to a hidden Pixi canvas at full resolution,
  // with all parameters at default, all parts visible, current
  // layerOverrides applied (so the user sees the WIP state, not
  // pristine).
  const canvas = adapter.renderToCanvas({ width: 1024 })
  return canvasToBlob(canvas)
}
```

This is `image[2]` in every generate call. The model sees the
character; even when editing a single drawable, it knows what
that drawable is part of.

[VERIFY] — Pixi-live2d-display can render to an off-screen canvas;
the existing thumbnail pipeline uses this trick. Should be a small
adaptation.

## The lock semantics

Three levels of "leave alone":

1. **Layer-level**: `layer.bakedHidden` — drawable is hidden in
   the final export. Already exists.
2. **Group-level**: `group.locked` — group-level operations skip
   members. New flag.
3. **Drawable-level lock**: `layer.groupLocked` — even when group
   is "active", this specific drawable is skipped. New flag.

The cultural payoff: artists who want to combine hand-painted
parts with AI-generated parts can lock the hand-painted ones and
trust the editor not to touch them. Audit log shows which pixels
came from where.

## Provenance tracking

A new artifact written on every edit:

```ts
type EditProvenance = {
  layerId: LayerId
  generation: number                  // monotonic counter per layer
  source: "ai" | "user-paint" | "user-mask" | "tint" | "original"
  model?: ProviderId                  // when source === "ai"
  prompt?: string                     // when source === "ai"
  timestamp: number
  parentGeneration?: number           // for redo chains
}
```

Persisted in IDB alongside `layerOverrides`. UI surfaces this as a
small icon per layer in the LayersPanel ("AI" badge, hand-paint
badge, tint badge). Exports include the provenance log as a JSON
sidecar so downstream tools / artists can audit.

## Compatibility commitments

This architecture is strictly additive:

- **No existing field type changes.** New fields are nullable
  additions.
- **No existing API breaks.** GeneratePanel, DecomposeStudio, the
  AI provider scaffold all work unchanged.
- **No IDB schema reset.** New tables (`semanticGroups`,
  `editProvenance`) are introduced; existing tables (`puppets`,
  `layerOverrides`, etc.) are unchanged.
- **No new runtime dependencies on the per-layer pipeline.** The
  orchestrator calls the same `submitGenerate` + `setLayerTextureOverride`
  flow that GeneratePanel uses today.

Migration on first open of an existing puppet: classify groups,
seed defaults, prompt user to review groups in a one-time modal.

## What this commits us to

By picking this architecture we're choosing:

- ✅ **Semantic groups are real domain objects.** They get a
  classifier, an IDB table, a UI surface.
- ✅ **Tint is the default for chromatic intents.** Both faster
  and safer than AI.
- ✅ **Sequential reference chaining is the AI path for groups.**
  No experimental UV-space methods in v1/v2.
- ✅ **The user expresses intent in one sentence.** Per-layer
  GeneratePanel remains for power users but is no longer the
  primary entry point.
- ✅ **Per-drawable lock semantics are first-class.** Artist
  respect / cultural concern, baked into the data model.
- ✅ **Provenance is tracked from day one.** Every pixel knows
  where it came from.

What we're NOT committing to:

- ❌ Render-and-back-project (Architecture C from
  [04-multipart-problem](04-multipart-problem.md)). Strategic
  aspiration for v3+; gated on technical spike.
- ❌ PSD round-trip path. v4+ on a separate track.
- ❌ Custom Live2D-specific fine-tuned model. Foundation models
  are sufficient; cost prohibitive otherwise.
- ❌ Real-time streaming preview. Batch confirmation is the right
  UX given latency.

## Open questions

- **[OPEN]** How aggressive should the classifier be? Default
  group assignment vs always-show-modal for review.
- **[OPEN]** When a user creates a new "group" (e.g. "left arm
  tattoo"), how is it persisted across sessions vs across
  puppets? Per-puppet only seems right but needs UX review.
- **[OPEN]** Should the canonical-pose render be regenerated on
  every edit, or once per session? Trade-off: stale anchor vs
  generation cost.
- **[OPEN]** Tint math for non-grayscale source pixels. Worst case
  is HSV shift on a multi-color hair (gradient hair). Needs a
  prototype to validate that `multiplyColor` alone is enough or
  whether we need an `applyHueShift` shader hook.
