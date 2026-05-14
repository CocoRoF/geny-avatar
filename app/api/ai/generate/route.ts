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
 *   referenceImage  File*    Zero or more reference images. Order is
 *                            preserved (`formData.getAll`). Forwarded
 *                            as `input.referenceImages` to the
 *                            provider; providers without
 *                            `supportsReferenceImages` ignore the
 *                            array entirely.
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
  const refinedPrompt = form.get("refinedPrompt");
  const sourceFile = form.get("sourceImage");
  const maskFile = form.get("maskImage");
  const maskReferenceFile = form.get("maskReferenceImage");
  const negativePrompt = form.get("negativePrompt");
  const modelId = form.get("modelId");
  const seedStr = form.get("seed");
  // Multiple reference images come in under the same key. `getAll`
  // preserves insertion order, which matters because the provider
  // forwards them to gpt-image-2 as `image[]` after the source.
  // `FormDataEntryValue` is `string | File`; we keep only Files
  // (which extend Blob) and pass them through as Blob[] for the
  // provider — provider treats source / mask / refs uniformly.
  const referenceImages: Blob[] = form
    .getAll("referenceImage")
    .filter((v): v is File => v instanceof File);

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
  // Strip refs for providers that don't support them — keeps the
  // provider implementations honest and avoids surprising the model
  // with extra inputs it can't make sense of.
  const supportsRefs = provider.config.capabilities.supportsReferenceImages;
  const forwardedRefs = supportsRefs ? referenceImages : [];
  console.info(
    `[ai/generate] received jobId=${job.id} provider=${providerId} model=${typeof modelId === "string" && modelId ? modelId : "(default)"}\n` +
      `              source=${(sourceFile as Blob).size}B (${(sourceFile as Blob).type || "?"})\n` +
      `              mask=${maskFile instanceof Blob ? `${maskFile.size}B (${maskFile.type || "?"})` : "(none)"}\n` +
      `              refs=${referenceImages.length} received → ${forwardedRefs.length} forwarded` +
      (referenceImages.length > 0 && !supportsRefs
        ? ` (provider doesn't supportReferenceImages — dropped)`
        : "") +
      (referenceImages.length > 0
        ? `\n              ref sizes: ${referenceImages.map((r) => `${r.size}B`).join(", ")}`
        : "") +
      `\n              promptLength=${prompt.length}`,
  );

  void runJob(job.id, provider.generate.bind(provider), {
    sourceImage: sourceFile,
    maskImage: maskFile instanceof Blob ? maskFile : undefined,
    maskReferenceImage: maskReferenceFile instanceof Blob ? maskReferenceFile : undefined,
    referenceImages: forwardedRefs.length > 0 ? forwardedRefs : undefined,
    prompt,
    refinedPrompt:
      typeof refinedPrompt === "string" && refinedPrompt.trim() ? refinedPrompt : undefined,
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
  return s === "gemini" || s === "openai" || s === "replicate" || s === "falai";
}
