# 12 — UX Flow

The new user journeys enabled by the architecture in
[08-recommended-architecture](08-recommended-architecture.md).
Maps to the phased rollout in
[09-phased-roadmap](09-phased-roadmap.md).

This is not a visual design spec — that lives in Figma. This doc
captures the *shape* of each flow: entry point, decisions, exits,
error states. The job is to make sure the architecture supports
the actual user behaviour without surprise gaps.

## The four flows

| Flow | Phase | Headline action |
|---|---|---|
| Tint | 2 | "make her hair red" — one slider drag |
| Intent | 3 | "give her a school uniform" — one sentence |
| Per-layer (existing) | n/a | regenerate one drawable, fine control |
| Render-and-project | 4 | character-level edit (gated on spike) |

The existing per-layer flow does not disappear. It remains the
power-user surface for surgical edits. The new flows are
additions, not replacements.

## Flow 1: tint (Phase 2)

**Entry**: user opens a puppet, sees a new "Groups" tab in the
LayersPanel.

```
┌─────────────────────────────────────────────────────────┐
│ Layers     Groups                                        │
│ ─────────┌──────┐──────────────────────────────────────  │
│           │ Active │                                      │
│           └──────┘                                       │
│                                                          │
│  ▸ hair           (24 drawables)        [tint][lock]    │
│  ▸ face           (8 drawables)         [tint][lock]    │
│  ▸ eyes           (6 drawables)         [tint][lock]    │
│  ▸ mouth          (3 drawables)         [tint][lock]    │
│  ▸ top            (5 drawables)         [tint][lock]    │
│  ▸ bottom         (2 drawables)         [tint][lock]    │
│  ▸ accessory      (4 drawables)         [tint][lock]    │
└─────────────────────────────────────────────────────────┘
```

Click `[tint]` on `hair` → opens the tint panel:

```
┌─────────────────────────────────────────────────────────┐
│ Tint: hair (24 drawables)                       [×]     │
│ ────────────────────────────────────────────────────────│
│                                                          │
│  Hue        ◯────────────●────────────  120° (green)    │
│  Saturation ◯─────────●───────────────   60%            │
│  Lightness  ◯───────●─────────────────   45%            │
│                                                          │
│  [reset]                              [revert] [commit] │
│                                                          │
│  ◰ Color-pick from preview                              │
│  ◰ Sample from reference image                          │
└─────────────────────────────────────────────────────────┘
```

Behaviour:

- Drag any slider → `applyTint` runs on every member drawable.
  Result is **instant** — no AI call, no network.
- Preview canvas updates in real time. Live2D parameters stay
  animated; tint follows.
- `[revert]` restores the multiplyColor to (1,1,1) on all
  members.
- `[commit]` writes the tint as an `editProvenance` record with
  `source: "tint"`. Until commit, the tint is session-only.

Edge cases:

- A drawable with `groupLocked = true` (per-drawable lock) is
  skipped silently. A small "L" badge appears next to the
  drawable in the LayersPanel.
- If `baselineHsv` isn't computed yet (first-time on a puppet),
  the panel shows a brief "analyzing palette…" state (≤500 ms
  on Hiyori-class puppets, see [03](03-live2d-anatomy.md)).
- Edits combine: tint + AI on same drawable both apply; AI
  texture is the base, tint is on top via multiplyColor.

Failure modes:

- Tint math fails on multi-color source (gradient hair) →
  fallback to per-pixel HSV shift (slower, still no network).
  See [13](13-failure-modes-and-eval.md) "Tint failures".

## Flow 2: group review modal (Phase 2)

**Entry**: first time a puppet is opened under v8 (the
migration sets a session flag).

```
┌─────────────────────────────────────────────────────────┐
│ Review groups for "Hiyori"                              │
│ ────────────────────────────────────────────────────────│
│  We classified each drawable into a semantic group.      │
│  Review and reassign as needed.                          │
│                                                          │
│  hair         24 ✓     →   ▼ hair_front                  │
│                                                          │
│  ──── drawables ────                                     │
│  ArtMesh_47   "hair_a"      ●○○ confidence: 0.88        │
│               group:        [hair_front       ▼]        │
│                                                          │
│  ArtMesh_48   "hair_b"      ●●○ confidence: 0.62 ⚠      │
│               group:        [hair_front       ▼]        │
│                                                          │
│  ArtMesh_120  "ribbon"      ●●● confidence: 0.31 ⚠      │
│               group:        [accessory        ▼]        │
│                                                          │
│  [skip]                              [save & continue]  │
└─────────────────────────────────────────────────────────┘
```

Behaviour:

- One row per drawable, grouped by semantic group.
- Low-confidence rows highlighted (⚠).
- Dropdown lets user reassign individual drawables.
- `[skip]` accepts classifier output and dismisses modal. User
  can re-open from Settings.
- `[save & continue]` commits user overrides, sets
  `groupReviewSeen: true`.

If the classifier marked every drawable as "other" (failure
mode), the modal shows a banner: "We couldn't classify this
character. Please assign groups manually or contact support."

