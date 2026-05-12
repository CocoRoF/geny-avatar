# 05 — AI Image-Generation Stack Survey (2026)

Survey of the generative AI toolchain available in 2026 for character
texture editing. The job of this doc is to settle which models we use,
which we keep as escape hatches, and which we explicitly skip. The
recommendation feeds [08-recommended-architecture](08-recommended-architecture.md).

The headline conclusion: **gpt-image-2 stays the default, FLUX.2 Edit
becomes the escape hatch, everything else is skipped.** Reasoning below.

## The 2026 toolchain at a glance

| Family | Status | Use case | Cost | Notes |
|---|---|---|---|---|
| gpt-image-2 | Production-grade | Default per-part edits | ~$0.042/standard, $0.167/high | Strong instruction-following, multi-image `image[]` |
| gpt-image-1.5 / gpt-image-1 | Production | Cheaper fallback within OpenAI | Lower | Less literal than 2 |
| Gemini 2.5 Flash Image (nano-banana) | Production | Character-consistency-marketed | Cheaper than gpt-image-2 | Worth A/B; no mask API |
| FLUX.2 Edit (pro/dev/flex) | Production | Multi-image (≤10 refs), 4MP output, hostable | Schnell-tier ~$0.003 | Best identity preservation |
| FLUX.1 Kontext | Production | Predecessor; mature ComfyUI workflows | Mid | Skip for new builds |
| FLUX ControlNet Inpainting (alimama) | Production | Local "preserve outline" with hard control | Self-hosted GPU | Best for shape-preserved redraws |
| SDXL + ControlNet + IP-Adapter + LoRA | Legacy hobbyist | Anime-LoRA workflows (Illustrious/Pony) | Self-hosted | **Skip for new builds** |
| InstructPix2Pix | Historical | — | — | **Skip — subsumed by gpt-image-2 / Flux Kontext** |
| InstantID / PuLID / IP-Adapter FaceID | Legacy face-swap | — | — | **Skip — superseded by multi-image conditioning** |
| TEXGen / UV-space diffusion | Research only | 3D mesh UVs | — | **Skip — not our problem** |

