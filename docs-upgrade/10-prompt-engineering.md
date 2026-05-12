# 10 — Prompt Engineering

How we turn user sentences into provider-ready prompts, references,
and structured tool calls. Feeds the intent layer from
[08-recommended-architecture](08-recommended-architecture.md) and
the orchestrator described in
[04-multipart-problem](04-multipart-problem.md) Architecture B.

The reader should leave this doc knowing exactly what string goes
out the wire on each call type and why.

## The two prompt surfaces

There are two distinct LLM surfaces and they must not be confused.

1. **Intent parser** — a chat-LLM (gpt-4o-mini class is enough)
   that turns a free-form user sentence into a structured
   `IntentRequest`. Cheap, fast, deterministic via JSON schema.
2. **Image-edit prompt** — the string passed to gpt-image-2 or
   FLUX.2 Edit. Long, literal, anchored to references. This is the
   string the editing model actually consumes.

The intent parser produces text that the image-edit prompt is
templated from. They are not the same. Mixing them — putting
JSON parse instructions in the edit prompt, or trying to do edit
guidance inside the parser — produces worse output on both axes.

## Intent parser — schema

```ts
type IntentRequest = {
  rawUserText: string
  intent:
    | "tint"
    | "ai-region"        // single-drawable AI edit
    | "ai-multipart"     // group-level AI edit
    | "compound"         // multiple intents in one sentence
    | "unsupported"      // out of scope (e.g. "make her dance")
  targetGroups: SemanticGroup[]   // empty if unsupported
  tintParams?: {                  // when intent === "tint"
    hue?: number          // 0..360
    saturation?: number   // 0..1 (delta multiplier)
    value?: number        // 0..1
    mode: "set" | "shift" // "make hair red" vs "darken hair"
  }
  stylePrompt?: string    // when intent has "ai-" prefix
  styleAnchorRef?: "auto" | "user-supplied"
  followups: string[]     // when "compound", split into sub-intents
  confidence: number      // 0..1, surface in UI if low
  rationale: string       // free text — why this classification
}
```

