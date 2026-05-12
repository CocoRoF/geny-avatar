# 13 — Failure Modes and Evaluation

The catalog of ways each path can fail, the methodology for
measuring them, and the golden sets we evaluate against before
shipping each phase. Closes the loop on
[09-phased-roadmap](09-phased-roadmap.md) "Ship criteria".

If a phase ships without eval, we're shipping by vibe. This doc
is the rulebook that turns vibes into pass/fail.

## Why this matters more than usual

Most editor features have a clear pass test: did the edit happen,
did it persist, did it not crash. AI-driven editing has a fuzzy
pass test: did the result look right, did it look right across
20 drawables, did it look right at parameter extremes.

The fuzziness compounds: a result that looks right on first
glance can fall apart when animated. A multi-drawable edit that
looks coherent at the head-on pose can show seams at a 30° head
turn. Eval has to catch this **before** the user does.

## Golden sets

Three fixture sets, each chosen for a different stress test:

### Golden Set A: built-in samples (5 puppets)

The five canonical samples shipped with geny-avatar:

1. **Hiyori** (Live2D official) — ~80 drawables, well-organised.
2. **Mao Pro** (Live2D official) — ~140 drawables, complex.
3. **Mark** (Live2D official) — masculine, short hair, simpler.
4. **Natori** (Live2D official) — gradient hair, multi-color top.
5. **Nito-chan** (community) — hand-painted style, unusual rigs.

These are our regression set. Every phase must pass these before
shipping. They live under `public/samples/` and the eval suite
loads them directly.

### Golden Set B: BOOTH-sourced community (10 puppets)

Ten purchased Live2D models from BOOTH covering:

- VTuber commercial (3): well-rigged, well-documented.
- Indie commission (4): varying quality.
- Free / amateur (3): edge cases, unusual naming.

These test the **classifier and orchestrator** against the
real distribution of community-made models. They live in a
separate test fixtures folder gitignored from public clone but
available in the test env.

### Golden Set C: user-uploaded (variable)

Anonymised samples from real user uploads (with consent, opt-in
during onboarding). Captures the long tail of what people
actually edit. Refreshed quarterly; ≥20 puppets at all times.

## Failure mode catalog

Organised by which path produces it.

### A. Per-layer pipeline failures

These exist today (pre-upgrade) and are out-of-scope for this
project but listed for completeness.

| Mode | Cause | Detection | Mitigation |
|---|---|---|---|
| Seam bleed | Mask not eroded | Visual diff against original at atlas-island boundaries | Phase 1: erode 4-8 px |
| Identity drift | Underspecified prompt | LPIPS perceptual distance >threshold | Phase 1: stronger prompts |
| Alpha leakage | Provider returns white BG | Pixel-level check post-process | Already mitigated in `postprocessGeneratedBlob` |
| Empty result | Provider error | HTTP status / size check | Already retried |

### B. Tint failures (Phase 2)

| Mode | Cause | Detection | Mitigation |
|---|---|---|---|
| Wrong color on multi-color source | HSV math collapses gradients | Pixel histogram of post-tint vs target | Per-pixel HSV shift fallback |
| Shadows lost | multiplyColor compresses dark range | L* min of result < L* min of source by >20 | Add screenColor compensation |
| Saturated parts go fluorescent | Multiplier overflow | Saturation max >threshold | Cap multiplier per-channel |
| Wrong drawables affected | Classifier mis-grouped | User reassigns in review modal | Group review UX |
| Lock ignored | Bug | Test: locked drawable's multiplyColor unchanged | Explicit test in CI |

Eval method:

```ts
// For each puppet in Golden Set A:
for (const targetHue of [0, 60, 120, 180, 240, 300]) {
  applyTint(["hair_*"], { hue: targetHue, saturation: 0.8 })
  const result = renderToPng(adapter)
  const palette = extractPalette(cropToHair(result))
  assertHueWithin(palette.dominant, targetHue, tolerance: 15°)
  assertShadowsPreserved(result, originalRender, minLDelta: 20)
}
```

Pass threshold: 90% of (puppet × hue) combinations pass.

### C. Classifier failures (Phase 2)

| Mode | Cause | Detection | Mitigation |
|---|---|---|---|
| Wrong group | Parameter names insufficient | Manual review modal accuracy | User override; classifier learns from feedback |
| "other" overflow | No rule matched | % of "other" drawables per puppet | Lower confidence threshold |
| Group sprawl | Same item classified differently across drawables | Group cardinality > expected | Force same parent-deformer → same group |
| Locale failure | JP/CN names not matched | Per-locale accuracy | Add locale-aware tokenizers |

Eval method:

```
For each puppet in Golden Set A + B:
  Run classifier.
  Compare against hand-labeled ground truth.
  Compute accuracy per group (precision, recall, F1).

Target: ≥90% F1 on primary groups (hair_*, face_*, top, bottom)
        ≥75% F1 on secondary groups (accessory, footwear, etc.)
        ≤5% "other" rate per puppet
```

Hand-labeled ground truth: one engineer + one user (consented)
agree on the group for every drawable in 15 puppets. Stored
under `eval/groundtruth/`.

