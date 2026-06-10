/**
 * Provider registry. Server-side only. The API route asks for a
 * provider by id and gets a ready-to-use instance (or null if the
 * required env var is missing).
 *
 * Env vars (all optional — missing keys disable that provider):
 *   GEMINI_API_KEY     — Google AI Studio key for Nano Banana
 *   OPENAI_API_KEY     — OpenAI key for gpt-image-2
 *   REPLICATE_API_TOKEN — wired in Sprint 3.2 with SDXL + ControlNet
 *   FAL_KEY            — fal.ai key for FLUX.2 [edit]
 */

import type { ProviderId } from "../types";
import { FalAIProvider, falaiConfig } from "./falai";
import { GeminiProvider, geminiConfig } from "./gemini";
import type { AIProvider, ProviderConfig } from "./interface";
import { OpenAIProvider, openaiConfig } from "./openai";
import { ReplicateProvider, replicateConfig } from "./replicate";

// Order matters: the GeneratePanel defaults to the FIRST available
// provider. OpenAI gpt-image leads — the docs-upgrade progress logs
// concluded it's the only provider that handles atlas crops reliably
// (FLUX family hallucinates characters into silhouettes; Gemini has
// no refs and inverted mask semantics).
export const providerConfigs: ProviderConfig[] = [
  openaiConfig,
  falaiConfig,
  geminiConfig,
  replicateConfig,
];

export type ProviderAvailability = {
  id: ProviderId;
  displayName: string;
  available: boolean;
  /** Reason a provider is unavailable, e.g. "GEMINI_API_KEY not set". */
  reason?: string;
  /** Where the effective key comes from: config.json ("config"),
   *  server .env ("env"), or absent. The main-page API config modal
   *  surfaces this so the user can tell which key is in effect. */
  source?: "config" | "env";
  /** Whether the server .env has a key for this provider — shown in
   *  the config modal as "(.env 기본값 있음)". */
  envConfigured?: boolean;
};

/**
 * Snapshot of which providers can serve requests right now. Returned by
 * `GET /api/ai/providers` so the UI can disable picker entries when
 * keys aren't set.
 */
export function listProviders(
  overrides?: Partial<Record<ProviderId, string>>,
): ProviderAvailability[] {
  return providerConfigs.map((cfg) => {
    const env = envKeyForProvider(cfg.id);
    const envValue = env ? process.env[env] : undefined;
    const overrideValue = overrides?.[cfg.id];
    // Replicate's image generation is a shape-only stub (`generate()`
    // always throws) — advertising it as available whenever the token
    // was set put a guaranteed-failure entry in the picker. SAM (the
    // only real Replicate integration) goes through /api/ai/sam and
    // doesn't use this picker — but the config modal still wants to
    // know the key sources, so report those.
    if (cfg.id === "replicate") {
      return {
        id: cfg.id,
        displayName: cfg.displayName,
        available: false,
        reason: "image generation not implemented (SAM segmentation only)",
        source: overrideValue ? ("config" as const) : envValue ? ("env" as const) : undefined,
        envConfigured: !!envValue,
      };
    }
    const effective = overrideValue ?? envValue;
    return {
      id: cfg.id,
      displayName: cfg.displayName,
      available: !!effective,
      reason: effective ? undefined : `${env ?? "(env)"} not set`,
      source: overrideValue ? ("config" as const) : envValue ? ("env" as const) : undefined,
      envConfigured: !!envValue,
    };
  });
}

/**
 * Construct a provider instance for `id`. `overrideKey` (from
 * config.json — see lib/config/serverConfig.ts) takes precedence; the
 * `.env` key is the default. Returns `null` (with an explanatory
 * error in `reason`) when neither is set.
 */
export function getProvider(
  id: ProviderId,
  overrideKey?: string,
): {
  provider: AIProvider | null;
  reason?: string;
} {
  switch (id) {
    case "gemini": {
      const key = overrideKey ?? process.env.GEMINI_API_KEY;
      if (!key) return { provider: null, reason: "GEMINI_API_KEY not set" };
      return { provider: new GeminiProvider(key) };
    }
    case "openai": {
      const key = overrideKey ?? process.env.OPENAI_API_KEY;
      if (!key) return { provider: null, reason: "OPENAI_API_KEY not set" };
      return { provider: new OpenAIProvider(key) };
    }
    case "replicate": {
      const key = overrideKey ?? process.env.REPLICATE_API_TOKEN;
      if (!key) return { provider: null, reason: "REPLICATE_API_TOKEN not set" };
      // Provider is shape-only — generate() throws a clear message.
      return { provider: new ReplicateProvider(key) };
    }
    case "falai": {
      const key = overrideKey ?? process.env.FAL_KEY;
      if (!key) return { provider: null, reason: "FAL_KEY not set" };
      return { provider: new FalAIProvider(key) };
    }
    default:
      return { provider: null, reason: `unknown provider: ${id}` };
  }
}

function envKeyForProvider(id: ProviderId): string | null {
  switch (id) {
    case "gemini":
      return "GEMINI_API_KEY";
    case "openai":
      return "OPENAI_API_KEY";
    case "replicate":
      return "REPLICATE_API_TOKEN";
    case "falai":
      return "FAL_KEY";
    default:
      return null;
  }
}
