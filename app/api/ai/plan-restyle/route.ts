/**
 * POST /api/ai/plan-restyle
 *
 * The "AI decides" half of the smart restyle: a vision chat model
 * looks at the numbered layer contact sheet + the assembled character
 * + the user's style references, and returns a machine-readable plan —
 * which layers to repaint and the per-layer edit instruction. The
 * client then executes each item through the proven per-layer
 * generate pipeline.
 *
 * Body (multipart/form-data):
 *   userPrompt      string  the user's style request
 *   maxItems        string  cap on plan length (cost control)
 *   layerList       string  "#<idx> \"<name>\" (WxH)" per line
 *   contactSheet    File    numbered thumbnail grid (PNG)
 *   snapshot        File?   assembled character render
 *   referenceImage  File*   style references
 *
 * Response: { styleAnchor, plan: [{index, instruction}], model }
 *
 * Key resolution mirrors refine-prompt: config.json key first, .env
 * fallback on 401/403.
 */

import { NextResponse } from "next/server";
import { readConfigApiKeys } from "@/lib/config/serverConfig";

const PLANNER_MODEL = process.env.OPENAI_PROMPT_REFINER_MODEL ?? "gpt-5.4";
const ENDPOINT = "https://api.openai.com/v1/chat/completions";

const SYSTEM_PROMPT = `You are an art director planning texture edits for a 2D rigged avatar (Live2D / Spine).

You receive:
- [image 1] CONTACT SHEET: a grid of numbered thumbnails ("#0", "#1", …) — every editable texture layer of the avatar. Cell numbers are the layer indices you must reference. The rig's own layer names are listed in the user message (often Chinese/Japanese, sometimes uninformative — trust the thumbnails over the names).
- [image 2] (when present) the ASSEMBLED character as currently rendered — use it to understand which thumbnail is which body part.
- [image 3..] (when present) the user's STYLE REFERENCES — the look to apply.
- The user's instruction.

Your job: decide WHICH layers need repainting to fulfil the instruction, and write a per-layer edit instruction for an image-edit model.

Rules:
- Select only layers whose content the instruction actually affects. Every item costs one paid API call — prefer the minimal sufficient set, hard cap given as maxItems.
- Layers whose names end in "page N" are the SAME body part split across atlas pages — if you select one, select its siblings and give them the same instruction.
- Skip layers that are tiny accessories, effects, or unrelated to the request. Skip anything that looks like UI/watermark text.
- Each "instruction": 1–3 English sentences describing what to paint INSIDE the existing silhouette. Name concrete colors / materials / patterns. When style references are given, extract their concrete palette and design language and apply it — never write vague "match the style" phrases. Never instruct changing shape, pose, position or adding new elements outside the silhouette.
- "styleAnchor": ONE sentence naming the exact shared palette + material language (e.g. "matte black wool with wine-red accents, antique gold buttons, soft cel shading") so independently generated parts converge.

Respond with ONLY a JSON object, no prose, no code fences:
{"styleAnchor": string, "plan": [{"index": number, "instruction": string}]}`;

