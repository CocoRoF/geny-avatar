/**
 * Browser-side SAM helper. Wraps `POST /api/ai/sam` so callers don't
 * have to remember the multipart shape.
 *
 * Synchronous from the caller's perspective: the route holds the HTTP
 * request open until SAM finishes (Replicate `Prefer: wait` + a poll
 * fallback in the route). UIs should put a spinner up while this
 * promise is pending.
 */

import { apiUrl } from "@/lib/basePath";
import type { SamCandidate, SamPoint, SamResponse } from "./types";

type SubmitInput = {
  imageBlob: Blob;
  points: SamPoint[];
  modelId?: string;
};

type RouteResponse = {
  candidates: { maskDataUrl: string; score?: number }[];
  model: string;
  elapsedMs: number;
};

export async function submitSam(input: SubmitInput): Promise<SamResponse> {
  const form = new FormData();
  form.set("image", input.imageBlob, "source.png");
  form.set("points", JSON.stringify(input.points));
  if (input.modelId) form.set("modelId", input.modelId);

  const response = await fetch(apiUrl("/api/ai/sam"), { method: "POST", body: form });
  const text = await response.text();
  let parsed: RouteResponse | { error?: string };
  try {
    parsed = JSON.parse(text) as RouteResponse | { error?: string };
  } catch {
    throw new Error(`SAM route returned non-JSON (${response.status}): ${text.slice(0, 200)}`);
  }
  if (!response.ok) {
    const err =
      typeof (parsed as { error?: string }).error === "string"
        ? (parsed as { error: string }).error
        : `HTTP ${response.status}`;
    throw new Error(err);
  }

  const ok = parsed as RouteResponse;
  const candidates: SamCandidate[] = await Promise.all(
    ok.candidates.map(async (c) => {
      const blob = await dataUrlToBlob(c.maskDataUrl);
      return { maskBlob: blob, score: c.score };
    }),
  );
  return { candidates, model: ok.model, elapsedMs: ok.elapsedMs };
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  // `fetch` natively understands data: URLs, which keeps us out of
  // base64-decoding-by-hand land.
  const r = await fetch(dataUrl);
  return r.blob();
}
