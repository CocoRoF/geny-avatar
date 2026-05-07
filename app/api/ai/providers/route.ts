/**
 * GET /api/ai/providers
 * Returns availability for each provider so the UI can disable picker
 * entries when an env var isn't set. The keys themselves are never
 * leaked client-side — only a boolean and a "reason" string.
 */

import { NextResponse } from "next/server";
import { listProviders, providerConfigs } from "@/lib/ai/providers/registry";

export async function GET() {
  const availability = listProviders();
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
    };
  });
  return NextResponse.json({ providers: detailed });
}