**Design principle**: never block editing on group review.
Editing works (per-layer) even if groups are wrong; groups are
optional metadata layered on top.

## Flow 3: intent input (Phase 3)

**Entry**: a prominent input bar at the top of the editor, with
placeholder "describe what you want to change…".

```
┌─────────────────────────────────────────────────────────┐
│ 🎨  describe what you want to change…             [Go]   │
│  ▸ Recent: "make hair red", "school uniform", "wet leather"
└─────────────────────────────────────────────────────────┘
```

User types `"give her a school uniform"` and presses Go.

```
┌─────────────────────────────────────────────────────────┐
│ Parsing intent…                                         │
└─────────────────────────────────────────────────────────┘
```

Intent parser returns; UI shows the parsed plan before running:

```
┌─────────────────────────────────────────────────────────┐
│ Plan                                            [Cancel]│
│ ────────────────────────────────────────────────────────│
│  Edit type:    AI multi-part                            │
│                                                          │
│  Affected groups (11 drawables total):                  │
│    ▸ top         5 drawables                            │
│    ▸ bottom      2 drawables                            │
│    ▸ accessory   4 drawables (ribbon, collar, button…)  │
│                                                          │
│  Style:        Japanese schoolgirl uniform, navy blazer  │
│                over white sailor blouse, red ribbon,     │
│                pleated dark blue skirt with subtle plaid │
│                                                          │
│  Estimated:    11 AI calls · ~3 min · ~$0.20            │
│                                                          │
│  [Edit plan]                                  [Run]     │
└─────────────────────────────────────────────────────────┘
```

The plan stage is **mandatory**. It addresses the "AI runs
$2 worth of calls before I notice" failure mode. User can edit:

- Click a group to remove/add it.
- Edit the style prompt before running.
- Reduce iterations (the orchestrator does N anchor passes).

`[Run]` starts the orchestrator. UI flips to progress view:

```
┌─────────────────────────────────────────────────────────┐
│ Generating school uniform                       [Stop]  │
│ ────────────────────────────────────────────────────────│
│  [████████░░░░░░░░░░░░░░░░░░░░] 3 / 11    estimate 2min │
│                                                          │
│  ✓ top  shirt_a       anchor       ✓ palette extracted  │
│  ✓ top  shirt_b                    ⚠ retried (low conf) │
│  ⟳ top  jacket_a      gpt-image-2  …                    │
│  ⋯ top  jacket_b                                         │
│  ⋯ top  collar                                           │
│  ⋯ bottom skirt_main                                    │
│  ⋯ bottom skirt_pleat                                   │
│  ⋯ accessory ribbon                                     │
│  ⋯ accessory button_a                                   │
│  ⋯ accessory button_b                                   │
│  ⋯ accessory tie                                        │
│                                                          │
│  preview ▼                                              │
│  ┌───────────────────────────────┐                      │
│  │ [live composite preview]      │                      │
│  │ updates as each drawable      │                      │
│  │ completes                     │                      │
│  └───────────────────────────────┘                      │
└─────────────────────────────────────────────────────────┘
```

Behaviour:

- Each drawable's status updates live (queued → running →
  done/failed).
- `[Stop]` halts the orchestrator; already-completed drawables
  stay; in-flight one is cancelled mid-call (provider permitting).
- Preview composite re-renders after each completed drawable —
  user sees the character changing in real time.

After all complete, the **per-group review** appears:

```
┌─────────────────────────────────────────────────────────┐
│ Review                                                   │
│ ────────────────────────────────────────────────────────│
│  ▸ top              ●●●●●          [accept][regen][edit]│
│      [thumbnail of just-the-top drawables composed]      │
│                                                          │
│  ▸ bottom           ●●            [accept][regen][edit] │
│      [thumbnail of skirt]                                │
│                                                          │
│  ▸ accessory        ●●●●          [accept][regen][edit] │
│      [thumbnail of ribbon, buttons, tie]                 │
│                                                          │
│  [Accept all]                            [Discard all]  │
└─────────────────────────────────────────────────────────┘
```

Per-group:

