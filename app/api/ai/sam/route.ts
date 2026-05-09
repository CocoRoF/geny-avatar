/**
 * POST /api/ai/sam
 *
 * Click-driven segmentation via Replicate's SAM port. Returns candidate
 * masks for the given source image + click points. Synchronous-ish:
 * SAM finishes in 1–5s so we use Replicate's `Prefer: wait` header
 * instead of building a polling loop.
 *
 * Body (multipart/form-data):
 *   image     File          PNG/JPEG/WebP source
 *   points    string (JSON) [{x, y, label}, ...] — at least one foreground point
 *   modelId?  string        override REPLICATE_SAM_MODEL
 *
 * Response (200):
 *   {
 *     candidates: [{ maskDataUrl: string, score?: number }],
 *     model: string,
 *     elapsedMs: number
 *   }
 *
 * Error responses follow the rest of /api/ai/* — { error: string } with
 * a relevant status code.
 *
 * --- Replicate model selection ---
 * Replicate hosts many SAM ports with slightly different input schemas.
 * We default to Meta's official `meta/sam-2` (which accepts
 * `{ image, points, point_labels }`) and let operators override via
 * `REPLICATE_SAM_MODEL`. If a fork is used and the input shape differs,
 * tweak `buildInput` below. The route logs the input shape so the
 * mismatch is visible in the dev console.
 */

import { NextResponse } from "next/server";
import type { SamPoint } from "@/lib/ai/sam/types";

const REPLICATE_BASE = "https://api.replicate.com/v1";
const DEFAULT_SAM_MODEL = process.env.REPLICATE_SAM_MODEL ?? "meta/sam-2";
/** Replicate's `Prefer: wait` accepts a numeric seconds budget; cap at 60. */
const WAIT_BUDGET_S = 60;

