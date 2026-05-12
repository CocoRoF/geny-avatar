/**
 * Provider routing policy.
 *
 * Pure function over a small descriptor. Given a generate request's
 * shape — how many drawables it touches, whether it's the user's
 * decisive iteration vs a bulk fan-out, what providers are available
 * — picks the right provider id to dispatch with.
 *
 * Lives separately from `GeneratePanel` so the Phase 3 orchestrator
 * can reuse the same policy when fanning out per-drawable calls. The
 * panel today calls into it for single-drawable submits; the
 * orchestrator (Phase 3) will call it once per drawable in a group
 * run, layering `isDecisive` / `isBulkFanout` from the orchestrator's
 * own scheduling rather than from user UI state.
 *
 * Routing rules (Phase 1 v0):
 *   - User explicitly picked a provider → respect it (router off).
 *   - Single-drawable edit + decisive iteration → openai (literal).
 *   - Bulk fan-out (>=4 drawables, or orchestrator-flagged) → falai
 *     (cheap, fast). Falls back to openai when FAL_KEY missing.
 *   - Mixed / unknown → openai (the safer default).
 *
 * NOT a hot-swap: callers must decide once at submit time. The
 * router doesn't observe runtime cost / latency to re-route mid-job.
 */

import type { ProviderId } from "./types";

export type RoutingContext = {
  /** How many drawables this submit touches. 1 for a single layer,
   *  N for a multi-component OpenAI run, K for a Phase 3 orchestrator
   *  group fan-out. */
  drawableCount: number;
  /** True when the user is iterating to find a "good" result on this
   *  specific edit — favours literal providers (openai). False during
   *  bulk runs where individual quality matters less than coherent
   *  palette across a group. */
  isDecisive: boolean;
  /** Set by the orchestrator (Phase 3) for the per-drawable fan-out
   *  calls that follow the anchor. Forces cheap-provider preference
   *  regardless of drawableCount. */
  isBulkFanout: boolean;
  /** Provider availability snapshot — the set of providers whose env
   *  key is currently set. Router never returns an unavailable id;
   *  falls back gracefully. Server-side caller passes this in. */
  available: ReadonlySet<ProviderId>;
  /** When the user picked a provider explicitly (non-default), the
   *  router yields. Pass `undefined` to engage routing. */
  userPick?: ProviderId;
};

export type RoutingDecision = {
  providerId: ProviderId;
  /** Why this provider was chosen. Logged + surfaced in diagnostic UI. */
  reason: string;
};

const BULK_THRESHOLD = 4;

/**
 * Decide the provider for a single submit. Pure; safe to call from
 * both server and client.
 */
export function routeProvider(ctx: RoutingContext): RoutingDecision {
  if (ctx.userPick) {
    return {
      providerId: ctx.userPick,
      reason: `user pick (${ctx.userPick})`,
    };
  }

  // Bulk fan-out → prefer cheap provider. Falls back if FAL_KEY missing.
  const isBulk = ctx.isBulkFanout || ctx.drawableCount >= BULK_THRESHOLD;
  if (isBulk) {
    if (ctx.available.has("falai")) {
      return {
        providerId: "falai",
        reason: ctx.isBulkFanout
          ? "orchestrator fan-out → cheap provider (falai)"
          : `drawableCount=${ctx.drawableCount} >= ${BULK_THRESHOLD} → cheap provider (falai)`,
      };
    }
    if (ctx.available.has("openai")) {
      return {
        providerId: "openai",
        reason: "bulk fan-out, FAL_KEY missing → openai fallback",
      };
    }
  }

  // Decisive single-drawable iteration → literal provider.
  if (ctx.isDecisive && ctx.available.has("openai")) {
    return {
      providerId: "openai",
      reason: "decisive single-drawable → literal provider (openai)",
    };
  }

  // Default: whichever provider is available, openai first.
  for (const fallback of ["openai", "gemini", "falai", "replicate"] as const) {
    if (ctx.available.has(fallback)) {
      return {
        providerId: fallback,
        reason: `default fallback (${fallback})`,
      };
    }
  }

  // No providers available — caller will hit "unavailable" anyway,
  // but we have to return *something*. openai is the canonical id
  // that the UI knows how to surface as "set the key".
  return {
    providerId: "openai",
    reason: "no provider available — caller should surface key-missing UX",
  };
}

/**
 * Convenience for callers that hold a `ProviderAvailability[]` list
 * (the shape returned by `/api/ai/providers`).
 */
export function availableSetFromList(
  list: ReadonlyArray<{ id: ProviderId; available: boolean }>,
): ReadonlySet<ProviderId> {
  const set = new Set<ProviderId>();
  for (const p of list) {
    if (p.available) set.add(p.id);
  }
  return set;
}
