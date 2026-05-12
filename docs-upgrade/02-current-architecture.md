# 02 — Current Architecture

A technical inventory of geny-avatar as of `2382adf..6c3b2f4` (May 2026).
Everything here is **observed reality**, not aspiration. The upgrade
plan in tracks B and C is layered on top of these foundations, so
later docs assume the reader has internalised this one.

## Top-level shape

```
┌───────────────────────────────────────────────────────────────────┐
│  Browser — Next.js App Router, basePath /avatar-editor (optional) │
│                                                                   │
│  ┌─────────────┐   ┌────────────────────┐   ┌──────────────────┐ │
│  │  Library    │   │   Edit page         │   │  /api routes      │ │
│  │  /          │ → │   /edit/[avatarId]  │ → │  /ai/* /library/* │ │
│  └─────────────┘   └────────────────────┘   └──────────────────┘ │
│         │                      │                        │         │
│         │                      ▼                        ▼         │
│         │              ┌───────────────┐        ┌──────────────┐  │
│         │              │  AvatarAdapter│        │  AI provider │  │
│         │              │  Live2D / Spine│ ←──── │  (Gemini /   │  │
│         │              └───────────────┘        │   OpenAI /   │  │
│         │                      │                │   Replicate) │  │
│         │                      ▼                └──────────────┘  │
│         │              ┌───────────────┐                          │
│         └─────────────►│  IndexedDB    │  ◄── Dexie schema        │
│                        │  (Dexie)      │      v7+                  │
│                        └───────────────┘                          │
│                                                                   │
│  Auto-publish (geny-avatar → shared volume → Geny via watcher)    │
└───────────────────────────────────────────────────────────────────┘
```

