/**
 * Provider registry. Server-side only. The API route asks for a
 * provider by id and gets a ready-to-use instance (or null if the
 * required env var is missing).
 *
 * Env vars (all optional — missing keys disable that provider):
 *   GEMINI_API_KEY     — Google AI Studio key for Nano Banana
 *   OPENAI_API_KEY     — OpenAI key for gpt-image-2
 *   REPLICATE_API_TOKEN — wired in Sprint 3.2 with SDXL + ControlNet
 */

import type { ProviderId } from "../types";
import { GeminiProvider, geminiConfig } from "./gemini";
import type { AIProvider, ProviderConfig } from "./interface";
import { OpenAIProvider, openaiConfig } from "./openai";
import { ReplicateProvider, replicateConfig } from "./replicate";

export const providerConfigs: ProviderConfig[] = [geminiConfig, openaiConfig, replicateConfig];

export type ProviderAvailability = {
  id: ProviderId;
  displayName: string;
  available: boolean;
  /** Reason a provider is unavailable, e.g. "GEMINI_API_KEY not set". */
  reason?: string;
};

/**
 * Snapshot of which providers can serve requests right now. Returned by
 * `GET /api/ai/providers` so the UI can disable picker entries when
 * keys aren't set.
 */
export function listProviders(): ProviderAvailability[] {
  return providerConfigs.map((cfg) => {
    const env = envKeyForProvider(cfg.id);
    const value = env ? process.env[env] : undefined;
    return {
      id: cfg.id,
      displayName: cfg.displayName,
      available: !!value,
      reason: value ? undefined : `${env ?? "(env)"} not set`,
    };
  });
}

/**
 * Construct a provider instance for `id`. Returns `null` (with an
 * explanatory error in `reason`) when the env key is missing.
 */
export function getProvider(id: ProviderId): {
  provider: AIProvider | null;
  reason?: string;
} {
  switch (id) {
    case "gemini": {
      const key = process.env.GEMINI_API_KEY;
      if (!key) return { provider: null, reason: "GEMINI_API_KEY not set" };
      return { provider: new GeminiProvider(key) };
    }
    case "openai": {
      const key = process.env.OPENAI_API_KEY;
      if (!key) return { provider: null, reason: "OPENAI_API_KEY not set" };
      return { provider: new OpenAIProvider(key) };
    }
    case "replicate": {
      const key = process.env.REPLICATE_API_TOKEN;
      if (!key) return { provider: null, reason: "REPLICATE_API_TOKEN not set" };
      // Provider is shape-only — generate() throws a clear message.
      return { provider: new ReplicateProvider(key) };
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
    default:
      return null;
  }
}