export async function POST(request: Request) {
  const apiKey = process.env.REPLICATE_API_TOKEN;
  if (!apiKey) {
    return NextResponse.json({ error: "REPLICATE_API_TOKEN not set" }, { status: 503 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch (e) {
    return NextResponse.json(
      { error: `failed to parse multipart: ${(e as Error).message}` },
      { status: 400 },
    );
  }

  const imageEntry = form.get("image");
  const pointsRaw = form.get("points");
  const modelOverride = form.get("modelId");

  if (!(imageEntry instanceof Blob)) {
    return NextResponse.json({ error: "image required" }, { status: 400 });
  }
  if (typeof pointsRaw !== "string") {
    return NextResponse.json({ error: "points required (JSON string)" }, { status: 400 });
  }

  let points: SamPoint[];
  try {
    points = JSON.parse(pointsRaw);
  } catch (e) {
    return NextResponse.json(
      { error: `points malformed: ${(e as Error).message}` },
      { status: 400 },
    );
  }
  if (!Array.isArray(points) || points.length === 0) {
    return NextResponse.json({ error: "at least one point required" }, { status: 400 });
  }
  if (!points.some((p) => p.label === 1)) {
    return NextResponse.json(
      { error: "at least one foreground point (label=1) required" },
      { status: 400 },
    );
  }

  const model =
    typeof modelOverride === "string" && modelOverride ? modelOverride : DEFAULT_SAM_MODEL;

  // Encode image as data URL — Replicate accepts data URLs inline for
  // small payloads. Layer regions are typically <1MB so this avoids
  // the round trip of pre-uploading via the files API.
  const mime = imageEntry.type || "image/png";
  const buf = Buffer.from(await imageEntry.arrayBuffer());
  const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;

  const input = buildInput(dataUrl, points);
  console.info(
    `[ai/sam] POST ${REPLICATE_BASE}/models/${model}/predictions\n` +
      `         imageBytes=${imageEntry.size} mime=${mime} points=${points.length} fg=${points.filter((p) => p.label === 1).length}`,
  );

  const startedAt = Date.now();
  let prediction: ReplicatePrediction;
  try {
    const r = await fetch(`${REPLICATE_BASE}/models/${model}/predictions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Prefer: `wait=${WAIT_BUDGET_S}`,
      },
      body: JSON.stringify({ input }),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      console.warn(`[ai/sam] error ${r.status}: ${text.slice(0, 500)}`);
      return NextResponse.json(
        { error: `replicate ${r.status}: ${text.slice(0, 300)}` },
        { status: r.status },
      );
    }
    prediction = (await r.json()) as ReplicatePrediction;
  } catch (e) {
    return NextResponse.json({ error: `network: ${(e as Error).message}` }, { status: 502 });
  }

  // `Prefer: wait` may still time out for cold containers — fall back
  // to manual polling on the prediction id.
  if (prediction.status === "starting" || prediction.status === "processing") {
    try {
      prediction = await pollUntilTerminal(prediction.id, apiKey);
    } catch (e) {
      return NextResponse.json({ error: `poll failed: ${(e as Error).message}` }, { status: 504 });
    }
  }

  if (prediction.status !== "succeeded") {
    return NextResponse.json(
      { error: `prediction ${prediction.status}: ${prediction.error ?? "no error message"}` },
      { status: 502 },
    );
  }

  const outputUrls = collectOutputUrls(prediction.output);
  if (outputUrls.length === 0) {
    return NextResponse.json(
      { error: "prediction returned no mask URLs (model fork may use a different output shape)" },
      { status: 502 },
    );
  }

  // Fetch each mask server-side to avoid cross-origin issues in the
  // browser, then re-encode as data URLs the client can drop straight
  // into <img src> or canvas.
  const candidates: { maskDataUrl: string; score?: number }[] = [];
  for (const url of outputUrls) {
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const blob = await r.blob();
      const ab = await blob.arrayBuffer();
      const b64 = Buffer.from(ab).toString("base64");
      candidates.push({
        maskDataUrl: `data:${blob.type || "image/png"};base64,${b64}`,
      });
    } catch (e) {
      console.warn(`[ai/sam] mask fetch failed for ${url}: ${(e as Error).message}`);
    }
  }

  const elapsedMs = Date.now() - startedAt;
  console.info(`[ai/sam] succeeded in ${elapsedMs}ms — ${candidates.length} candidate(s)`);

  return NextResponse.json({ candidates, model, elapsedMs });
}

/**
 * Build the SAM input dictionary. Default shape matches Meta's
 * `meta/sam-2` — adjust if you swap to a fork that expects different
 * keys (e.g. `input_points` / `input_labels` for the classic SAM 1
 * port).
 */
function buildInput(imageDataUrl: string, points: SamPoint[]) {
  const xy = points.map((p) => [p.x, p.y]);
  const labels = points.map((p) => p.label);
  return {
    image: imageDataUrl,
    // SAM 2 native keys
    points: xy,
    point_labels: labels,
    // Common alternates some forks read instead — passing all is fine,
    // unknown keys get ignored at the model boundary.
    input_points: xy,
    input_labels: labels,
    multimask_output: true,
  };
}

type ReplicatePrediction = {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output?: unknown;
  error?: string | null;
  urls?: { get?: string };
};

async function pollUntilTerminal(
  id: string,
  apiKey: string,
  maxMs = 60_000,
): Promise<ReplicatePrediction> {
  const deadline = Date.now() + maxMs;
  let delay = 500;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, delay));
    const r = await fetch(`${REPLICATE_BASE}/predictions/${id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!r.ok) {
      throw new Error(`status ${r.status}`);
    }
    const p = (await r.json()) as ReplicatePrediction;
    if (p.status === "succeeded" || p.status === "failed" || p.status === "canceled") {
      return p;
    }
    delay = Math.min(delay * 1.5, 3000);
  }
  throw new Error(`timed out after ${maxMs}ms`);
}

/**
 * Different SAM ports return:
 *   - a single string URL
 *   - an array of string URLs
 *   - an object like { masks: [url, url, ...], scores: [...] }
 *   - an object like { individual_masks: [...] }
 * We sniff the common shapes and collect every URL we can find.
 */
function collectOutputUrls(output: unknown): string[] {
  if (typeof output === "string") return [output];
  if (Array.isArray(output)) {
    return output.filter((v): v is string => typeof v === "string");
  }
  if (output && typeof output === "object") {
    const candidates: string[] = [];
    for (const key of ["masks", "individual_masks", "mask", "combined_mask", "output"] as const) {
      const v = (output as Record<string, unknown>)[key];
      if (typeof v === "string") candidates.push(v);
      else if (Array.isArray(v)) {
        for (const item of v) if (typeof item === "string") candidates.push(item);
      }
    }
    return candidates;
  }
  return [];
}
