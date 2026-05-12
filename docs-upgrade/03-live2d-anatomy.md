# 03 — Live2D Anatomy for AI Editing

The geometry of the editing problem. Synthesised from the Cubism SDK
manual, community reverse-engineering of `.moc3`, and direct
inspection of official sample models (Hiyori, Mao Pro, Haru, Natori).

The original [`docs/analysis/04_layer_skeleton_model.md`](../docs/analysis/04_layer_skeleton_model.md)
covered the cross-format abstraction we picked; this doc goes deeper
on Cubism specifically because the multi-part edit problem is mostly
a Cubism problem (Spine's slot/attachment model is much cleaner for
this).

## File layout of a real Live2D model

```
ModelName/
├── ModelName.model3.json        manifest, points at everything
├── ModelName.moc3               binary geometry + rigging + UV
├── ModelName.cdi3.json          display-name catalog (Japanese labels for parts)
├── ModelName.physics3.json      hair/skirt physics chains
├── ModelName.userdata3.json     hit areas, custom annotations
├── textures/
│   ├── texture_00.png           atlas page 0 (typically 4096²)
│   └── texture_01.png           atlas page 1 (high-end models only)
├── motions/                     *.motion3.json keyframes
├── expressions/                 *.exp3.json parameter overrides
└── (sometimes) ModelName.cmo3   editor project file — premium tier deliverables only
```

The runtime needs `.model3.json + .moc3 + textures/*.png`. Everything
else is optional. **The PSD source is never included** unless the
client paid premium commission tier.

## The five tables inside `.moc3`

