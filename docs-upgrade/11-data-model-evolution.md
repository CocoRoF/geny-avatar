# 11 — Data Model Evolution

How the persistence layer evolves from v7 (current) to v8 (Phase 2)
and onward to support semantic groups, provenance, and locking.
Designed to land without breaking any existing user's saved data.

Cross-references [08-recommended-architecture](08-recommended-architecture.md)
for the domain shapes and [09-phased-roadmap](09-phased-roadmap.md)
for the phase that ships each schema bump.

## Current state — IDB v7

The existing IndexedDB schema, as of geny-avatar v0.3.x:

```
DATABASE: geny-avatar
VERSION: 7

OBJECT STORES:
  puppets           keypath: id (uuid)
  puppetAssets      keypath: id  (binary: .moc3, .model3.json,
                                  textures, atlases)
  layerOverrides    keypath: [puppetId, layerId]
  sessions          keypath: id
  presets           keypath: id
  thumbnails        keypath: puppetId
  recentProviders   keypath: providerId
```

`layerOverrides` records hold the AI / paint / mask edits per
drawable. They are the canonical pixel-level edit store today.

Key invariant: the schema is **purely additive** within
`puppetAssets`. Original baked assets are immutable; all edits
ride on `layerOverrides` records keyed by `[puppetId, layerId]`.

## Target state — IDB v8 (Phase 2)

```
DATABASE: geny-avatar
VERSION: 8

OBJECT STORES:
  puppets           (unchanged)
  puppetAssets      (unchanged)
  layerOverrides    (unchanged + new optional fields)
  sessions          (unchanged)
  presets           (unchanged)
  thumbnails        (unchanged)
  recentProviders   (unchanged)

  semanticGroups        ← NEW
    keypath: [puppetId, groupId]
    fields: { puppetId, groupId, semanticGroup, displayName,
              locked, color, lastEditAt }

  layerSemantics        ← NEW
    keypath: [puppetId, layerId]
    fields: { puppetId, layerId, semanticGroup, confidence,
              source: "classifier" | "user", locked }

  editProvenance        ← NEW
    keypath: [puppetId, layerId, generation]
    fields: { puppetId, layerId, generation, source, model,
              prompt, refs, palette, timestamp,
              parentGeneration }

  canonicalPoseRender   ← NEW
    keypath: [puppetId, version]
    fields: { puppetId, version, blob, generatedAt,
              parametersHash }
```

Four new object stores; zero changes to existing stores beyond
optional fields on records the migration writes for the first
time.

### Why separate stores, not embedded fields?

Putting `semanticGroup` on `Layer` directly works in memory but
is the wrong shape for IDB. Reasons:

1. **Layer is derived.** `Layer` records exist in memory from
   parsing `.moc3` + `model3.json`; they're not the persistence
   primitive. Persistence is on `layerOverrides` keyed by layer
   id, which is itself a derived stable id.
2. **Group membership is mutable.** Users can reassign; we want
   that mutation independent of the override record.
3. **Group locking is a UI concept.** Belongs in its own store
   so we can lock/unlock without rewriting overrides.
4. **Provenance grows linearly.** Each edit appends; embedding
   would bloat the override record.

Separation pays off in writes, queries, and migration safety.

## Layer record extension

In memory (not IDB-persisted; rebuilt from `layerSemantics`):

```ts
type Layer = {
  // ... existing fields from v0.3.x
  id: LayerId
  partIndex: number
  drawableIndex: number
  partId: string
  drawableId: string
  baselineHsv?: { h: number; s: number; v: number }  // NEW Ph2
  semanticGroup?: SemanticGroup                       // NEW Ph2
  groupConfidence?: number                            // NEW Ph2
  groupSource?: "classifier" | "user"                 // NEW Ph2
  groupLocked?: boolean                               // NEW Ph2
  bakedHidden?: boolean                               // existing
}
```

`baselineHsv` is the histogram-derived dominant HSV of the
drawable's original texture. Computed once at import and cached
on the in-memory `Layer`. Used by the tint math (see
[08](08-recommended-architecture.md) tint path).

## Migration strategy v7 → v8

On first open of an existing puppet under v8:

```ts
async function migrateV7toV8(db: IDBDatabase) {
  // 1. Open the new stores (Dexie or raw IDB upgrade handler).
  // 2. For each puppet:
  //    a. Run the classifier (lib/avatar/groupClassifier.ts)
  //       → produces { layerId: { group, confidence } } map.
  //    b. Bulk-insert into layerSemantics with
  //       source: "classifier".
  //    c. For each distinct group in the result, create a
  //       semanticGroups record with locked: false.
  //    d. Compute baselineHsv for each layer (histogram k-means
  //       on the original atlas crop). Store on the in-memory
  //       Layer; not persisted (recomputable on next open).
  // 3. Set a session flag: shouldShowGroupReviewModal = true.
  //    First time the user opens this puppet's editor, the
  //    review modal pops up.
  // 4. Do NOT modify any existing record.
}
```

Migration is **idempotent and one-way per version bump**. Running
the migration twice yields the same end state. Migrations from
older versions chain through intermediates; there is no
"downgrade" path.

### Failure handling

If the classifier crashes mid-migration:

- Records already written stay (idempotent).
- The session flag stays set so the review modal fires.
- An entry is written to a new `migrationLog` store (we will add
  this in v8 as well) with the error and the layer where it
  failed.
- The user can continue with partial group assignments; remaining
  layers default to `"other"` and the modal highlights them.

We never roll back a partial migration. Roll-forward only.

## Provenance write shape

Every edit — AI, paint, mask, tint, even import — writes a
provenance record:

```ts
type EditProvenance = {
  puppetId: string
  layerId: LayerId
  generation: number              // monotonic per layer
  source:
    | "import"                    // initial baked
    | "ai"                        // generate-path result
    | "tint"                      // multiplyColor edit
    | "user-paint"                // paint mode commit
    | "user-mask"                 // mask edit commit
    | "user-override"             // manual texture replace
  model?: ProviderId              // AI only
  prompt?: string                 // AI only
  refs?: string[]                 // AI only; ref slot descriptors
  palette?: string[]              // AI: extracted dominant hexes
  timestamp: number               // Date.now()
  parentGeneration?: number       // redo/undo chain root
  intentRequestId?: string        // ties to intent layer
  bytesAdded?: number             // size of override delta
}
```

Generation counter increments per layer per commit. The `parentGeneration`
field threads the redo/undo chain: when the user undoes a paint
edit and then paints differently, the new edit's
`parentGeneration` points to the generation it forked from. The
history reads as a tree, not a list — supports branching even
though the UI only shows linear undo.

UI surfaces a per-layer provenance badge in the LayersPanel:

```
[AI] [hand-paint] [tint]   ← badges
```

Hover → tooltip showing generation count, last edit time, last
model used. Click → opens the provenance pane.

## Canonical pose render cache

The full-puppet canonical render (image[2] in every AI call)
gets its own store:

```ts
type CanonicalPoseRender = {
  puppetId: string
  version: number          // bumps when overrides change
  blob: Blob               // PNG, ~1024 wide
  generatedAt: number
  parametersHash: string   // hash of all params at default
  overridesHash: string    // hash of all current overrides
}
```

Versioning: the render is invalidated when the override set
changes (because the puppet looks different now). We don't
auto-regenerate — the next AI call that needs it triggers a
regen. This keeps the cost bounded.

`parametersHash` exists because the "canonical pose" definition
might shift (e.g. user picks a different rest position). If the
hash differs from cached, regen.

[VERIFY] — Pixi-live2d-display's `renderToCanvas`/equivalent is
not officially documented; the existing thumbnail pipeline uses
the same trick. Inspect `lib/avatar/thumbnails.ts` to confirm
adaptation cost.

## Layer override extensions (no new store)

`layerOverrides` records gain optional fields:

```ts
type LayerOverride = {
  puppetId: string
  layerId: LayerId
  blob: Blob               // existing — the override texture
  mask?: Blob              // existing — mask channel
  bakedAt?: number         // existing
  // NEW v8
  lastEditSource?:
    | "ai" | "tint" | "user-paint" | "user-mask" | "user-override"
  lastEditAt?: number
  lastProvenanceId?: string  // → editProvenance key
  isAtomicWithGroup?: string // group id when this edit was part
                             // of an orchestrator run (so undo
                             // can revert the whole group)
}
```

The `isAtomicWithGroup` field is the key to "undo this whole
school uniform" — orchestrator runs tag every layer with a
shared group id. Undo recognises the id and offers
"undo individual" vs "undo group".

## Sessions store extension

`sessions` records (in-memory user session state, persisted on
exit) gain:

```ts
type Session = {
  // ... existing fields
  // NEW v8
  groupReviewSeen?: boolean  // suppress modal after first dismiss
  lastUsedIntents?: string[] // recent intents for autocomplete
  intentBudgetSpent?: number // current-session cost ($)
}
```

Per-puppet not per-user; users may want different histories per
character.

## Phase 3 schema additions (planned)

When the intent layer + orchestrator ship, we add:

```
OBJECT STORE: intentRequests
  keypath: id (uuid)
  fields: { puppetId, rawText, parsed: IntentRequest,
            startedAt, completedAt, status,
            providerCalls: Array<{ provider, prompt, refsHash,
                                   tokens, costEstimate }> }
```

One record per high-level intent. Children: the per-drawable
generate calls that fan out from the intent. Joined to
`editProvenance.intentRequestId`.

This makes "how much did 'give her a uniform' cost me?" a single
query: sum `costEstimate` over the intent's `providerCalls`.

## Phase 4 schema additions (planned, deferred)

The render-and-back-project path adds:

```
OBJECT STORE: backProjections
  keypath: [puppetId, intentRequestId]
  fields: { puppetId, intentRequestId, fullRender: Blob,
            uvMapVersion, perDrawablePatches: Map<LayerId, Blob>,
            occlusionMap, computedAt }
```

We don't commit to this until the spike in Phase 4 succeeds.

## Backward compatibility commitments

The schema strategy:

- **Read-time tolerance.** Older record shapes always
  deserialize; missing fields take defaults.
- **Write-time enrichment.** New writes include new fields; old
  writes don't. Migrations enrich on next access.
- **No destructive reads.** A v8 client reading a v7-shaped
  record never deletes/replaces it just to "upgrade" — it adds
  alongside.
- **No silent format change.** PNG blobs stay PNG; texture slot
  conventions stay identical. New stores don't repurpose old
  ones.

This is the same posture as the v3 → v4 → v7 progression. Every
prior version's puppets continue to open and edit cleanly.

## IDB size budget

Rough estimate per puppet:

- `puppetAssets`: 10–80 MB (textures + .moc3) — dominant.
- `layerOverrides`: 0–N × 200 KB per drawable touched.
- `layerSemantics`: ~80 records × 200 B = 16 KB per puppet.
  Negligible.
- `editProvenance`: 1 KB per edit. 1000 edits = 1 MB.
- `canonicalPoseRender`: ~500 KB per regen, cached single.
- `semanticGroups`: ~10 records × 100 B = 1 KB. Negligible.

Per-puppet total under heavy editing: ~50 MB textures + 5 MB
overrides + 5 MB provenance. Within IDB quota (browser quotas
are 10s of GB on desktop).

GC policy: prune `editProvenance` older than 90 days *unless*
the record's generation is referenced by a currently-active
override. Keep canonical renders to one version per puppet.
Implemented as a background sweep on session start.

## Export format extension

The puppet export bundle (`.gnyp` zip — geny-puppet format)
gains files:

```
puppet.gnyp/
  manifest.json               ← existing; bumped to v2 schema
  puppet/                     ← existing
    *.moc3, *.model3.json, atlas pages
  overrides/                  ← existing
    {layerId}.png
  semantics.json              ← NEW v8: layer→group, locks
  provenance.json             ← NEW v8: edit history sidecar
  README.txt                  ← NEW v8: human-readable audit
```

`README.txt` is the cultural-respect lever: a plain-text summary
of which drawables were AI-edited, which models, when. Artists
opening someone else's exported puppet can see the audit trail
in plain English.

## Open data-model questions

- **[OPEN]** Should `editProvenance` be encrypted at rest? Some
  prompts contain user PII ("a portrait of my dog Spot…"). IDB
  is per-origin sandboxed but not encrypted. Defer pending
  privacy review.
- **[OPEN]** When a puppet is duplicated ("save as"), do we copy
  the entire provenance log? Suggests yes (full audit), but
  it doubles storage. Default: yes; user can prune manually.
- **[OPEN]** Migration timing: classifier runs on first open of
  each puppet under v8. For a user with 50 puppets, that's 50
  classifier runs. Run lazily (per-puppet on open) or eagerly
  (background on app start)? Lazy seems right; verify perceived
  perf.
- **[OPEN]** Should we add a `bakedHash` field to puppetAssets
  records so the migration can detect "this puppet has been
  re-baked from source" and re-run the classifier? Adds
  robustness, costs one hash per import.