export async function POST(request: Request) {
  const overrideKey = (await readConfigApiKeys()).openai;
  const envKey = process.env.OPENAI_API_KEY;
  const keyCandidates = [
    ...(overrideKey ? [overrideKey] : []),
    ...(envKey && envKey !== overrideKey ? [envKey] : []),
  ];
  if (keyCandidates.length === 0) {
    return NextResponse.json({ error: "OPENAI_API_KEY not set" }, { status: 503 });
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

  const userPrompt = form.get("userPrompt");
  const layerList = form.get("layerList");
  const maxItemsRaw = form.get("maxItems");
  const contactSheet = form.get("contactSheet");
  const snapshot = form.get("snapshot");
  const refImages = form.getAll("referenceImage").filter((v): v is File => v instanceof File);

  if (typeof userPrompt !== "string" || userPrompt.trim().length === 0) {
    return NextResponse.json({ error: "userPrompt required" }, { status: 400 });
  }
  if (!(contactSheet instanceof Blob)) {
    return NextResponse.json({ error: "contactSheet required" }, { status: 400 });
  }
  const maxItems = Math.max(
    1,
    Math.min(30, typeof maxItemsRaw === "string" ? Number(maxItemsRaw) || 12 : 12),
  );

  const toDataUrl = async (blob: Blob): Promise<string> => {
    const buf = Buffer.from(await blob.arrayBuffer());
    return `data:${blob.type || "image/png"};base64,${buf.toString("base64")}`;
  };

  type ChatContentPart =
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } };
  const userContent: ChatContentPart[] = [
    {
      type: "text",
      text:
        `Instruction: ${userPrompt.trim()}\n` +
        `maxItems: ${maxItems}\n\n` +
        `Layer list (index → rig name → thumbnail source dims):\n${
          typeof layerList === "string" ? layerList : "(none)"
        }`,
    },
    { type: "image_url", image_url: { url: await toDataUrl(contactSheet), detail: "high" } },
  ];
  if (snapshot instanceof Blob) {
    userContent.push({
      type: "image_url",
      image_url: { url: await toDataUrl(snapshot), detail: "high" },
    });
  }
  for (const ref of refImages) {
    userContent.push({
      type: "image_url",
      image_url: { url: await toDataUrl(ref), detail: "high" },
    });
  }

  console.info(
    `[plan-restyle] model=${PLANNER_MODEL} maxItems=${maxItems} sheet=${contactSheet.size}B snapshot=${
      snapshot instanceof Blob ? `${snapshot.size}B` : "(none)"
    } refs=${refImages.length} promptLen=${userPrompt.length}`,
  );

  let response: Response | null = null;
  try {
    for (const apiKey of keyCandidates) {
      response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: PLANNER_MODEL,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userContent },
          ],
          // Planning wants determinism more than creativity — the
          // creative latitude lives in the per-layer image calls.
          temperature: 0.2,
          response_format: { type: "json_object" },
        }),
      });
      if ((response.status === 401 || response.status === 403) && keyCandidates.length > 1) {
        console.warn("[plan-restyle] config.json key failed auth — falling back to .env key");
        continue;
      }
      break;
    }
  } catch (e) {
    return NextResponse.json({ error: `network: ${(e as Error).message}` }, { status: 502 });
  }
  if (!response) {
    return NextResponse.json({ error: "plan-restyle produced no response" }, { status: 502 });
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    console.warn(`[plan-restyle] error ${response.status}: ${text.slice(0, 400)}`);
    return NextResponse.json(
      { error: `plan-restyle ${response.status}: ${text.slice(0, 300)}` },
      { status: response.status },
    );
  }

  type ChatResponse = { choices?: { message?: { content?: string } }[]; model?: string };
  const data = (await response.json()) as ChatResponse;
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    return NextResponse.json({ error: "planner returned empty content" }, { status: 502 });
  }

  // response_format json_object should give clean JSON; strip fences
  // defensively for models that ignore it.
  const jsonText = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed: { styleAnchor?: unknown; plan?: unknown };
  try {
    parsed = JSON.parse(jsonText) as typeof parsed;
  } catch (e) {
    console.warn(`[plan-restyle] JSON parse failed: ${content.slice(0, 300)}`);
    return NextResponse.json(
      { error: `planner returned non-JSON: ${(e as Error).message}` },
      { status: 502 },
    );
  }

  const planRaw = Array.isArray(parsed.plan) ? parsed.plan : [];
  const plan = planRaw
    .filter(
      (p): p is { index: number; instruction: string } =>
        typeof (p as { index?: unknown })?.index === "number" &&
        typeof (p as { instruction?: unknown })?.instruction === "string",
    )
    .slice(0, maxItems);

  console.info(
    `[plan-restyle] plan=${plan.length} items: ${plan.map((p) => `#${p.index}`).join(" ")}`,
  );

  return NextResponse.json({
    styleAnchor: typeof parsed.styleAnchor === "string" ? parsed.styleAnchor : "",
    plan,
    model: data.model ?? PLANNER_MODEL,
  });
}
