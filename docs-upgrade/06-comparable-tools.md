# 06 — Comparable Tools and What They Teach

Who else has tackled "AI-assisted character editing"? What did they
ship, what failed, what's still unsolved? This doc synthesises a
landscape survey to locate geny-avatar in the competitive map and
extract reusable lessons.

The summary: **nobody has shipped what we're building**. Adjacent
products either constrain the geometry to make AI tractable (VRoid,
Ready Player Me), or constrain the AI to single-image work (Krita
AI Diffusion), or do neither and the user does it by hand. The lane
is open. The technical hurdles are real but they're our moat too.

## VRoid Studio — parametric, not painted

VRoid is the mass-market analog to what we're doing for the
3D/VRM world. Its design choice is instructive: **sidestep the
atlas-coherence problem by making everything parametric**.

- Hair is procedurally-generated strips, each with its own UV. The
  user clicks "Add Hair" → a templated mesh appears → texture
  painter operates on per-strip auto-generated UVs.
- Hair color is a **single base + highlight pair** applied to the
  whole hair material. All strips sample one shared texture.
- Body, face, outfit are slider-driven on a templated topology.

**Notably, VRoid itself does not ship AI generation.** "AI VRoid"
content is third-party SDXL/SeaArt produced; humans then trace
into VRoid by hand. The reason is structural: VRoid's parts share
semantic categories but DON'T share a packed atlas in the Live2D
sense. Every garment is its own item with its own UV chart, baked
into the final VRM at export. This avoids the multi-part-atlas
problem geny-avatar has, at the cost of forcing every garment to
live inside the templated topology.

**Lesson:** users tolerate constrained part systems when feedback
is instant. They have not solved AI-driven editing because they
didn't need to — sliders were enough. For us, the analog would be:
once we have a semantic group classifier, parametric tint sliders
on each group should be free (multiplyColor is exactly this) and
the slow AI path is the upgrade.

