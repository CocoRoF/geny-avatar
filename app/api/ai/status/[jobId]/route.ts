/**
 * GET    /api/ai/status/:jobId — AIJobStatus, or { error } 404 when expired.
 * DELETE /api/ai/status/:jobId — cancel: aborts the in-flight provider
 *        call and marks the job canceled. Idempotent; 404 when unknown.
 */

import { NextResponse } from "next/server";
import { cancelJob, getJob } from "@/lib/ai/server/jobs";

export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;
  const job = getJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "job not found or expired" }, { status: 404 });
  }
  return NextResponse.json(job.status);
}

export async function DELETE(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;
  const job = getJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "job not found or expired" }, { status: 404 });
  }
  const canceled = cancelJob(jobId);
  return NextResponse.json({ canceled, status: job.status });
}