### D. Orchestrator failures (Phase 3)

These are the hard ones. Multi-call generation has compound
failure modes that single-call doesn't.

| Mode | Cause | Detection | Mitigation |
|---|---|---|---|
| Palette drift | Refs not anchoring strongly enough | CIEDE2000 variance across group >threshold | Stronger palette anchor in prompt; settle pass |
| Style drift | Anchor wasn't truly representative | LPIPS to anchor exceeds budget | Re-rank anchor selection |
| Wrong drawable as anchor | Visual prominence heuristic wrong | Manual review flagged | Tunable heuristic, user override |
| Cascade failure | One bad result poisons the chain | Anchor delta detection | Detect outlier results, exclude from refs |
| Cost overrun | Group too large | Pre-flight estimate | Plan stage shows cost; hard cap |
| Stall | Provider rate-limit / outage | Timeout per call | Retry with backoff, swap provider |
| Refs overflow | Group >10 drawables | Always (designed) | Reference rotation policy |

Eval methodology — **the palette variance test**:

```ts
// For each multi-part intent in eval set:
// Run orchestrator.
// For each group in the result:
//   palettes = drawables.map(d => extractPalette(d.result))
//   variance = pairwiseCIEDE2000Variance(palettes)
//   assertLessThan(variance, 15)
```

Baseline (independent generation): >40% variance.
Target (orchestrator): ≤15% variance.

The 15% number comes from human-perception studies: under that,
viewers perceive the group as "same outfit, slightly varied
parts". Over that, "different outfits stitched together".

[VERIFY] — calibrate this threshold once we have a measurement
infrastructure. May need to tighten to 10% or relax to 20%
depending on visual results.

### E. Animation failures (every phase)

The eval that catches the most subtle problems: **animate the
puppet at parameter extremes and check for visible seams,
content drift, or alpha leaks**.

Six standard extremes:

1. ParamAngleX = ±30° (head turn left/right)
2. ParamAngleY = ±30° (head tilt up/down)
3. ParamAngleZ = ±30° (head roll)
4. ParamBodyAngleX = ±10° (body lean)
5. ParamMouthOpenY = 1.0 (mouth open)
6. ParamEyeLOpen / ParamEyeROpen = 0.0 (eyes closed)

After every commit:

```ts
async function evalAnimationSafety(adapter, layerIds) {
  const renders = []
  for (const params of EXTREME_PARAM_SETS) {
    adapter.setParameters(params)
    renders.push(await adapter.renderToCanvas({ width: 1024 }))
  }
  // Check 1: any visible seam at clip-mask boundaries?
  // (Edge detection at expected boundary positions; flag spikes.)
  // Check 2: any unexpected alpha (transparency where there
  // shouldn't be)?
  // Check 3: does the edited region drift relative to the deformer
  // it's bound to?
}
```

If any extreme fails:

- Phase 2 (tint): roll back the tint, suggest per-drawable lock
  for the offender.
- Phase 3 (AI): mark the drawable for regen; surface to user
  with "this drawable looks broken at head-turn — regenerate?".
- Phase 4 (back-project): hard fail, fall back to Phase 3 path.

This check is mandatory before any user-visible commit. Slow but
catches the failure mode that user complaints most often surface.

### F. Intent parser failures (Phase 3)

| Mode | Cause | Detection | Mitigation |
|---|---|---|---|
| Wrong intent type | Ambiguous wording | Eval set classification accuracy | Plan stage shows parsed intent; user can correct |
| Hallucinated groups | Model invented a group | Schema validation | Zod schema rejects invalid enums |
| Missing groups | Underspecified target | Eval set recall per group | Stronger system prompt; few-shot examples |
| Wrong language | User wrote in JP | Locale detection | Send `lang` field to parser |
| Refusal | Model refuses (e.g. "nudity") | Empty response | Surface refusal politely; offer rephrase |

Eval method — **the 50-prompt set**:

A hand-crafted set of 50 prompts covering:

- 20 tint prompts (5 colors × 4 groups).
- 15 ai-multipart prompts (uniforms, outfits, hair styles).
- 10 ai-region prompts (single drawable adds/changes).
- 5 compound prompts.

Each labeled with the expected `(intent, targetGroups, …)`.
Parser pass = matches expected on intent + at least one of the
expected targetGroups. Target: 95% pass.

### G. Render-and-project failures (Phase 4)

| Mode | Cause | Detection | Mitigation |
|---|---|---|---|
| Pixel→atlas miss | Triangle lookup bug | Spike harness pixel-mapping test | Geometry library hardening |
| Rotation ambiguity | Atlas rotation flag dropped | Diff output at rotation 90°/180°/270° | Explicit rotation transform in mapping |
| Occlusion conflict | Two drawables overlap in image space | Z-ordering test | Painter's algorithm + manual override |
| Resolution mismatch | Output res ≠ atlas res | Scale factor in mapping | Per-drawable scale derivation |
| Animation breaks | Render is canonical pose, edits applied at extreme | Animation eval (E) | Hard requirement: must pass extreme tests |