- `[accept]` → commits this group's overrides + provenance.
- `[regen]` → reruns the orchestrator for this group only; uses
  prior result as a negative anchor ("not like the previous
  attempt, but…" prompt template).
- `[edit]` → opens the group's drawables in per-layer mode for
  fine-tuning. Same surface as today's GeneratePanel/decompose
  studio.

User can mix: accept top + bottom, regen accessory, then come
back and accept.

## Flow 4: per-layer (existing, unchanged)

The current GeneratePanel + decompose studio surfaces continue
to exist. They are reached from:

- LayersPanel → click a layer → "Edit this layer" → opens
  per-layer GeneratePanel.
- Intent flow → review → `[edit]` on a group → opens decompose
  studio with the group's layers preselected.

No behavioural changes. The new orchestrator is a *driver* over
this surface, not a replacement. Power users iterate per-layer
exactly as today.

## Flow 5: render-and-project (Phase 4, gated)

**Entry**: alongside the intent input bar, a "🎭 Character
mode" toggle.

```
┌─────────────────────────────────────────────────────────┐
│ 🎨  describe…     🎭 Character mode: ON         [Go]   │
└─────────────────────────────────────────────────────────┘
```

When Character mode is on, the dispatcher routes appropriate
intents through render-and-back-project (Phase 4 path) instead
of the orchestrator. The user sees a different progress UI:

```
┌─────────────────────────────────────────────────────────┐
│ Character edit                                  [Stop]  │
│ ────────────────────────────────────────────────────────│
│  ▸ Rendering canonical pose…           ████████░ 90%   │
│  ▸ AI editing character…               ⋯               │
│  ▸ Back-projecting to atlas pages…     ⋯               │
│  ▸ Composing per-drawable overrides…   ⋯               │
└─────────────────────────────────────────────────────────┘
```

Behaviour after completion is identical to flow 3's review:
per-group accept/regen/edit, with one extra option **"Use
orchestrator instead"** that retries via the Phase 3 path. This
lets A/B comparison drive the path decision over time.

Character mode hidden until Phase 4 spike succeeds and ships.

## Cross-flow conventions

These behaviours apply to every flow:

### Locking

A small lock icon appears next to:

- Every group in the Groups tab → group-level lock.
- Every drawable in the LayersPanel → per-drawable lock.

Clicking toggles the lock. Locked items are skipped by group
operations, including the intent flow, with a one-line warning:
"3 locked drawables in 'accessory' were not edited."

### Provenance badges

Every layer shows badges in the LayersPanel:

- `[AI]` — last edit was AI-generated.
- `[paint]` — hand-paint.
- `[mask]` — mask edited.
- `[tint]` — tint applied (on top of texture).
- (no badge) — original baked texture, no edits.

Hover → tooltip with last edit metadata. Click → opens the
provenance pane (read-only audit log).

### Cost feedback

After each AI flow completes, the editor shows a small toast:

```
This edit used 11 AI calls · ~$0.18 spent. Session total: $0.74
```

Sticky in the session indicator at the top of the editor. Helps
users build intuition for the cost of operations.

### Failure recovery

If an AI call fails mid-orchestrator-run:

- The drawable is marked failed in the progress UI.
- The orchestrator continues with subsequent drawables.
- On review, failed drawables show `[retry]` instead of
  `[accept]`. Retry uses the most-recent successful prior
  result as the new anchor (skipping the failed one entirely).

If a tint operation fails (math edge case, e.g. all-black
drawable):

- Falls back to per-pixel HSV shift via worker.
- If that fails, the drawable is excluded with a warning;
  user can manually open it in paint mode.

### Undo across flows

The history pane (added in the Phase 6 editor upgrade) extends
to support group-level undo:

```
┌──────────────────┐
│ History (30 max) │
│ ──────────────── │
│  ●  School uniform (group: top+bottom+accessory)  ← now
│  ○  Hair tint → red                                
│  ○  Paint: shirt collar                            
│  ○  Mask: eyes                                     
│  ○  School uniform (group: top+bottom+accessory)   ← redo to
│  ○  AI: face_blush                                  
│   ...                                              
└──────────────────┘
```

Each entry is one atomic commit. Group-level edits collapse
into a single entry; click to expand and undo individual
drawables. Ctrl+Z / Ctrl+Shift+Z scope to current view (group
or per-layer).

## UX risks

- **Cognitive load on group review**: classifying 80 drawables
  one-by-one is exhausting. Mitigation: smart defaults, hide
  high-confidence rows behind a "show all" toggle.
- **Intent ambiguity surprises**: "make her hair shiny" — is
  that tint, AI, or both? The parser must surface this when
  confidence is low: "I read this as a material change (AI).
  Try 'increase shine' for a tint-only adjustment."
- **Wait-time UX**: 3 minutes is a long time staring at a
  progress bar. Mitigation: live composite preview, sounds,
  optional desktop notification when complete.
- **Cost shock**: a user types "regenerate everything" and gets
  a $4 bill. Mitigation: plan-stage cost estimate is mandatory;
  default session cap is $5, opt-in to raise.
- **Lock confusion**: three lock concepts (layer hidden, group
  locked, drawable locked) is a lot. Mitigation: collapse the
  UI to just "lock this" with a clear scope indicator. Internal
  data model can stay three-way.

## Open UX questions

- **[OPEN]** Should the plan stage be skippable by power users
  with a "skip plan for next 10 minutes" toggle? Yes for speed;
  no for cost protection. Default: never skip first time per
  session, allow per-session opt-in after.
- **[OPEN]** Should the orchestrator surface a "live cost
  counter" during progress, or only post-completion? Live
  counter prevents surprise but is anxiety-inducing.
- **[OPEN]** When a group review accepts only some groups, what
  happens to the half-applied state? Commit the accepted ones
  immediately, leave the rejected ones discardable.
- **[OPEN]** Should tint be reversible per-session (multiplyColor
  back to identity) or only at the next commit? Argument for
  session-only: instant revert. Against: confusion with paint
  undo. Default: session-only revert *and* a separate
  Ctrl+Z entry per slider commit.
