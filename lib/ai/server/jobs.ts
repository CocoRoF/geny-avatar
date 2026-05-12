/**
 * Server-side job tracking — in-memory only.
 *
 * The API route creates a job, fires the provider asynchronously, and
 * stores the result blob keyed by job id. The client polls
 * `/api/ai/status/:id` and (on success) fetches `/api/ai/result/:id`.
 *
 * Since this is an in-memory `Map`, it doesn't survive process restarts
 * or scale across instances. That's fine for a hobby-scale solo deploy;
 * production would back this with Redis or a DB.
 *
 * **The Map lives on `globalThis`, not module scope.** Next.js dev mode
 * (and especially Turbopack) can evaluate the same module more than
 * once — once per route bundle, again on HMR — which gives each route
 * its own private `Map` and silently breaks the
 * generate-route-writes / status-route-reads contract: the client
 * polls `/api/ai/status/{id}` and gets a 404 because that route's
 * module instance never saw the `createJob` call from
 * `/api/ai/generate`. Anchoring on `globalThis` is the singleton
 * pattern Next.js recommends for this exact case.
 */
import { randomUUID } from "node:crypto";
import type { AIJobId, AIJobStatus, ProviderId } from "../types";

type ServerJob = {
  id: AIJobId;
  providerId: ProviderId;
  status: AIJobStatus;
  result?: { blob: Blob; mime: string };
  createdAt: number;
};

type JobGlobal = typeof globalThis & {
  __genyAvatarJobs__?: Map<AIJobId, ServerJob>;
};
const jobsGlobal = globalThis as JobGlobal;
if (!jobsGlobal.__genyAvatarJobs__) {
  jobsGlobal.__genyAvatarJobs__ = new Map<AIJobId, ServerJob>();
}
const jobs = jobsGlobal.__genyAvatarJobs__;

/** TTL: drop jobs older than 1h to keep memory bounded. */
const JOB_TTL_MS = 60 * 60 * 1000;

export function createJob(providerId: ProviderId): ServerJob {
  pruneExpired();
  const id = randomUUID();
  const job: ServerJob = {
    id,
    providerId,
    status: { kind: "queued" },
    createdAt: Date.now(),
  };
  jobs.set(id, job);
  return job;
}

export function getJob(id: AIJobId): ServerJob | null {
  return jobs.get(id) ?? null;
}

export function setStatus(id: AIJobId, status: AIJobStatus): void {
  const job = jobs.get(id);
  if (!job) return;
  job.status = status;
}

export function setResult(id: AIJobId, blob: Blob, mime: string): void {
  const job = jobs.get(id);
  if (!job) return;
  job.result = { blob, mime };
  job.status = { kind: "succeeded", resultMime: mime };
}

export function deleteJob(id: AIJobId): void {
  jobs.delete(id);
}

function pruneExpired(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt > JOB_TTL_MS) jobs.delete(id);
  }
}
