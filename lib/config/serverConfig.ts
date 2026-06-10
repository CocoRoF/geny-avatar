/**
 * Server-side app config — a `config.json` file inside the project.
 *
 * Today it holds AI provider API keys set from the main page's
 * "API 설정" modal. Resolution order, everywhere a key is needed:
 *
 *   1. `config.json` key (this module) — set at runtime via
 *      `PUT /api/config/keys`, no restart needed.
 *   2. `.env` key — the DEFAULT, and also the runtime FALLBACK: when a
 *      config key fails auth (401/403), routes retry once with the
 *      env key.
 *
 * Location: `$GENY_AVATAR_CONFIG_PATH` when set, else
 * `<cwd>/config.json` (= /app/config.json in the Docker image). In
 * the Geny compose, point GENY_AVATAR_CONFIG_PATH at a volume to
 * survive image rebuilds.
 *
 * Reads hit the filesystem each time — key lookups happen a handful
 * of times per generation, and a fresh read means a config change
 * applies to the very next request with no cache invalidation logic.
 * Writes are atomic (tmp + rename) so a concurrent read never sees a
 * half-written file.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { ProviderId } from "../ai/types";

const PROVIDER_IDS: ProviderId[] = ["openai", "falai", "gemini", "replicate"];

export type AppConfig = {
  apiKeys?: Partial<Record<ProviderId, string>>;
};

export function configFilePath(): string {
  const override = process.env.GENY_AVATAR_CONFIG_PATH;
  if (override && override.trim().length > 0) return override.trim();
  return path.join(process.cwd(), "config.json");
}

/** Read the whole config. Missing or malformed file → empty config
 *  (malformed is logged — user may have hand-edited it). */
export async function readConfig(): Promise<AppConfig> {
  try {
    const raw = await fs.readFile(configFilePath(), "utf8");
    const parsed = JSON.parse(raw) as AppConfig;
    if (parsed && typeof parsed === "object") return parsed;
    return {};
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[serverConfig] read failed (${configFilePath()}):`, e);
    }
    return {};
  }
}

/** All config-set API keys (trimmed, non-empty only). */
export async function readConfigApiKeys(): Promise<Partial<Record<ProviderId, string>>> {
  const cfg = await readConfig();
  const out: Partial<Record<ProviderId, string>> = {};
  for (const id of PROVIDER_IDS) {
    const v = cfg.apiKeys?.[id];
    if (typeof v === "string" && v.trim().length > 0) out[id] = v.trim();
  }
  return out;
}

/**
 * Update API keys: `set` upserts, `clear` removes. Everything else in
 * the file is preserved (read-modify-write under an in-process lock;
 * atomic rename so concurrent readers see old-or-new, never partial).
 */
let writeLock: Promise<void> = Promise.resolve();
export function updateConfigApiKeys(input: {
  set?: Partial<Record<ProviderId, string>>;
  clear?: ProviderId[];
}): Promise<void> {
  const task = writeLock.then(async () => {
    const cfg = await readConfig();
    const keys: Partial<Record<ProviderId, string>> = { ...(cfg.apiKeys ?? {}) };
    for (const [id, value] of Object.entries(input.set ?? {})) {
      if (!PROVIDER_IDS.includes(id as ProviderId)) continue;
      const trimmed = (value ?? "").trim();
      if (trimmed.length > 0) keys[id as ProviderId] = trimmed;
    }
    for (const id of input.clear ?? []) {
      delete keys[id];
    }
    const next: AppConfig = { ...cfg, apiKeys: keys };
    const target = configFilePath();
    const tmp = `${target}.tmp-${process.pid}`;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(tmp, target);
  });
  // Keep the chain alive even when a write fails.
  writeLock = task.catch(() => {});
  return task;
}

/** Masked preview for the config UI — never the full key. */
export function maskKey(key: string): string {
  if (key.length <= 8) return "…";
  return `${key.slice(0, 3)}…${key.slice(-4)}`;
}

/**
 * Heuristic: does this provider error look like a bad/unauthorized
 * key (as opposed to a content/transport failure)? Used to decide
 * whether retrying with the `.env` key is worthwhile. Auth failures
 * are rejected before any generation happens, so the retry can't
 * double-bill.
 */
export function isAuthError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /\b(401|403)\b|unauthorized|invalid[ _-]?api[ _-]?key|incorrect api key|authentication/i.test(
    msg,
  );
}
