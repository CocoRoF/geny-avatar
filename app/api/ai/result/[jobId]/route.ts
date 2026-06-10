/**
 * GET /api/ai/result/:jobId
 * Returns the generated image bytes when the job has succeeded.
 * 404 when the job is unknown / expired, 409 when not yet complete.
 */

import { NextResponse } from "next/server";
import { deleteJob, getJob } from "@/lib/ai/server/jobs";

export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;
  const job = getJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "job not found or expired" }, { status: 404 });
  }
  if (job.status.kind !== "succeeded" || !job.result) {
    return NextResponse.json(
      { error: `job not complete; status=${job.status.kind}` },
      { status: 409 },
    );
  }
  const buf = await job.result.blob.arrayBuffer();
  // One-shot delivery: drop the job once the bytes are on the wire.
  // Result blobs used to sit in the in-memory map for the full 1h TTL
  // (pruned only when the NEXT job was created) — megabytes per
  // generation held for nothing. The client never re-fetches.
  deleteJob(jobId);
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "content-type": job.result.mime,
      "cache-control": "no-store",
    },
  });
}
