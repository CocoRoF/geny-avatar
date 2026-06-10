"use client";

/**
 * AI-planned whole-character restyle ("smart" mode).
 *
 * The page-holistic restyle (lib/ai/restyle.ts) showed its limits in
 * practice: a 4096² atlas page downscaled to 1024 loses the detail the
 * model needs, and gpt-image can't reliably map "the skirt" onto
 * scattered sprite-sheet islands — it converges on near-no-op edits.
 *
 * This module flips the control: a VISION LLM looks at (a) a numbered
 * contact sheet of every editable layer, (b) the assembled character,
 * (c) the user's style references, and PLANS which layers to repaint
 * and with what instruction. Execution then reuses the per-layer
 * pipeline that already works (extract → tight-crop → 1024² pad →
 * gpt-image edit → postprocess + alpha-enforce → layer override), so
 * each edit happens at full per-part resolution with an unambiguous
 * subject.
 *
 * Consistency across parts comes from three anchors sent with every
 * call: the plan's shared `styleAnchor` sentence, the same reference
 * images, and the assembled-character snapshot.
 */

import type { AvatarAdapter } from "../adapters/AvatarAdapter";
import { extractCurrentLayerCanvas } from "../avatar/regionExtract";
import type { Avatar, Layer, LayerId } from "../avatar/types";
import { apiUrl } from "../basePath";
import {
  canvasToPngBlob,
  postprocessGeneratedBlob,
  prepareOpenAISource,
  submitGenerate,
} from "./client";

// ----- catalog / contact sheet -----

export type CatalogEntry = {
  /** Index printed on the contact sheet — what the LLM references. */
  index: number;
  layer: Layer;
  /** Current composited layer canvas (override-aware). */
  canvas: HTMLCanvasElement;
};

export type LayerCatalog = {
  entries: CatalogEntry[];
  /** PNG contact sheet — numbered thumbnail grid of every entry. */
  sheetBlob: Blob;
};

const SHEET_CELL = 104;
const SHEET_COLS = 8;
const SHEET_LABEL_H = 14;

/**
 * Build the numbered contact sheet of editable layers. Skips layers
 * without an atlas footprint and layers the user has toggled OFF
 * (deliberately hidden content — e.g. watermark plates — must not be
 * restyled or leak into the plan).
 */
export async function buildLayerCatalog(input: {
  adapter: AvatarAdapter;
  avatar: Avatar;
  visibilityOverrides: Record<LayerId, boolean>;
  layerMasks: Record<LayerId, Blob>;
  layerTextureOverrides: Record<LayerId, Blob>;
}): Promise<LayerCatalog> {
  const { adapter, avatar, visibilityOverrides, layerMasks, layerTextureOverrides } = input;
  const entries: CatalogEntry[] = [];
  for (const layer of avatar.layers) {
    if (!layer.texture) continue;
    const visible = visibilityOverrides[layer.id] ?? layer.defaults.visible;
    if (!visible || layer.bakedHidden) continue;
    const extracted = await extractCurrentLayerCanvas(adapter, layer, {
      texture: layerTextureOverrides[layer.id] ?? null,
      mask: layerMasks[layer.id] ?? null,
    });
    if (!extracted) continue;
    entries.push({ index: entries.length, layer, canvas: extracted.canvas });
  }
  if (entries.length === 0) throw new Error("편집 가능한 레이어가 없습니다");

  const cols = Math.min(SHEET_COLS, entries.length);
  const rows = Math.ceil(entries.length / cols);
  const sheet = document.createElement("canvas");
  sheet.width = cols * SHEET_CELL;
  sheet.height = rows * (SHEET_CELL + SHEET_LABEL_H);
  const ctx = sheet.getContext("2d");
  if (!ctx) throw new Error("contact sheet 2d context unavailable");
  // Mid-grey backdrop: keeps both dark and light textures legible and
  // avoids the model reading transparency as "empty cell".
  ctx.fillStyle = "#3a3f46";
  ctx.fillRect(0, 0, sheet.width, sheet.height);

  for (const entry of entries) {
    const col = entry.index % cols;
    const row = Math.floor(entry.index / cols);
    const x = col * SHEET_CELL;
    const y = row * (SHEET_CELL + SHEET_LABEL_H);
    // Label strip.
    ctx.fillStyle = "#14171b";
    ctx.fillRect(x, y, SHEET_CELL, SHEET_LABEL_H);
    ctx.fillStyle = "#7fffd4";
    ctx.font = "bold 10px monospace";
    ctx.textBaseline = "middle";
    ctx.fillText(`#${entry.index}`, x + 3, y + SHEET_LABEL_H / 2 + 0.5);
    // Thumbnail, aspect-fit.
    const c = entry.canvas;
    const scale = Math.min((SHEET_CELL - 6) / c.width, (SHEET_CELL - 6) / c.height, 1);
    const w = Math.max(1, Math.round(c.width * scale));
    const h = Math.max(1, Math.round(c.height * scale));
    ctx.drawImage(c, x + (SHEET_CELL - w) / 2, y + SHEET_LABEL_H + (SHEET_CELL - h) / 2, w, h);
  }

  return { entries, sheetBlob: await canvasToPngBlob(sheet) };
}