Sources: [VRoid Studio](https://vroid.com/en/studio),
[Hair Editor FAQ](https://vroid.pixiv.help/hc/en-us/articles/360012339194-Hair-Editor),
[Body Editor FAQ](https://vroid.pixiv.help/hc/en-us/articles/360012340434-Body-Editor).

## Ready Player Me — AI texture on closed catalog

RPM's "geometry-aware AI texturing" (launched 2024, flagship in
2026) is the most relevant deployed example of AI texture
generation in a character system:

- Custom SDXL + ControlNet stack **fine-tuned on RPM's garment
  catalog**. The model has seen every shirt, pocket, button RPM
  ships.
- Inference is conditioned on the UV layout + depth/normal pass
  from the garment mesh. Generated textures land on correct
  pockets/seams.
- Output is a baked diffuse texture. **Mesh stays fixed.**

The trick that makes this work in production: **closed garment
catalogue**. RPM controls every mesh, so they could fine-tune. An
open editor like ours doesn't have that luxury — users upload
Live2D models from BOOTH whose meshes we've never seen.

**Lesson:** generic-foundation-model approaches (gpt-image-2 /
FLUX) will hit a quality ceiling that custom fine-tunes don't.
But our users buy diverse models from many artists, so a fine-tune
is impractical. We accept the ceiling and work around it with
multi-image conditioning + reference chaining.

RPM's photo-to-avatar path is **not generative** — it's face-
landmark fitting + parametric morph + skin-tone matching, picking
from a catalogue. Worth noting because the marketing implies "AI"
but the architecture is decidedly not. Don't be misled when
benchmarking.

Sources: [RPM AI Texture docs](https://docs.readyplayer.me/ready-player-me/customizing-guides/create-custom-assets/create-modular-assets/ai-texture),
[Auganix coverage](https://www.auganix.org/xr-news-ready-player-me-expands-its-avatar-development-tools-with-geometry-aware-ai-texturing/).

## MetaHuman / Character Creator 4 / Daz Studio

The 3D character creators converged on a shared architecture:

> **Base mesh + morph stack + texture-layer stack**

- CC4: Substance materials with discrete makeup / wrinkle / dirt
  layers, baked for runtime.
- Daz: material zones with separate textures per zone.
- MetaHuman 5.6+ (2025): added cloud "AI texture synthesis" plus
  database-driven scan blending. Blend Mode interpolates between
  3–6 preset scans (closer to PCA-on-scans than to generative).

**Pattern across all three:** morphs solve geometry, texture-layer
stacks solve appearance, AI only enters at the texture-synthesis
tail. None of them lets AI rewrite the mesh; AI is confined to the
diffuse/normal pass after geometry is locked.

**Lesson for geny-avatar:** keep the AI on textures, never let it
touch the mesh or rig. This is also what Live2D's atlas-only
constraint enforces on us by default — alignment is automatic.

Sources: [MetaHuman 5.6 release](https://www.metahuman.com/news/metahuman-leaves-early-access-with-a-feature-packed-new-release),
[CGChannel coverage](https://www.cgchannel.com/2025/06/you-can-now-sell-metahumans-or-use-them-in-unity-or-godot/),
[CC vs Daz forum thread](https://forum.reallusion.com/257581/Character-Creator-vs-Daz3D).

## NIKKE Visualiser / Spine viewers — viewer, not editor

The NIKKE modding community built sophisticated **Spine viewers**
([nikke-db.pages.dev/visualiser](https://nikke-db.pages.dev/visualiser),
[NikkeViewerEX](https://github.com/bungaku-moe/NikkeViewerEX))
loading `.skel + .atlas + .png` triples. Outfit swaps and recolours
exist — done **entirely by hand in Photoshop on the atlas PNG, then
reload**. No AI texture replacement anywhere in this ecosystem.

The atlas is treated as sacred: modders carefully repaint within
existing UV islands and avoid touching atlas layout. Validates that
the demand for what geny-avatar enables exists. Also validates that
the technical bar (don't corrupt UV islands) is real.

## Krita AI Diffusion — the closest deployed analog

[Acly's Krita plugin](https://github.com/Acly/krita-ai-diffusion)
is the most mature browser-adjacent reference. It runs SD1.5 /
SDXL / Flux 2 / Z-Image locally with ControlNet (scribble, line-
art, canny, depth) and uses Krita selections as masks. Power user
patterns:

- **Context size matters more than mask shape.** The plugin pulls
  a configurable halo of pixels around the selection as
  conditioning; too small → off-style, too large → drifts.
- **Iterative passes > single shots.** Paint, inpaint, blend,
  repeat. Single-shot full-region inpaint produces seams.
- **Control layers > prompts.** Layer a scribble or line-art
  ControlNet to lock silhouette; let the prompt only steer color/
  material.
- **Reference-only ControlNet** is the standard trick for matching
  style between regions.

**There is no Krita plugin specifically for VTuber atlases.**
Artists hand-tile, edit one part at a time, rely on line-art
ControlNet to keep edges consistent. The repeated pain point:
**every island is inpainted in isolation, so identical garment
regions across the atlas drift in colour and shading**.

This is verbatim the problem
[04-multipart-problem](04-multipart-problem.md) describes. Even
power users with the best image-editing AI tooling experience it.

Sources: [Krita AI Diffusion](https://github.com/Acly/krita-ai-diffusion),
[Inpainting wiki](https://github.com/Acly/krita-ai-diffusion/wiki/Inpainting).

## Civitai recolor / outfit-swap workflows

The Civitai community has converged on a few recipes:

- **Recolor**: `controlnet-recolor` (ioclab_sd15_recolor) + soft-
  edge ControlNet at high weight + low-CFG prompt. Works for hue
  shifts; fails on material changes (cotton→leather drifts
  geometry).
- **Outfit swap**: [Outfit-to-Outfit ControlNet](https://civitai.com/models/191956/outfit-to-outfit-controlnet-outfit2outfit).
  Best at 512px; degrades hard at higher resolution. Stack:
  OpenPose + outfit2outfit + reference-only.
- **Manga colorize**: ControlNet line-art + LoRA + prompt.

**What's missing across all of these: multi-image consistency.**
They work on one image. Run on 30+ atlas parts of a Live2D
character and you get 30 plausible-but-inconsistent results. No
Civitai workflow addresses cross-image consistency for a single
character.

Geny-avatar's wedge: address this gap.

## VTuber-specific generative AI

The market is bifurcating:

- **Traditional commission** ($300–5000+, 2–4 week turnaround):
  ShiraLive2D, Kvxart, 2wintails, VGen marketplace. Vocal against
  AI tools.
- **AI-first newcomers**:
  - [Viggle Live](https://viggle.ai/blog/ai-vtuber-maker-stream-as-anyone-with-an-image-using-viggle):
    image + webcam → real-time avatar. Skips Live2D entirely.
  - [NanoLive2D](https://gist.github.com/Felo-Sparticle/acf535487a5b57fa49896b715827b4a8):
    Gemini-driven clothing swap, 3–5s per generation, on a base
    mesh. Closed loop — generates new puppet from scratch, doesn't
    edit existing.
  - [Open-LLM-VTuber](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber):
    LLM + Live2D, offline-capable.

**Nothing in the AI-first category has yet edited an existing
rigged Live2D model.** Viggle bypasses Live2D. NanoLive2D
regenerates the puppet from a base mesh.

**There is a clear open lane: "drop in your existing model,
redraw a part, keep the rig."** That is geny-avatar's positioning.

## Substance Painter / 3D-Coat — the 2D analog gap

Substance Painter's projection paint (screen-space stencil onto
mesh + 2D-view editing of UV islands directly) is the gold standard
for 3D texture work. The 2D analog is essentially what Acly's
Krita plugin reaches toward.

**Neither tool has the concept of a rigged 2D mesh.** Substance
assumes 3D; Krita assumes flat raster. **2D projection paint that
respects a Live2D/Spine deform graph does not exist as a deployed
product.** Cubism Editor's own texture-replacement feature is
beta-status and frequently fails (community forum reports of
clipping-mask corruption on PSD round-trip).

This is the most concrete unsolved problem in the space. If
geny-avatar's Phase 4 ships a working "render-and-back-project"
flow (sketched in [08-recommended-architecture](08-recommended-architecture.md)),
it would be a first in production.

## Academic research worth tracking

From the survey:

**Multi-region inpainting with global consistency**
- [RAD: Region-Aware Diffusion (CVPR 2025)](https://openaccess.thecvf.com/content/CVPR2025/papers/Kim_RAD_Region-Aware_Diffusion_Models_for_Image_Inpainting_CVPR_2025_paper.pdf)
  — pixel-wise noise schedules, ~100× faster, regions denoise
  asynchronously while sharing global context.
- GSGDiff (IJCAI-25) — diffusion-bridge with auxiliary global
  structure guidance.
- [3D-Consistent Image Inpainting](https://arxiv.org/abs/2412.05881)
  (Dec 2024) — formulation maps onto "different atlas parts of
  one character."

**Multi-view consistent generation** (3D but math transfers)
- [MVDream](https://arxiv.org/abs/2308.16512) and
  [Wonder3D](https://github.com/xxlong0/Wonder3D) — cross-domain
  diffusion conditioned on view embeddings. The "shared cross-
  attention across views" trick adapts to "shared cross-attention
  across atlas parts of one character."

**Live2D-specific**
- [CartoonAlive (arXiv 2507.17327)](https://arxiv.org/abs/2507.17327)
  — generates expressive Live2D models from a single portrait via
  blendshape inference. **Limitations**: fixed ears (keypoint
  detection unreliable), pupil/iris drift, hair fine-strand
  segmentation fails, closed-eye artifacts.

We track RAD and shared-cross-attention adaptation as the most
promising frontier for Architecture C (sheet generation) in v3+.

## Failure modes from community discussion

Cross-referenced from Live2D forums, Polycount, Civitai, Reddit:

**Technical:**

- **Cross-part drift** (#1 complaint). Same garment color comes out
  different on left vs right sleeve atlas slice. No shipped tool
  solves it.
- **Style drift**: inpainting at one resolution + upscale shifts
  line weight, breaks blending between AI-touched and untouched
  parts.
- **IP-Adapter quality regression**: power users report it "gives
  inconsistent results where the person is barely recognisable",
  "follows too close" to target composition, identity leaks fail
  in unusual poses.
- **LoRA training instability for outfits**: outfit details only
  stick if every training image shows the outfit; otherwise CFG
  weights climb to 1.4+, frying the rest of the generation.
- **Live2D atlas re-import is fragile**: Cubism's PSD-replacement
  workflow breaks clipping-mask relationships, forces re-setting
  clipping. Riggers report half-blink eyelid collapse, mouth-corner
  pinching as standard failure modes when atlas is updated mid-
  rig.
- **Seam artifacts** at island boundaries when each island is
  inpainted in isolation.

**Cultural** (affects adoption willingness):

- "It's art theft." Hololive talents asked fans to keep AI art out
  of their hashtags.
- **Demonetisation fear**: artists worry cheap AI commissions
  hollow out the $300-5k commission market.
- **Provenance**: no tool surfaces which pixels are AI vs human-
  painted. Artists who want to opt out of having AI in their
  workflow have no way to verify.

## Unsolved problems — geny-avatar's possible moat

Aggregating from everything above, the **unsolved problems** in the
space are:

1. **Cross-atlas-part consistency for a single character.** Closest
   research: RAD, TEXGen, MVDream cross-attention. No deployed
   product. [04-multipart-problem](04-multipart-problem.md)
   addresses this for our scope.

2. **Rig-aware inpainting** — respecting the deformer graph so a
   redraw doesn't break warp-deformer triangulation. Our triangle-
   clip in `compositeTexture` is the start; needs to expand.

3. **Style continuity** between AI-touched and hand-painted parts
   on the same atlas. Our reference-image stack helps, but doesn't
   solve.

4. **Round-trip integrity** — every Live2D PSD-replacement workflow
   loses clipping/grouping metadata. We're atlas-only so this is
   less acute for us, but a v3+ PSD path would have to address it.

5. **Provenance and opt-out signalling for artists.** A "this part
   is hand-painted, lock it" flag is a clear UX feature.

## Strategic takeaways

Crystallised into the recommendation
([08-recommended-architecture](08-recommended-architecture.md)):

1. **Deployment-validated pattern: AI on textures only, never on
   geometry/rig.** Every shipped product follows this. We
   inherit it from Cubism's constraints.
2. **The unsolved technical problem with the most academic
   momentum + community pain is cross-region consistency on a
   single character.** RAD + TEXGen-style architectures are the
   right starting points. Practitioner workaround is sequential
   reference chaining (Architecture B in
   [04-multipart-problem](04-multipart-problem.md)).
3. **The unsolved UX problem is round-trip integrity with Live2D/
   Spine.** PSD round-trip is brittle; AI tools currently make it
   worse. Preserving group/clip metadata on edits would be a real
   moat — for our atlas-only path the analog is preserving
   `multiplyColor`, `screenColor`, blend mode, and clip mask
   relationships across edits.
4. **The cultural problem is real and shapes adoption more than any
   feature.** Provenance markers, artist-credit fields, an
   explicit "this part is hand-painted, lock it" mode defuse
   most critique. Worth designing now even if shipping later.
