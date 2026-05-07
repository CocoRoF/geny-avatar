/**
 * POST /api/ai/generate
 *
 * Body (multipart/form-data):
 *   providerId      string   "gemini" | "openai" | "replicate"
 *   prompt          string
 *   negativePrompt  string?  optional
 *   modelId         string?  optional override
 *   seed            string?  optional integer
 *   sourceImage     File     PNG bytes of the source region
 *   maskImage       File?    PNG mask, **already in the provider's
 *                            convention** (client-side conversion in
 *                            lib/ai/maskConvert.ts)
 *
 * Response: { jobId: string }
 *
 * The route returns as soon as the job is recorded; the actual provider
 * call runs asynchronously and writes its result back into the in-memory
 * jobs map. The client then polls `/api/ai/status/:jobId` and finally
 * GETs `/api/ai/result/:jobId` for the blob.
 */

import { NextResponse } from "next/server";
import { getProvider } from "@/lib/ai/providers/registry";
import { createJob, setResult, setStatus } from "@/lib/ai/server/jobs";
import type { ProviderId } from "@/lib/ai/types";

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch (e) {
    return NextResponse.json(
      { error: `failed to parse multipart body: ${(e as Error).message}` },
      { status: 400 },
    );
  }

  const providerId = form.get("providerId");
  const prompt = form.get("prompt");
  const sourceFile = form.get("sourceImage");
  const maskFile = form.get("maskImage");
  const negativePrompt = form.get("negativePrompt");
  const modelId = form.get("modelId");
  const seedStr = form.get("seed");

  if (typeof providerId !== "string" || !isProviderId(providerId)) {
    return NextResponse.json({ error: "providerId required" }, { status: 400 });
  }
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    return NextResponse.json({ error: "prompt required" }, { status: 400 });
  }
  if (!(sourceFile instanceof Blob)) {
    return NextResponse.json({ error: "sourceImage required" }, { status: 400 });
  }

  const { provider, reason } = getProvider(providerId);
  if (!provider) {
    return NextResponse.json(
      { error: reason ?? `provider ${providerId} unavailable` },
      { status: 503 },
    );
  }

  const job = createJob(providerId);

  // Fire the provider in the background; the route returns immediately.
  // Errors land in the job's status so polling clients see them.
  void runJob(job.id, provider.generate.bind(provider), {
    sourceImage: sourceFile,
    maskImage: maskFile instanceof Blob ? maskFile : undefined,
    prompt,
    negativePrompt: typeof negativePrompt === "string" ? negativePrompt : undefined,
    modelId: typeof modelId === "string" && modelId ? modelId : undefined,
    seed: typeof seedStr === "string" && seedStr ? Number(seedStr) : undefined,
  });

  return NextResponse.json({ jobId: job.id });
}

async function runJob(
  jobId: string,
  generate: (input: import("@/lib/ai/providers/interface").ProviderGenerateInput) => Promise<Blob>,
  input: import("@/lib/ai/providers/interface").ProviderGenerateInput,
): Promise<void> {
  setStatus(jobId, { kind: "running" });
  try {
    const blob = await generate(input);
    setResult(jobId, blob, blob.type || "image/png");
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error(`[ai/generate] job ${jobId} failed:`, reason);
    setStatus(jobId, { kind: "failed", reason });
  }
}

function isProviderId(s: string): s is ProviderId {
  return s === "gemini" || s === "openai" || s === "replicate";
}