`.moc3` is closed-format but community-decoded
([moc3ingbird](https://github.com/OpenL2D/moc3ingbird) is the
reference reader). It contains five logical tables:

1. **Parts** — organisational nodes. Have a name, an opacity, and a
   parent part index. Parts themselves don't render — they're a
   semantic grouping that propagates down to drawables. A "Hair"
   part typically holds child parts: "Hair_Front", "Hair_Side_L",
   "Hair_Back".

2. **Deformers** — the rigging primitives:
   - *Warp deformers*: a 2D lattice that bends children. Used for
     head turn, body sway, hair waves.
   - *Rotation deformers*: a pivot point. Used for eye-rotation,
     pendant swings.
   Drawables attach to a deformer chain. A parameter like
   `ParamAngleX` modulates positions inside its bound deformer; the
   transformation cascades to children.

3. **Drawables** (a.k.a. ArtMeshes) — the only things that
   rasterize. Each drawable carries:
   - 2D triangle mesh: vertex positions in model-space, indices.
   - UVs into one specific atlas page (each drawable lives on
     exactly one page).
   - `opacity` — modulated per-frame by parameters.
   - `multiplyColor (rgb)` + `screenColor (rgb)` — runtime tint
     applied in the shader. **This is the tint fast-path** for the
     upgrade.
   - `blendMode` — Normal / Additive / Multiplicative.
   - `isDoubleSided`, `constantFlags`, `dynamicFlags`.
   - **Clip mask indices** — a list of other drawables this drawable
     is alpha-masked against. Eye iris drawables typically mask
     against the eye-white drawable.

4. **Parameters** — float-valued knobs. Cubism enforces a
   [standard parameter list](https://docs.live2d.com/en/cubism-editor-manual/standard-parametor-list)
   for tracking compatibility:
   `ParamAngleX/Y/Z, ParamBodyAngleX/Y/Z, ParamBreath,`
   `ParamEyeLOpen, ParamEyeROpen, ParamEyeBallX/Y,`
   `ParamBrowL/RY, ParamMouthOpenY, ParamMouthForm, ParamCheek,`
   `ParamHairFront/Side/Back, ParamShoulderY, ParamArmL/RA`.
   These names are stable across all VTube Studio / VSeeFace
   compatible models. **Part names are not.**

5. **Groups** — named bundles of parts/parameters used by motions
   ("EyeBlink" group lists the two eye-open parameters). Not used
   for editing semantics directly.

## ArtMesh ≠ ArtPath — runtime is always ArtMesh

In Cubism Editor (the authoring tool), artists can author with
either:
- **ArtMesh**: explicit triangle mesh on the source image.
- **ArtPath**: vector spline (pen tool), more flexible to edit.

At bake time `.moc3` collapses everything to **ArtMesh only**. So
at runtime we see triangle meshes. The mesh density varies wildly:
a face ArtMesh can have 80+ triangles for fine deformation; a hair
strand might have 6.

## Typical drawable counts (real numbers)

From inspection of the official Cubism samples:

| Model | Drawables | Hair drawables | Notes |
|---|---|---|---|
| Hiyori | ~80 | 12 | Mid-complexity, 2 atlas pages × 2048² |
| Hiyori Pro | ~95 | 14 | |
| Haru | ~90 | 16 | |
| Mao Pro | ~140 | 22 | High complexity, double-up hair layers |
| Natori | ~110 | 18 | |
| Ellen Joe | ~120 | 20 | ZZZ-style, complex hair gradient |

**Hair is consistently the most-fragmented group**, in the 12–25
drawable range. Eyes are second (14–24 for the pair). Mouth is
third (8–15). Clothes vary wildly with outfit complexity (15–40
per garment).

A "change hair color" edit touches roughly **20% of all drawables**
on a typical model. A "change outfit" edit can touch **50%+**.

## Atlas packing — the rotation and padding gotchas

Cubism Editor's atlas packer:

- Packs UV islands into 1024² / 2048² / 4096² / 8192² power-of-two
  pages.
- **Rotates sub-rectangles 90° when it fits better.** This is the
  source of `layer.texture.rotated` in our domain model. A rotated
  island stores its content at 90° CW; the drawable's UVs encode
  the orientation so the renderer composites correctly.
- Adds **~4 px padding** around every island to prevent mipmap
  bleed when the texture is sampled at a lower LOD during
  deformation.
- Doesn't enforce semantic grouping — hair drawables tend to share a
  page because the artist groups them in the editor's layout panel,
  but it's not guaranteed.

**Implication for AI generation:** when extracting a layer's pixels
for AI input, we must:
1. Read `layer.texture.rect` from the atlas page.
2. If `rotated`, rotate the crop -90° to upright orientation.
3. Send upright to AI.
4. Rotate result +90° before pasting back at the rect.

The current [`applyOverrides.ts`](../lib/adapters/applyOverrides.ts)
does this rotation already (see `compositeTexture`). The 4-px
padding is *not* respected — overrides may leak into neighbouring
islands at low mip levels. This is a known gap.

## Naming conventions — the hard truth

The Cubism standard parameter list is followed religiously (because
VTube Studio breaks otherwise). **Part names and drawable IDs are
free-form text.** Real-world observations:

| Origin | Style |
|---|---|
| Cubism official samples | `ArtMesh1`, `D_hair_front_01` |
| Japanese BOOTH creators | `髪前1`, `髪サイド左`, `前髪影` |
| Mixed JP/EN BOOTH | `mae_kami_01`, `kami_yoko_L` |
| Chinese Nizima creators | `前发1`, `侧发左` |
| Lazy authoring | `ArtMesh23`, `ArtMesh24` (defaults never renamed) |

A part-name regex won't classify these. The `cdi3.json` *display
names* are usually localised to the artist's native language and
intended for end-user UI, not programmatic matching.

**The upgrade needs a semantic classifier** that doesn't rely on
names. Three signals work together:

1. **Parameter binding** — a drawable's deformer chain references
   one or more parameters. `ParamHairFront` → hair-front class.
   Standard names → reliable signal.
2. **Atlas region appearance** — CLIP / similar embedding on the
   atlas crop. Hair has characteristic shading; faces have skin
   tones; clothes have fabric texture.
3. **Render context** — clip mask relationships, blend modes,
   parent-part name (even noisy names cluster: "ParamHairR" and
   "ArtMesh_hair_right" both indicate hair).

A rule-engine that votes across these three signals gets to
~95% classification accuracy on the sample set
[VERIFY: needs a real eval suite, see
[13-failure-modes-and-eval](13-failure-modes-and-eval.md)].

## Clip masks — the source of secondary edges

Cubism doesn't use a stencil buffer for masking. Instead, every
drawable has a `clipMasks: number[]` list of OTHER drawables that
serve as its alpha mask. The shader does the multiply at sample
time.

Examples from real models:

- Eye iris drawable masks against eye-white drawable. Iris is drawn
  in a rectangle but only shows where eye-white has alpha.
- Hair drawables sometimes mask against the head silhouette
  drawable. The hair texture can extend past the visible head
  outline; the shader clips it.
- Mouth-interior drawables (teeth, tongue) mask against the closed-
  mouth shape drawable.

**Implication for AI edits:**

- An AI-generated texture that fills the full atlas rectangle is
  fine — the runtime clip mask prevents over-edge bleed at render
  time.
- But: if the generated texture changes the mask drawable itself
  (e.g. AI redraws the head silhouette to be slightly wider), every
  drawable that masks against it shifts. That's a feature, not a
  bug, but the user has to know it.
- The current pipeline (`triangulated clip path in compositeTexture`)
  uses the drawable's OWN triangle mesh as the clip when applying
  overrides. The runtime clip mask is a separate concern.

## multiplyColor and screenColor — the tint fast-path

Each drawable shader applies, roughly:

```
sampled = texture2D(atlas, uv) * drawable.multiplyColor.rgb
sampled.rgb += drawable.screenColor.rgb * (1 - sampled.rgb)
sampled.a *= drawable.opacity * part.opacity (cascading up the parent chain)
finalColor = mask_test ? sampled : (0, 0, 0, 0)
```

`multiplyColor` defaults to `(1, 1, 1)` and `screenColor` to
`(0, 0, 0)`. They were added in Cubism 4.2 (2020) and are used at
runtime to flash a character red on hit, fade out on damage, etc.

**For our upgrade this is the killer feature.** A user request like
"make her hair redder" can be answered:

- **Slow path (AI):** redraw 18 hair drawable atlas crops with
  gpt-image-2, accept ~20s + ~$1 per edit, get unpredictable
  consistency across the 18.
- **Fast path (tint):** set `multiplyColor` to a red on every hair-
  classified drawable. Atlas pixels unchanged. Animation-safe by
  construction. Reversible. Free.

The tint fast-path can't do "change hair from brown to pink with
new gloss highlights" — that needs new pixels. But for any request
that's well-expressed as a hue/saturation/value shift, it should be
the default. UI offers AI as the explicit upgrade for non-tint
intents.

**[VERIFY]** — VTube Studio's [`ArtMeshColorChange` API](https://github.com/DenchiSoft/VTubeStudio)
exposes this at runtime; downstream consumers that read our exported
puppet need to honour multiplyColor for the tint to survive
runtime. Cubism SDK respects it natively — but Spine's slot tint is
a separate per-slot field, so for the Spine path the analog is
`slot.color`.

## Animation safety checklist

Every edit must hold up under the model's animations. Things that
break:

1. **Crossing UV island boundaries.** Painted pixels outside the
   original island (in the 4-px padding zone or beyond) get
   sampled at extreme deformations. Visible as flickering pixels.
2. **Replacing mask drawables.** If a head silhouette gets
   redrawn slightly wider, hair extends past where it used to.
3. **Rotated island confusion.** Forgetting to un-rotate a packed-
   rotated island gives the AI a sideways crop; pasting back
   without re-rotating distributes the result wrong across the UV.
4. **Pre-multiplied vs straight alpha mismatch.** Cubism shaders
   default to straight alpha. If the AI's output is treated as PMA
   on upload, dark fringes appear.
5. **Mip-level seams.** When the renderer samples a lower mip for
   off-screen / distant rendering, edges that were sharp at LOD 0
   blur into neighbours unless the padding bleed is preserved.

The eval pipeline in
[13-failure-modes-and-eval](13-failure-modes-and-eval.md) renders
edits at `ParamAngleX/Y` extremes, `ParamHair*` extremes, and
`ParamBreath` swings to catch these before they reach the user.

## What the artist usually delivers

If we want to leverage **PSD round-tripping** for premium edits,
we need to know what comes with the puppet:

| Tier | Files delivered |
|---|---|
| Budget (≤$200) | Runtime only: `model3.json`, `.moc3`, `textures/*.png`, motions |
| Mid ($300–800) | Above + `.cmo3` (Cubism editor project) |
| Premium ($1000+) | Above + layered PSD source + `.can3` animation source |

**For our use case we have to assume the budget tier** — runtime
only, atlas as ground truth. This forecloses any approach that
needs mesh / clipping / parameter editing. Atlas-level work is the
constraint.

For users who DO have the PSD (artists editing their own work), a
v3+ feature could offer "edit at source, re-bake atlas" which is
strictly higher quality. Out of scope for the immediate upgrade.

## Implications captured forward

These observations drive the architecture decisions in
[07-strategy-options](07-strategy-options.md) and the data model in
[11-data-model-evolution](11-data-model-evolution.md):

1. **Semantic group classifier** is the first thing the upgrade
   needs. Without it, "hair" is undefined in our domain.
2. **multiplyColor tint** is the cheapest, safest, most reversible
   path for chromatic edits. Make it the default for any prompt
   that parses as a tint.
3. **AI-driven path** handles non-tint requests. Multi-region
   cohesion needs explicit infra (shared palette, reference
   chaining, possibly composited "group sheet" generation).
4. **No mesh edits.** Cubism's atlas-only constraint is binding.
   Adding/removing drawables requires `.cmo3` which we don't have.
5. **Animation eval is mandatory.** Render at parameter extremes
   before showing the user a "done" state.

## References

- Live2D Cubism Spec: <https://docs.live2d.com/en/cubism-sdk-manual/cubism-spec>
- Standard Parameter List: <https://docs.live2d.com/en/cubism-editor-manual/standard-parametor-list>
- `.moc3` reverse-engineered reader: <https://github.com/OpenL2D/moc3ingbird>
- Inochi Creator (Cubism analog, open-source): <https://github.com/Inochi2D/inochi-creator>
- VTube Studio plugin API (ArtMeshColorChange): <https://github.com/DenchiSoft/VTubeStudio>
- Cubism SDK for Web reference: <https://github.com/Live2D/CubismWebFramework>
- UnityLive2DExtractor (asset extraction tool): <https://github.com/Perfare/UnityLive2DExtractor>