The "skip" verdicts come from the
[Research agent's survey](#research-summary) at the end of this doc.

## Why gpt-image-2 stays the default

We have it wired already. It is the most **literal** at single-target
edits — when a prompt says "change this to red, keep everything else
unchanged", gpt-image-2 honours that more reliably than FLUX, which
sometimes nudges unrelated regions. For a per-part editing flow where
the user iterates region-by-region, this literalness is the right
behaviour. We don't want surprise drift outside the requested change.

Strengths:
- Mask-aware (`alpha=0` = edit zone — our pipeline already handles
  the convention swap).
- Multi-image `image[]` reference anchoring (up to 4 refs).
- Prompt refinement via chat-LLM pre-pass is well-understood.
- Returns base64 PNG, simple integration.

Weaknesses we'll mitigate:
- Cost (~$0.04 / call at standard, ~$0.17 at high quality). A 20-
  drawable hair recolor at standard quality is ~$0.80 per attempt;
  at ~3 attempts to get a good result, ~$2.40 per session. Not
  pocket-money but tolerable.
- Latency (~10-30s per call). Sequential reference chaining over 20
  drawables = 3-10 minutes. Need clear progress UI.
- No native multi-region consistency. We provide consistency via
  sequential conditioning + palette anchoring (see
  [04-multipart-problem](04-multipart-problem.md), Architecture B).

## Why FLUX.2 Edit becomes the escape hatch

Two cases trigger the escape hatch:

1. **Bulk re-renders.** When the user wants to do "give her a school
   uniform" — 40+ drawables. gpt-image-2 at ~30s each = 20 minutes.
   FLUX.2 Schnell at ~2s each = 80 seconds. Real difference.
2. **Identity preservation across many references.** FLUX.2 takes up
   to 10 `image[]` references vs gpt-image-2's 4. For sequential
   chaining over a large group, we eventually hit gpt-image-2's
   limit and start dropping anchors. FLUX.2 holds more.

Cost: Schnell tier is ~10× cheaper per image, so the bulk-rerun
case is dramatically more affordable. We host via fal.ai (no infra
to maintain) and route specific intents to it.

We do NOT make FLUX.2 the default because:
- Slightly less literal than gpt-image-2 on single-target edits.
- Requires a separate API key / provider routing.
- gpt-image-2 mask semantics are tighter (Flux mask is guidance,
  not hard).

Add to `lib/ai/providers/` as a fourth provider, plumbing identical
to existing OpenAI/Gemini/Replicate scaffold.

## Mask conventions — the seam bite

gpt-image-2: PNG mask, `alpha=0` = edit zone. The mask is **guidance,
not hard**: a few pixels bleed outside is normal. For atlas work
that bleed can cross into a neighbour island.

Mitigation: **erode the mask 4-8 px inside the atlas rect** before
sending. The current
[`buildOpenAIMaskCanvas`](../lib/ai/client.ts) handles the alpha
inversion but doesn't erode. Adding an erosion step is a small fix
with outsized payoff for atlas-adjacent edits.

FLUX.2 Edit: same `image[]` convention but mask discipline is
stricter. Worth verifying via A/B once we wire the provider.

## Reference image strategy

For every generate call, we attach:

1. **`image[1]` (the edit target)**: the layer's atlas crop, padded
   to 1024-multiple, alpha-clipped to the layer footprint.
2. **`image[2]` (the puppet reference sheet)**: a composited
   rendering of the WHOLE puppet at canonical pose. This gives the
   model spatial context — when editing hair-front, the model can
   see the face the hair frames. Generated once per session,
   cached. New for this upgrade.
3. **`image[3]` (the previous result, if any)**: when sequential
   reference chaining is active, the previous drawable's output
   rides along. Anchors palette + style.
4. **`image[4]` (silhouette, optional)**: a Canny edge crop of
   `image[1]`. Helps gpt-image-2 preserve outline when the prompt
   asks for material/color change. Adds 1 ref budget so we trade
   off against previous results.

`image[2]` is the meaningful add. The current flow has only
user-uploaded character references (`useReferences`). The full-
puppet canonical-pose snapshot is a more powerful anchor because
it's literally the character.

## Prompt patterns that work in 2026

From the research agent's distillation:

**WORKS**:
- "Change exactly X, keep everything else unchanged" (gpt-image-2
  is famously literal here).
- "Maintain line weight and shading style of the original."
- Negative-style anchoring: "not photoreal, not 3D" for anime
  output.

**DOES NOT WORK**:
- Pixel-precise dimensional commands ("47px wide").
- Color hex requirements (`#FF3344` interpreted loosely).
- "Preserve transparency" (alpha is honoured at input, but edit
  region may fill white before redrawing — always re-key alpha
  post-edit, which we do in `postprocessGeneratedBlob`).

**Live2D-specific patterns we'll add**:

- "This is part of a layered 2D rigged puppet — keep the silhouette
  shape exact; the renderer alpha-clips automatically." (Current
  prompt does this; keep.)
- "**The result will be composed with [N] other drawables of the
  same group. Match the palette in `[image 3]` exactly: same hue,
  same saturation, same gloss highlight positions.**" (New for
  group-consistent generation.)

The chat-LLM pre-pass already refines free-form user prompts into
slot-mapping language. Extending it to group-aware language is a
prompt-template change, not a new model.

## Costs at scale

Rough budget for a power user doing 100 character edits per month:

| Scenario | Calls/month | Cost (gpt-image-2 std) | Cost (FLUX.2 Schnell) |
|---|---|---|---|
| Single-part edits (10/edit) | 1,000 | ~$42 | ~$3 |
| Multi-part recolor (20/edit) | 2,000 | ~$84 | ~$6 |
| Whole-outfit (40/edit) | 4,000 | ~$168 | ~$12 |
| Mixed | — | ~$100 | ~$8 |