The spike (Phase 4 week 1) targets exactly these. If the spike
shows pixel→atlas misses >5% of drawables in the target group
on Hiyori, the phase is deferred.

## Eval pipeline architecture

The eval infrastructure runs:

```
┌──────────────────────────────────────────────────────────┐
│  eval/runner.ts                                          │
│  ────────────                                             │
│  For each puppet in Golden Sets A/B:                     │
│    For each test (tint, intent, animation, …):           │
│      Apply edit, capture renders, run assertions.        │
│  Output: JSON report + PNG diffs.                        │
│                                                          │
│  CI step: fail if any phase-specific gate fails.          │
└──────────────────────────────────────────────────────────┘
```

Lives under `eval/` in the repo. Runs:

- Locally: `pnpm eval --phase=2`
- CI: nightly on `main`; on every PR that touches `lib/avatar/`
  or `lib/ai/`.
- Pre-release: full suite (A+B+C) before each phase ships.

Results dashboard: HTML report under `eval/reports/<timestamp>/`
with side-by-side originals/results, palette analysis, animation
extreme renders. Engineer reviews before approving release.

## Metrics — quantitative

Beyond pass/fail, we track quantitative metrics per phase:

| Metric | Target | How measured |
|---|---|---|
| Seam bleed rate | <1% | Visual inspection of atlas-boundary pixels |
| Palette variance (group) | <15 CIEDE2000 | Pairwise distance across group |
| Classifier F1 (primary groups) | >0.90 | vs hand-labeled ground truth |
| Intent parser accuracy | >0.95 | vs 50-prompt eval set |
| Cost per session (mixed) | <$1 | Provenance log sum |
| Latency: tint commit | <100 ms | Wall time client-side |
| Latency: AI single | <30 s | Wall time end-to-end |
| Latency: AI orchestrator | <5 min | Wall time end-to-end |
| Animation seam rate at extremes | <1% | Automated edge detection |

These are tracked over time as code evolves. Regression on any
metric blocks merge.

## Metrics — qualitative

Three areas where we collect human judgement, not just numbers:

### Visual quality A/B

After every phase ships, run 20 edits via the new path AND via
the previous path. Show side-by-side to 5 reviewers (engineering
+ designers + 2 external users). Reviewers pick "left", "right",
or "tie".

Phase ships only if the new path wins ≥70% of side-by-sides
(excluding ties).

### User feedback log

After every commit-level edit in the UI, prompt (1 in 20 rate):

> Was this edit what you wanted? (👍 / 👎 / skip)

Aggregated per session, per intent type. Below 60% 👍 in a week
→ investigation.

### Reviewer panels

For Phase 3 and Phase 4 readiness, before public ship, run a
2-week beta with 10 users sampling real workflows. Collect
written feedback. Block ship on any unanimous "this is worse
than before" finding.

## Eval anti-patterns

What we deliberately avoid:

- **Cherry-picking results.** Every eval run captures ALL test
  results, including failures. Reports never hide bad output.
- **Tuning to the eval set.** Golden Sets A and B are stable
  references; we resist the urge to add a prompt to the parser
  every time a specific eval prompt fails. Instead, fix the
  parser more broadly, then verify the eval prompt now passes.
- **Vanity metrics.** "Latency improved 20%" without "did it
  improve user-perceived quality?" is meaningless. Pair every
  perf metric with a quality metric.
- **"Looks good to me" sign-off.** All eval results are written
  to disk. PR descriptions cite the eval report URL.

## Failure mode response playbook

When a new failure mode is reported in production:

1. **Capture the puppet + prompt + result.** With user consent,
   add to Golden Set C.
2. **Reproduce locally.** If we can't repro, the bug doesn't
   exist for our purposes.
3. **Categorise.** Match to the catalog above; if new, add a row.
4. **Patch.** Mitigation goes in code; eval gets a regression
   test.
5. **Verify the patch passes the regression test AND doesn't
   regress the rest of Golden A+B.**
6. **Ship.**

This is the standard bug lifecycle, but with eval as the contract
that prevents re-occurrence.

## Open eval questions

- **[OPEN]** Are the 6 parameter extremes enough? Some models
  have hundreds of parameters; we can't enumerate. Suggest:
  add 6 more after Phase 2 ships based on what user-reported
  bugs occur at.
- **[OPEN]** CIEDE2000 thresholds are perceptual but eyeballed.
  Should we run a psychophysical study to calibrate? Probably
  overkill; the 15-point threshold is consistent with
  published values. Re-evaluate if reviewers say results look
  "fine but score bad" or vice versa.
- **[OPEN]** How to eval the intent parser without burning
  budget? Each eval run is 50 API calls × parser cost. Solve
  by caching parser responses by prompt hash; only re-run when
  prompt or schema changes.
- **[OPEN]** When Phase 4 ships, the back-project path produces
  visually different results from the orchestrator. Do we hold
  both paths to the same eval gates, or accept that they have
  different visual characteristics? Suggest: same numeric gates;
  visual A/B picks the winner per intent class.