The editor is entirely client-side except for the AI provider proxy
routes; backend never sees user puppet bytes (only `/api/ai/*`
proxies a single layer's PNG + prompt to the chosen provider).

## Core domain model

`lib/avatar/types.ts` is the canonical surface. The relevant types
for this upgrade:

```ts
Avatar  = { id, runtime: "live2d" | "spine", layers: Layer[], textures: Texture[], parameters: Parameter[], source: AvatarSource }
Layer   = { id, externalId, name, geometry, defaults: {visible, color, opacity}, bakedHidden, texture?: TextureSlice }
TextureSlice = { textureId, rect: {x,y,w,h}, rotated?: boolean }
Texture = { id, pageIndex, origin, pixelSize, data: { kind: "url" | "blob", ... } }
Parameter = { id, name, min, max, default, source: "live2d-param" | "spine-skel-param" | ... }
```

Things to notice:

1. **Layer is the editing unit.** Everything user-facing in the
   editor (Layers panel, DecomposeStudio, GeneratePanel) addresses a
   Layer at a time. Layers can be split per atlas page if a Cubism
   part's drawables span multiple atlas pages
   ([`Live2DAdapter.ts:392-430`](../lib/adapters/Live2DAdapter.ts)).
2. **No grouping.** Layers carry no metadata about belonging together.
   A "hair" group does not exist in the domain — the user implicitly
   groups via UI by editing layers one-after-another.
3. **TextureSlice locks an edit to a single rectangle.** An edit
   affects exactly `rect.w × rect.h` pixels on a single atlas page.
   Cross-page edits (a part split across two atlas pages) are
   modelled as two separate Layers with `#p${n}` suffixes on
   `externalId`.

## Adapter boundary

`AvatarAdapter` is the runtime-agnostic interface. Two concrete
implementations:

- **Live2DAdapter** ([`lib/adapters/Live2DAdapter.ts`](../lib/adapters/Live2DAdapter.ts), 1358 LoC) — wraps pixi-live2d-display, parses
  `model3.json` + `.moc3` (via Cubism Core), builds the layer
  catalog, monkey-patches `internalModel.update` to inject opacity
  overrides per frame.
- **SpineAdapter** ([`lib/adapters/SpineAdapter.ts`](../lib/adapters/SpineAdapter.ts), 440 LoC) — wraps pixi-spine, simpler because
  Spine's slot/attachment model maps cleanly to our Layer abstraction.

Both expose:

- `getTextureSource(textureId)` — pristine atlas page bytes.
- `getLayerTriangles(layerId)` — UV triangles for the layer's
  drawables on the dominant atlas page. Used to build precise clip
  paths.
- `setLayerOverrides({masks, textures})` — apply the user's edits to
  the live render. Delegates to `applyLayerOverrides`.

## The atlas-edit pipeline

The single most important code path for the upgrade: how a user-
edited blob becomes a visible change on the rendered character.

[`lib/adapters/applyOverrides.ts`](../lib/adapters/applyOverrides.ts):

```
for each affected atlas page (textureId):
  1. work = clone(pristine atlas page bitmap)
  2. for each (layerId → texture blob):
     - find layer, build triangle clip path (or rect fallback)
     - destination-out wipe inside clip            ← v0.3.x fix for erase
     - source-over drawImage(blob) at layer.texture.rect (rotated if needed)
  3. for each (layerId → mask blob):
     - destination-out drawImage(mask) at layer.texture.rect
  4. replacePixiTextureSource(pixiTexture, work)
     → bumps pixi's update counters → GPU re-upload next frame
```

Implications for the upgrade:

- **The unit of "applied edit" is one (layerId, atlas page) pair.**
  A whole-character "red hair" change becomes N separate entries in
  `layerTextureOverrides`, where N is the number of hair layers.
- **No cross-layer coordination.** Each blob is composited
  independently. If two blobs disagree about which red they chose,
  the atlas shows two reds.
- **The triangle clip is precise but blob-bound.** A blob can't
  paint outside its layer's UV triangles even if the prompt asks
  for it. Useful for atlas-neighbor safety; restrictive for
  "extend hair past current silhouette" edits.

## The AI generation pipeline

Entry: user opens GeneratePanel for a layer
([`components/GeneratePanel.tsx`](../components/GeneratePanel.tsx),
2634 LoC, the heaviest component in the codebase).

Phases:

1. **Mount** — extract three canvases for the chosen layer:
   - `aiSourceCanvasRef` — pre-mask, post-existing-edits. What we
     send to gpt-image-2 as `[image 1]`.
   - `previewSourceRef` — post-mask, post-edits. What the user sees
     in the SOURCE preview.
   - `originalSourceCanvasRef` — pristine, no edits. Used for "revert
     just this region".
2. **Region detection** — either manual regions from DecomposeStudio
   Split, or auto-detected via
   [`findAlphaComponents`](../lib/avatar/connectedComponents.ts).
   Each component gets its own preview thumbnail + prompt textarea.
3. **Submit** — `submitGenerate`
   ([`lib/ai/client.ts`](../lib/ai/client.ts):739 LoC) which:
   - Builds per-component source crops via
     `prepareOpenAISourcesPerComponent` (pads to 1024-multiple).
   - For each component, POSTs `/api/ai/generate` with image + mask
     + prompt + optional references.
   - Polls `/api/ai/status/[jobId]` for completion.
   - Post-processes the result via `postprocessGeneratedBlob`
     (alpha-enforces to the component's silhouette, crops back to
     source rect).
4. **Composite** — `compositeProcessedComponents` overlays all
   per-component results into one layer-sized blob.
5. **Apply** — `setLayerTextureOverride(layer.id, blob)` writes to
   editor store; `LayersPanel`'s useEffect dispatches to
   `adapter.setLayerOverrides`.

## Provider abstraction

`lib/ai/providers/`:

- **gemini.ts** — Google Gemini 2.5 Flash Image (nano-banana). Single
  image edit, no mask field, prompt-only conditioning.
- **openai.ts** — gpt-image-2 / gpt-image-1.5 / gpt-image-1 / dall-e-2
  via `/v1/images/edits`. Mask-aware (alpha=0 = edit zone),
  multi-image `image[]` for reference anchoring.
- **replicate.ts** — placeholder for SDXL ControlNet workflows.

Provider selection is hard-coded "gemini" by default; the UI
discovers availability via `/api/ai/providers` (which keys are set
in env).

## Prompt refinement (chat-LLM pre-pass)

[`/api/ai/refine-prompt`](../app/api/ai/refine-prompt/route.ts):
optional pre-pass that runs the user's raw prompt + source image
through gpt-4 (or similar) and asks it to rewrite the prompt as a
precise gpt-image-2 instruction. Reads attached references and
extracts concrete design elements ("the blue ribbon with white
trim in [reference 2]"). Toggle is on by default for OpenAI;
no-op for providers that don't take refs.

Refined prompts are cached per `userPromptForRefine` key so
iterating on the same prompt doesn't re-pay the chat-LLM cost.

## Reference image system

[`lib/avatar/useReferences.ts`](../lib/avatar/useReferences.ts) + IDB
`puppetReferences` table:

- Per-puppet "character anchors" the user uploads (typically the
  reference sheet or any image showing the character's intended
  look).
- Default-ON for every generate call; user can toggle individual
  refs OFF per-session.
- Ride along as additional `image[]` entries to gpt-image-2 (max 4
  references — OpenAI rate limit).
- The closest current thing to IP-Adapter; weak but real.

The "**use last result as reference**" toggle (`useLastResult`) adds
the previous succeeded generation to the reference set for the next
call. This is iterative-refinement-by-API.

## IDB schema (v7+)

[`lib/persistence/db.ts`](../lib/persistence/db.ts):

- `puppets` — Avatar metadata + thumbnail blob.
- `puppetFiles` — Original source files (zip / model3.json / etc.).
- `variants` — Named variants of an avatar (per layer override sets).
- `layerOverrides` — Mask + texture override blobs per layer.
- `visibilityMaps` — Per-layer visible/hidden state.
- `regionMasks` — Manual split-mode regions (id, name, color,
  maskBlob).
- `puppetReferences` — Reference images per puppet.
- `aiJobs` — Past AI submissions per layer (prompt, blob, model,
  timestamp).

The schema is layer-centric. Group-level state has no table.

## Editor UI surfaces

- **Library** ([`app/page.tsx`](../app/page.tsx)) — puppet list, drop
  zone, library card with rename / origin / [Baked] badge.
- **Edit page** ([`app/edit/[avatarId]/page.tsx`](../app/edit/[avatarId]/page.tsx)) — wraps adapter init,
  canvas, panels.
- **LayersPanel** — flat list of all layers, click to open
  DecomposeStudio (mask/split/paint) or GeneratePanel (AI).
- **DecomposeStudio** — three modes (Mask / Split / Paint), Photoshop-
  style toolbox, history panel (30 entries), wand action bar.
- **GeneratePanel** — per-layer AI edit, multi-region UX, history,
  references.

There is no surface for cross-layer operations.

## What this means for the upgrade

The architecture is **wide but flat**. We have rich per-layer
tooling and a clean adapter boundary; we have no concept of
groups, no concept of whole-character intent, no shared state
between simultaneous edits to related layers.

The upgrade adds layers above this (a semantic group layer, a
project-state layer for cross-layer intent, a multi-call
orchestrator) without rewriting the per-layer machinery. The
per-layer pipeline stays as the unit of work; the new infrastructure
is *what decides which units to run, in what order, with what
shared context*.

That framing keeps the surface area of the change bounded —
[09-phased-roadmap](09-phased-roadmap.md) details how.
