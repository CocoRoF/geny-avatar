/**
 * GET /api/ai/providers
 * Returns availability for each provider so the UI can disable picker
 * entries when an env var isn't set. The keys themselves are never
 * leaked client-side — only a boolean and a "reason" string.
 *
 * `force-dynamic` is critical: provider availability is computed by
 * reading `process.env.<KEY>`. Without this directive Next.js may
 * static-render the route at build time, baking in `available:false`
 * when the build container doesn't have the keys set. Setting the
 * env at runtime via docker-compose then has no effect because
 * subsequent requests serve the cached static response. The
 * `revalidate=0` mirror is belt-and-suspenders for older runtimes.
 */

import { NextResponse } from "next/server";
import { listProviders, providerConfigs } from "@/lib/ai/providers/registry";
import { readConfigApiKeys } from "@/lib/config/serverConfig";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  // config.json keys override .env, so the availability snapshot must
  // reflect the EFFECTIVE config, not just the server env.
  const overrides = await readConfigApiKeys();
  const availability = listProviders(overrides);
  // Pair availability with capabilities so the picker can render model
  // dropdowns and mask-aware hints without a second request.
  const detailed = providerConfigs.map((cfg) => {
    const avail = availability.find((a) => a.id === cfg.id);
    return {
      id: cfg.id,
      displayName: cfg.displayName,
      capabilities: cfg.capabilities,
      available: !!avail?.available,
      reason: avail?.reason,
      source: avail?.source,
      envConfigured: avail?.envConfigured,
    };
  });
  return NextResponse.json({ providers: detailed });
}
