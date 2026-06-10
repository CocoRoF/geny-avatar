/**
 * GET /api/config/keys
 *   Status per provider — whether a config.json key / .env key exists
 *   and which one is in effect. Full keys are NEVER returned; configured
 *   keys come back as a masked preview ("sk-…1234").
 *
 * PUT /api/config/keys
 *   Body: { set?: { [providerId]: string }, clear?: providerId[] }
 *   Upserts/removes keys in config.json (atomic write, applies to the
 *   next request — no restart). Returns the refreshed status.
 *
 * force-dynamic: status depends on a runtime file + process.env — never
 * static-render it.
 */

import { NextResponse } from "next/server";
import type { ProviderId } from "@/lib/ai/types";
import { API_KEY_PROVIDERS } from "@/lib/config/apiKeyProviders";
import {
  configFilePath,
  maskKey,
  readConfigApiKeys,
  updateConfigApiKeys,
} from "@/lib/config/serverConfig";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type KeyStatus = {
  id: ProviderId;
  label: string;
  envVar: string;
  hint: string;
  /** config.json key present (masked preview in `preview`). */
  configConfigured: boolean;
  preview?: string;
  /** .env key present — the default / auth-failure fallback. */
  envConfigured: boolean;
  /** Which key is in effect for new requests. */
  source: "config" | "env" | null;
};

async function buildStatus(): Promise<{ configPath: string; keys: KeyStatus[] }> {
  const configKeys = await readConfigApiKeys();
  const keys = API_KEY_PROVIDERS.map(({ id, label, envVar, hint }) => {
    const configKey = configKeys[id];
    const envKey = process.env[envVar];
    return {
      id,
      label,
      envVar,
      hint,
      configConfigured: !!configKey,
      preview: configKey ? maskKey(configKey) : undefined,
      envConfigured: !!envKey,
      source: configKey ? ("config" as const) : envKey ? ("env" as const) : null,
    };
  });
  return { configPath: configFilePath(), keys };
}

export async function GET() {
  return NextResponse.json(await buildStatus());
}

export async function PUT(request: Request) {
  let body: { set?: Record<string, unknown>; clear?: unknown[] };
  try {
    body = (await request.json()) as typeof body;
  } catch (e) {
    return NextResponse.json(
      { error: `invalid JSON body: ${(e as Error).message}` },
      { status: 400 },
    );
  }

  const validIds = new Set(API_KEY_PROVIDERS.map((p) => p.id));
  const set: Partial<Record<ProviderId, string>> = {};
  for (const [id, value] of Object.entries(body.set ?? {})) {
    if (!validIds.has(id as ProviderId)) {
      return NextResponse.json({ error: `unknown provider: ${id}` }, { status: 400 });
    }
    if (typeof value !== "string") {
      return NextResponse.json({ error: `key for ${id} must be a string` }, { status: 400 });
    }
    set[id as ProviderId] = value;
  }
  const clear: ProviderId[] = [];
  for (const id of body.clear ?? []) {
    if (typeof id !== "string" || !validIds.has(id as ProviderId)) {
      return NextResponse.json({ error: `unknown provider in clear: ${id}` }, { status: 400 });
    }
    clear.push(id as ProviderId);
  }

  try {
    await updateConfigApiKeys({ set, clear });
  } catch (e) {
    // Most likely a read-only filesystem / bad GENY_AVATAR_CONFIG_PATH.
    return NextResponse.json(
      { error: `config.json 쓰기 실패 (${configFilePath()}): ${(e as Error).message}` },
      { status: 500 },
    );
  }
  return NextResponse.json(await buildStatus());
}