If we'd routed everything to FLUX.2 the savings are ~12×. Realistic
expectation: keep gpt-image-2 for the **decisive edit** (the one
the user is iterating on) and route the **bulk fan-out edits** to
FLUX.2. Settle final-quality calls back to gpt-image-2 for the
canonical drawables. Hybrid routing minimises both cost and drift.

## What we deliberately skip

The research agent was clear:

- **SDXL + ControlNet + IP-Adapter + LoRA stacks** — still alive
  for hobbyists running Illustrious/Pony locally, but obsolete for
  new instruction-driven editors. Flux Kontext / gpt-image-2 do
  what those 8-node ComfyUI graphs did in one prompt.
- **InstructPix2Pix** — historical importance, no current
  practical use.
- **InstantID / PuLID / IP-Adapter FaceID** — built for
  photographic face identity, not anime atlas crops. Multi-image
  conditioning in modern foundation models absorbed their value.
- **UV-space diffusion (TEXGen, Paint3D, MVPaint)** — solves 3D
  multi-view consistency. Our problem is multi-region consistency
  on flat atlas pages. Different math, doesn't transfer.

If a future use case demands character LoRA training for a specific
artist's style, we can re-evaluate. Today no user has asked.

## Frontier research worth tracking

These are not v1 features but may unlock v3+ leaps:

- **RAD (Region-Aware Diffusion)** — CVPR 2025. Pixel-wise noise
  schedules, regions denoise asynchronously while sharing global
  context. Directly applicable to our atlas problem.
- **GSGDiff** — IJCAI-25. Diffusion-bridge with global structure
  guidance to fix semantic drift.
- **CartoonAlive** — 2025 arXiv. Live2D-specific from-portrait
  generation, blendshape inference. Their limitations document
  (ear/iris/hair edge failures) read as a roadmap of what's still
  hard.
- **UV-free texture w/ geodesic heat diffusion** — NeurIPS 2024.
  Drops UVs entirely, diffuses on surface via heat-kernel
  attention. Solves seams by construction.

We track these as a watchlist; check quarterly for production
viability.

## Research summary

The research agent's verdict, condensed:

> Use gpt-image-2 as the default instruction-following edit engine.
> Add FLUX.2 Edit (via fal.ai) as an escape hatch for bulk re-
> renders and when the user wants stronger identity preservation
> across many references. For "preserve outline, redraw inside",
> erode the mask 4-8 px and feed a Canny silhouette as a second
> reference; if local hosting is acceptable, use FLUX ControlNet
> Inpainting (alimama-creative) instead. Skip SDXL+IPAdapter+
> ControlNet stacks, InstructPix2Pix, and UV-aware diffusion —
> they are either obsolete or solving a different problem.

Cited sources:

- [OpenAI image-gen guide](https://developers.openai.com/api/docs/guides/image-generation)
- [gpt-image-2 reference](https://wavespeed.ai/blog/posts/gpt-image-2-api-guide/)
- [BFL FLUX.2](https://bfl.ai/models/flux-2) / [fal FLUX.2 edit](https://fal.ai/models/fal-ai/flux-2/edit)
- [FLUX.1 Kontext paper](https://arxiv.org/html/2506.15742v2)
- [alimama-creative FLUX-ControlNet-Inpainting](https://github.com/alimama-creative/FLUX-Controlnet-Inpainting)
- [Gemini 2.5 Flash Image](https://developers.googleblog.com/en/introducing-gemini-2-5-flash-image/)
- [Krita AI Diffusion](https://kritaaidiffusion.com/)
- [RAD CVPR 2025](https://openaccess.thecvf.com/content/CVPR2025/papers/Kim_RAD_Region-Aware_Diffusion_Models_for_Image_Inpainting_CVPR_2025_paper.pdf)
- [CartoonAlive](https://arxiv.org/abs/2507.17327)

Full source list embedded in the research artifact archived with this
commit.
