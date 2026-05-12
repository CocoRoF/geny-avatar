# 04 — The Multi-Part Problem

This doc isolates the single technical problem that drives the rest
of the upgrade: how to edit textures cohesively across multiple
drawables that share a semantic identity.

If 03 covered "what Cubism gives us", this doc covers "why what
Cubism gives us makes our job hard."

## The shape of the problem, restated

A typical anime Live2D model has **~100 drawables**. They cluster
semantically:

```
face skin (5)   eyes (18)   mouth (12)   hair (20)   body (8)
   ↑              ↑            ↑           ↑          ↑
   |              |            |           |          |
clothes-top (15)   clothes-bottom (10)   accessories (8)   props (4)
```

Each drawable owns a rectangle on one of the 1–2 atlas pages. Most
artists draw a character with a consistent palette: the hair at
3 o'clock matches the hair at 9 o'clock, the front bangs gradient
matches the back hair gradient.

When the user types **"change her hair color to red"**, the
following has to happen:

1. **All 20 hair drawables identified** as "hair" (not face,
   eyes, etc.).
2. **All 20 atlas rectangles regenerated** with a coherent red.
3. The regenerated regions **must agree on**:
   - Base hue (e.g. all of them in the same 350-360° red range)
   - Saturation level
   - Value (lightness) distribution
   - Shading direction (light from upper-left, say)
   - Gloss highlight intensity and color
4. The character's identity outside hair is **preserved exactly**:
   eyes, mouth, face shape, body, clothes — unchanged.
5. The edit holds up under animation: head turning, hair physics
   swaying, blinking.

Today the user has to do this **manually** by opening 20 separate
GeneratePanel sessions and praying the model picks the same red
each time. It rarely does.

## Why independent generation fails

Each call to gpt-image-2 (or any image-edit model) sees one atlas
crop in isolation. From the model's perspective:

- For hair-front: "a curtain of brown anime hair, redraw red"
- For hair-side-L: "a strand of brown anime hair, redraw red"
- For hair-back: "a flat plate of brown anime hair, redraw red"

The model picks "a red" each time. Each red is plausible. Each red
is *different*. Hue drift of ~10° between calls is common; saturation
drift of ~15%; value drift of ~10%. Composed into the final atlas,
the 20 hair islands form a patchwork of slightly-different reds,
visible to the eye as inconsistent shading.

Reference images help a little. Sending the user's character
reference as `image[2]` biases the model toward the character's
shading style — but the model treats it as a weak hint, not a hard
constraint, and it can't tell which red in the reference applies to
*this specific drawable*.

## Why simply concatenating prompts is not enough

The naive workaround is to enumerate everything in a single prompt:

```
For each of the 20 hair drawables of this character: redraw with
red (#C8202E), keep gloss highlights at upper-left, keep gradient
from #C8202E at root to #F44336 at tip, preserve line weight.
```

This makes the model less inconsistent but doesn't fix the
fundamental problem: each *generation call* still only sees one
drawable's crop. The model can't validate that the red it just
produced matches the red on the same character's other parts —
because those other parts aren't in the image[1].

