/**
 * GET /api/ai/status/:jobId
 * Response: AIJobStatus or { error } 404 when the job has expired.
 */

import { NextResponse } from "next/server";
import { getJob } from "@/lib/ai/server/jobs";

export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;
  const job = getJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "job not found or expired" }, { status: 404 });
  }
  return NextResponse.json(job.status);
}