// ----- plan -----

export type PlanItem = {
  index: number;
  instruction: string;
};

export type RestylePlan = {
  styleAnchor: string;
  plan: PlanItem[];
  model: string;
};

export async function requestRestylePlan(input: {
  userPrompt: string;
  catalog: LayerCatalog;
  snapshot: Blob | null;
  referenceImages: Blob[];
  maxItems: number;
}): Promise<RestylePlan> {
  const form = new FormData();
  form.set("userPrompt", input.userPrompt);
  form.set("maxItems", String(input.maxItems));
  form.set(
    "layerList",
    input.catalog.entries
      .map((e) => `#${e.index} "${e.layer.name}" (${e.canvas.width}x${e.canvas.height})`)
      .join("\n"),
  );
  form.set("contactSheet", input.catalog.sheetBlob, "contact-sheet.png");
  if (input.snapshot) form.set("snapshot", input.snapshot, "snapshot.png");
  input.referenceImages.forEach((b, i) => {
    form.append("referenceImage", b, `ref-${i}.png`);
  });

  const r = await fetch(apiUrl("/api/ai/plan-restyle"), { method: "POST", body: form });
  const data = (await r.json()) as Partial<RestylePlan> & { error?: string };
  if (!r.ok) throw new Error(data.error ?? `plan-restyle ${r.status}`);
  if (!data.plan || !Array.isArray(data.plan)) throw new Error("plan-restyle returned no plan");
  const valid = data.plan.filter(
    (p): p is PlanItem =>
      typeof p?.index === "number" &&
      p.index >= 0 &&
      p.index < input.catalog.entries.length &&
      typeof p?.instruction === "string" &&
      p.instruction.trim().length > 0,
  );
  if (valid.length === 0) throw new Error("플랜에 유효한 항목이 없습니다");
  return {
    styleAnchor: typeof data.styleAnchor === "string" ? data.styleAnchor : "",
    plan: valid.slice(0, input.maxItems),
    model: typeof data.model === "string" ? data.model : "?",
  };
}

// ----- execute -----

/** Per-item edit prompt — same scaffolding family as the per-layer
 *  GeneratePanel path, with the plan's shared style anchor appended so
 *  independently generated parts converge on one look. */
function composeItemPrompt(input: {
  layerName: string;
  instruction: string;
  styleAnchor: string;
  hasSnapshot: boolean;
  refCount: number;
}): string {
  const lines: string[] = [];
  lines.push(
    `[image 1] is the isolated "${input.layerName}" texture region of a 2D rigged character, on transparency. It is one part of the character, not a full illustration.`,
  );
  lines.push(`Repaint [image 1]: ${input.instruction}`);
  if (input.styleAnchor) lines.push(`Shared style anchor for every part: ${input.styleAnchor}`);
  let slot = 2;
  if (input.hasSnapshot) {
    lines.push(
      `[image ${slot}] shows the assembled character — context only, to understand what this part is. Do not copy its composition.`,
    );
    slot++;
  }
  if (input.refCount > 0) {
    const last = slot + input.refCount - 1;
    lines.push(
      `[image ${slot}${input.refCount > 1 ? `..${last}` : ""}] ${input.refCount > 1 ? "are" : "is"} the style reference${input.refCount > 1 ? "s" : ""} — apply the same palette, materials and design language.`,
    );
  }
  lines.push(
    "Keep the silhouette, scale and orientation exactly. Fill only inside the existing shape. Anime / illustration style, not photorealistic.",
  );
  return lines.join("\n");
}

export type ExecuteItemInput = {
  entry: CatalogEntry;
  instruction: string;
  styleAnchor: string;
  userPrompt: string;
  snapshot: Blob | null;
  referenceImages: Blob[];
  signal?: AbortSignal;
};

/** Run one plan item through the per-layer pipeline. Returns the
 *  postprocessed override blob (caller stores it + updates UI). */
export async function executePlanItem(input: ExecuteItemInput): Promise<Blob> {
  const { entry } = input;
  const prepared = prepareOpenAISource(entry.canvas);
  const sourceBlob = await canvasToPngBlob(prepared.padded);
  const refs = [...(input.snapshot ? [input.snapshot] : []), ...input.referenceImages];
  const raw = await submitGenerate({
    providerId: "openai",
    prompt: input.userPrompt,
    refinedPrompt: composeItemPrompt({
      layerName: entry.layer.name,
      instruction: input.instruction,
      styleAnchor: input.styleAnchor,
      hasSnapshot: !!input.snapshot,
      refCount: input.referenceImages.length,
    }),
    sourceImage: sourceBlob,
    referenceImages: refs.length > 0 ? refs : undefined,
    signal: input.signal,
  });
  return await postprocessGeneratedBlob({
    blob: raw,
    sourceCanvas: entry.canvas,
    openAIPadding: {
      paddingOffset: prepared.paddingOffset,
      sourceBBox: prepared.sourceBBox,
    },
  });
}