Sending all 20 references doesn't work either: gpt-image-2's `image[]`
array maxes at ~4 ride-along refs; even FLUX.2 caps at 10
(<https://fal.ai/models/fal-ai/flux-2/edit>). A 20-hair-drawable
character can't fit them all.

## The three viable architectures

There are exactly three architecturally-distinct ways to solve
multi-part cohesion:

### Architecture A — Tint-only (the cheap path)

For chromatic-only requests, **don't generate at all**. Set the
`multiplyColor` field on every hair-classified drawable to the
target red:

```ts
for (const layer of hairLayers) {
  drawable.multiplyColor = { r: 0.78, g: 0.13, b: 0.18 }
}
```

The atlas is unchanged. Runtime shader does the multiply at sample
time. Result:

- **Guaranteed consistent** across all 20 drawables (same value).
- **Animation-safe** by construction (parameters don't touch
  multiplyColor).
- **Reversible** instantly (delete the override).
- **Free** (no API call).
- **Preview-instant** (just a uniform update).

Cost: limited expressive range. Can shift hue/saturation/value but
can't:
- Add new gloss highlights that don't exist in the original.
- Change shading direction.
- Change hair from one art style to another.

**This is the right default for any prompt that parses as "tint X
color N".** UI offers AI generation as an explicit upgrade for
non-tint intents.

### Architecture B — Sequential reference chaining

For non-tint AI edits, generate parts **one at a time, in identity
chain**:

```
1. Pick the most visible / canonical drawable (usually hair-front).
2. Generate red hair-front with full quality. Result = R0.
3. Pick hair-side-L. Generate with R0 as image[2] reference.
   Result = R1.
4. Pick hair-side-R. Generate with R0 and R1 as image[2, 3].
5. Continue for all 20 hair drawables.
```

This is the documented industrial-practitioner pattern (see the AI
stack survey, [05-ai-stack-survey](05-ai-stack-survey.md)). It
works because:

- Each subsequent generation sees concrete prior outputs as
  references, not just a style anchor.
- gpt-image-2's multi-image conditioning is strong enough to
  reproduce the same palette when it's in the `image[]` array.

Costs:
- **Slow**: 20 sequential API calls, ~10-30s each = 3-10 minutes
  for a full hair recolor.
- **Order-sensitive**: the "canonical" drawable choice matters. Pick
  hair-front first because it has the most visual area; the result
  becomes the palette anchor for the rest.
- **Reference budget**: after 4 prior outputs we hit the image[]
  cap. Need to rotate references (drop oldest) or composite a
  "palette card" from prior outputs.

This works without research-grade techniques. It is the **practical
default** for the production system.

### Architecture C — Unified sheet generation

Composite all 20 hair drawables into ONE off-screen image, generate
ONCE, slice back to atlas islands:

```
1. For each hair drawable, extract the upright atlas crop.
2. Lay them out on a single canvas with consistent orientation.
3. Run a single gpt-image-2 / FLUX.2 Edit call against this sheet.
4. Slice the result back to per-drawable crops.
5. Re-rotate islands as needed, write back to atlas.
```

This is structurally optimal — the model sees the whole group at
once and HAS to produce consistent results because they're all in
one image. Costs:

- **Layout problem.** How do you arrange 20 hair drawables on a
  sheet so the model understands they're parts of one hair?
  Naive grid loses spatial relationship. "Hair-front" goes top,
  "back hair" goes bottom only works if the model understands the
  convention.
- **Slicing problem.** Once the model returns, we have to find
  which output pixels correspond to which input island. Easiest
  with positional markers (small numbered tags), but those leak
  into the generation.
- **Rotation-aware projection.** Packed-rotated islands need
  per-island rotation in/out.
- **Resolution constraint.** Putting 20 islands at full resolution
  exceeds gpt-image-2's input size (3840px max edge). Must
  downsample, sacrificing detail.

A 2025-era refinement: **CartoonAlive-style multi-view consistent
diffusion** (CartoonAlive, MVPaint, RAD region-aware diffusion).
These solve the same problem with shared cross-attention across
parts. None deployed yet for VTuber pipelines. Research path, not
v1.

This is the **research-aspirational architecture**. It's what we
build toward; it's not what we ship first.

## Decision tree by request class

The architecture isn't binary — it's chosen per request:

```
User intent
   │
   ├─ Is it a tint? ──yes──► A (multiplyColor)
   │      │
   │      no
   │      │
   ├─ Is it a style change but bounded
   │  to a known semantic group? ──yes──► B (sequential reference chaining)
   │      │
   │      no
   │
   └─ Whole-character / cross-group change ──► C (sheet generation, v3+)
```

Intent classification happens in the chat-LLM pre-pass. The model
parses "change hair color" → tint, "make it look like wet leather"
→ AI-generate, "give her a school uniform" → multi-group AI-
generate.

## What "tint" means precisely

The tint fast-path is triggered when the parsed intent is a uniform
chromatic transform of an existing region. Concrete tests:

- "change hair color to red" → tint
- "make hair darker" → tint (value shift)
- "more saturated hair" → tint (saturation shift)
- "tinted hair" → tint
- "make hair look like wet leather" → NOT tint (material change)
- "add gold highlights to hair" → NOT tint (new pixels)
- "longer hair" → NOT tint (geometry change, also outside our scope)

The parser is a chat LLM call with a fixed schema response:

```json
{
  "intent": "tint" | "ai-edit" | "ai-multipart" | "mesh-edit-rejected",
  "target_groups": ["hair", "hair_accessory"],
  "tint_params": { "hue": 350, "saturation": 0.85, "value": 0.5 }
}
```

If the LLM returns "mesh-edit-rejected" the UI tells the user the
intent requires a re-rig and isn't supported on atlas-only models.

## Identity preservation — outside the group

Whatever architecture we pick for the target group, **non-target
drawables must not be touched**. The current per-layer pipeline
gives us this for free because each call writes to one specific
layer's atlas rect; no other layer's atlas changes.

But: in Architecture C (sheet generation), if we accidentally
include face/clothes drawables in the sheet, they get redrawn too.
The sheet must include *only* the semantic group's drawables.

Quick check, mandatory before every edit applies:

```
unchangedDrawables = allDrawables - targetGroupDrawables
for d in unchangedDrawables:
  assert drawable(d).pixels_in_atlas == originalPixels(d)
```

This is a free property of Architecture A and B (since they
explicitly don't touch non-target drawables) but must be tested
for Architecture C.

## What this doc commits us to

The architecture chosen in [08-recommended-architecture](08-recommended-architecture.md)
**MUST** address these constraints, in priority order:

1. Provide the **tint fast-path** for chromatic intents.
2. Provide **sequential reference chaining** for non-tint AI edits.
3. Leave **headroom for sheet-generation** as a v3+ aspiration but
   don't block it from the data model.

The per-layer pipeline isn't deprecated. It's reframed as the
**low-level primitive** that the new group-level orchestrator
calls into.