The schema ships as a Zod schema in `lib/ai/intent/schema.ts`
and is passed to the LLM via OpenAI's structured outputs feature
(or Gemini's equivalent). The model has no choice but to return
matching JSON — no parsing fragility.

## Intent parser — system prompt

```
You are the intent parser for geny-avatar, a Live2D character
editor. The user describes an edit they want in plain language.
Your job: classify the intent and extract structured parameters.

INTENT TYPES:
- "tint": pure color shift. Trigger words: "color", "red/blue/etc",
  "darker", "lighter", "fade". Examples:
    "change her hair color to red" → tint, hair_*
    "make the shirt blue" → tint, top
    "lighter eyes" → tint, eyes
- "ai-region": single-drawable AI edit not expressible as tint.
  Example: "add a beauty mark on her cheek" → ai-region, face_skin
- "ai-multipart": group-level non-tint edit. Material change,
  style change, garment swap.
    "change hair to wet leather" → ai-multipart, hair_*
    "give her a school uniform" → ai-multipart, top+bottom+accessory
- "compound": multiple intents in one sentence.
    "make hair red and give her glasses" → compound, splits into
    {tint, hair_*} + {ai-region, face_accessory}

GROUPS (use exactly these):
  hair_front, hair_side, hair_back, hair_accessory,
  face_skin, face_blush, eyes, eyebrows, mouth, ears,
  neck, body, top, bottom, footwear, accessory,
  background, other

NEVER:
- Invent groups not in the list.
- Set tintParams when intent is "ai-*".
- Set stylePrompt when intent is "tint".
- Classify mesh / rig / animation requests as anything other than
  "unsupported" (we don't change topology yet).

confidence < 0.6 if any field guessed. Always include a rationale.
```

Calibration test: ship a 50-prompt eval set, target ≥95% exact
match on intent + targetGroups across the set. See
[13-failure-modes-and-eval](13-failure-modes-and-eval.md).

## Image-edit prompt — template

For every gpt-image-2 / FLUX.2 Edit call, the prompt is built
from a template with these slots:

```
[CONTEXT]
This is one drawable from a multi-part Live2D rigged 2D character.
The drawable is part of a {semantic_group} group. The character is
visible in image[2] for spatial context.

[EDIT]
{style_prompt — from intent parser, possibly enriched}

[CONSTRAINTS]
- Keep the exact silhouette of image[1]. The renderer alpha-clips
  output to image[1]'s mask automatically — DO NOT redraw the
  outline shape; only change the interior content.
- Maintain the line weight and shading style of the original.
- Output anime/illustration style, NOT photoreal, NOT 3D.

[COMPOSITION]
{when sequential refs are present:}
This result will be composed with other drawables of the same
group. Match the palette in image[3] exactly:
  dominant colors: {palette_hex_list}
  gloss highlight: {highlight_description}
Same hue, same saturation, same gloss direction.
```

`{style_prompt}` is the user-facing style ask, expanded by the
parser. Example: user types "wet leather" → parser expands to
"wet leather hair, glossy black, sharp specular highlights,
realistic moisture droplets stylized for anime".

## Palette anchoring

The strongest cross-drawable coherence lever, used in Phase 3:

```ts
function extractPalette(imageBlob: Blob): Palette {
  // k-means(n=5) on the alpha-clipped result.
  // Returns ordered list of {hex, weight}.
}

function buildPaletteAnchor(palette: Palette): string {
  return palette.slice(0, 3)
    .map(c => `${c.hex} (${pct(c.weight)}%)`)
    .join(", ")
  // → "#5C3A1F (52%), #8B6B45 (28%), #2A1A0D (12%)"
}
```

Emitted in the prompt as:

```
Match the palette in image[3] exactly:
  dominant colors: #5C3A1F (52%), #8B6B45 (28%), #2A1A0D (12%)
  gloss highlight: top-left, white #FFFFFF, ~5% coverage
```

Why this works: gpt-image-2 honours hex codes loosely as
*direction*, not precision. Embedding hex codes biases the
output palette closer to the anchor's. Combined with the
anchor result attached as `image[3]`, the model has both
*visual* and *textual* palette anchors.

[VERIFY] — test on Hiyori hair: extract palette from front-hair
anchor, generate side-hair with palette anchor in prompt vs
without. Expect side-hair palette to shift toward anchor's by
≥30% (CIEDE2000 distance metric).

## Compound prompts — splitting

When the parser returns `"compound"`:

```ts
{ rawUserText: "make hair red and give her glasses",
  intent: "compound",
  followups: [
    "change her hair color to red",
    "add glasses",
  ],
  confidence: 0.88 }
```

The dispatcher recurses: each followup goes back to the parser as
its own request. Each gets its own intent type, target groups,
and execution path. Results are committed in parser-order to keep
the user's intent ordering preserved.

If a followup is `"unsupported"`, the user is shown a clear
message ("I can't do 'make her dance', but I'll handle the rest")
and the compound continues with the remaining followups.

## Tint prompt — none

The tint path has no LLM-driven prompt. The intent parser hands
back `tintParams` and the math runs deterministically:

```ts
applyTint(targetGroups, tintParams)
```

This is the entire reason the tint path is cheap and fast.
Putting a prompt on this would re-introduce the latency we
eliminated.

## AI-multipart prompt — orchestrated sequence

For a request like "give her a school uniform":

```ts
// Parser output
{ intent: "ai-multipart",
  targetGroups: ["top", "bottom", "accessory"],
  stylePrompt:
    "Japanese schoolgirl uniform, navy blazer over white sailor " +
    "blouse, red ribbon, pleated dark blue skirt with subtle plaid",
  ... }

// Orchestrator builds the call chain
const orderedDrawables = rankByVisualProminence(
  layersInGroups(targetGroups)
)
const anchor = orderedDrawables[0]

// Anchor call: full style prompt, no palette anchor yet
generate({
  layer: anchor,
  prompt: template({
    semantic_group: anchor.semanticGroup,
    style_prompt: stylePrompt,
    sequential_refs: false,
  }),
  references: [/* image[1]=crop, image[2]=puppet */],
})
// → anchorResult

const palette = extractPalette(anchorResult)

// Subsequent drawables: style + palette anchor
for (const drawable of orderedDrawables.slice(1)) {
  generate({
    layer: drawable,
    prompt: template({
      semantic_group: drawable.semanticGroup,
      style_prompt: stylePrompt,
      sequential_refs: true,
      palette_hex_list: buildPaletteAnchor(palette),
      highlight_description: describeHighlight(anchorResult),
    }),
    references: [
      /* image[1] = drawable crop */,
      /* image[2] = puppet ref */,
      /* image[3] = anchorResult */,
      /* image[4] = most recent result (if within budget) */,
    ],
  })
}
```

The orchestrator's prompt-building is mechanical — same template,
varying slots. The intelligence is in the **slot values**:
palette extraction, highlight description, drawable ranking.

## Highlight description

Critical for material consistency. Generated from the anchor
result via a small heuristic:

```ts
function describeHighlight(anchor: Blob): string {
  // 1. Identify the brightest 5% of pixels (Lab L*).
  // 2. Cluster centroid → "top-left | top | top-right | …"
  // 3. Coverage percent.
  // 4. Color (averaged hex).
  return `${position}, ${color}, ~${coverage}% coverage`
}
```

Without this, sequential AI edits drift on gloss direction:
anchor has top-left highlight, subsequent drawables put it
top-right, the eye reads the lighting as broken. With this
in the prompt, drift drops dramatically. [VERIFY] — prototype
needs measurement.

## Localized prompt fragments

The Live2D community is mostly JP+CN+EN. We add language hints
when the model name contains non-ASCII characters or known
markers:

```ts
function localizedPromptHints(puppet: Puppet): string {
  if (hasJapaneseChars(puppet.name)) {
    return "Style: anime, Japanese illustration aesthetic, " +
           "soft cel shading."
  }
  if (hasChineseChars(puppet.name)) {
    return "Style: donghua / Chinese animation aesthetic, " +
           "high color saturation, soft shading."
  }
  return "Style: anime/illustration, cel shading."
}
```

Appended to the `[EDIT]` block. Subtle but reduces "this looks
like Western cartoon" mistakes on JP/CN models. [VERIFY] —
small A/B once Phase 3 ships.

## Negative anchors

For materials with strong photoreal connotations ("leather",
"silk", "metal"), the prompt explicitly negates photorealism:

```
[STYLE_NEGATIONS]
NOT photoreal. NOT 3D rendered. NOT live-action.
Anime/illustration style only.
```

These three words alone reduce photoreal drift by an order of
magnitude on gpt-image-2 based on the OpenAI prompting guide.
Append unconditionally on `ai-*` calls.

## Reference budget management

gpt-image-2 takes up to 4 images in `image[]`. We have 4 slots
to fill:

| Slot | What | Required | Notes |
|---|---|---|---|
| image[1] | Drawable crop (edit target) | always | Padded, alpha-clipped |
| image[2] | Canonical-pose puppet | always | Cached per session |
| image[3] | Anchor result (sequential) | when chain active | Drops on anchor itself |
| image[4] | Most-recent prior result | budget permitting | Drops if anchor only |

When user-uploaded references exist (`useReferences`), they
compete for `image[3]` and `image[4]`. Priority order:

1. Anchor result (Phase 3 orchestration).
2. User-uploaded character reference (most recent).
3. Most-recent prior result (palette continuity).
4. Canny silhouette (when prompt asks for shape preservation).

This is a soft policy in the orchestrator; user can override.

## Cost-aware prompt routing

For Phase 1 onwards:

```ts
function routeProvider(req: GenerateRequest): ProviderId {
  if (req.isDecisive) return "openai-gpt-image-2"  // user iteration
  if (req.isBulkFanout) return "fal-flux2-schnell" // anchor + N
  if (req.isFinalPolish) return "openai-gpt-image-2"  // settle final
  return DEFAULT
}
```

Within a single orchestrator run, anchor + first 3 use gpt-image-2
for tight literalness; subsequent fan-out uses FLUX.2 Schnell for
speed/cost; final settle (the anchor drawable, regenerated with
all references locked) uses gpt-image-2 again.

Total cost for a 20-drawable group:
- 1 anchor @ $0.04 (OpenAI)
- 19 fan-out @ $0.003 (FLUX) = $0.057
- 1 final settle @ $0.04 = $0.04
- = **~$0.14 per group, ~$0.30 per multi-group intent**

Compare to all-OpenAI = $0.80 per group. ~5× cheaper, similar
quality if the orchestrator picks the right anchor.

## Versioning

Prompts ship under `lib/ai/prompts/` versioned by date:

```
lib/ai/prompts/
  intent_parser.v1.txt
  edit_template.v1.txt
  palette_anchor.v1.txt
```

Each prompt file is a literal template with `{placeholder}` slots.
Version bumps when we change the shape of expected output. Old
versions linger for replay of historical edits in provenance log.

## Open prompt questions

- **[OPEN]** Should `image[2]` (canonical-pose puppet) include
  the WIP edits (so the model sees the current state of the
  character) or only the original state? Argument for WIP: model
  sees real context. Argument for original: avoids feedback-loop
  drift. Default: include WIP at start, fall back to original if
  drift detected.
- **[OPEN]** How to handle prompts in non-English languages? The
  intent parser handles JP/CN/etc. fine. The image-edit prompt
  is currently English-only because foundation models prompt
  better in English. Translation in the parser? Or pass the user's
  language through? Needs UX call.
- **[OPEN]** Should the orchestrator regenerate the anchor at the
  end with all the fan-out results as references (a "settle"
  pass)? Cost: +1 call per group. Benefit: anchor matches the
  group's emergent palette, not its own initial guess.
