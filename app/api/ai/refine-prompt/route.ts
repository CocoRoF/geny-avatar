/**
 * POST /api/ai/refine-prompt
 *
 * Optional pre-stage for `/api/ai/generate`. Takes the user's raw
 * prompt + the request shape and asks an OpenAI chat model to rewrite
 * it as a precise gpt-image-2 edit instruction following the official
 * prompting guide:
 *   - explicit `[image 1]` / `[image 2..N]` slot labels
 *   - role separation (canvas to edit vs style-only references)
 *   - preservation block (silhouette / geometry / composition)
 *   - "do not copy reference content" guard
 *
 * The user can disable refinement in the panel and submit the raw
 * prompt as-is. We log both raw and refined into the diagnostic so
 * the operator can verify what actually went to the image model.
 *
 * Body (application/json):
 *   userPrompt    string   what the user typed in the panel
 *   layerName?    string   layer's display name (helps the LLM
 *                          understand the subject — e.g. "skirt")
 *   refCount      number   how many reference images are about to ride
 *                          along (drives the slot map in the rewrite)
 *   hasMask       boolean  whether a DecomposeStudio mask is attached
 *   negativePrompt? string optional things-to-avoid (passed through)
 *
 * Response: { refinedPrompt: string, model: string }  on success
 *           { error: string }                          on failure
 *
 * The endpoint requires `OPENAI_API_KEY` (same key the image edits
 * endpoint uses). When the key is missing we 503 — the caller will
 * fall back to sending the raw prompt.
 */

import { NextResponse } from "next/server";

const REFINER_MODEL = process.env.OPENAI_PROMPT_REFINER_MODEL ?? "gpt-4o-mini";
const ENDPOINT = "https://api.openai.com/v1/chat/completions";

const SYSTEM_PROMPT = `You are a prompt engineer for OpenAI's gpt-image-2 image-edit API. You rewrite a user's vague edit request into a precise structured instruction that the image model will follow without conflating roles.

Hard rules — never violate:
1. The user's intent must dominate. Do not change WHAT they asked for; only sharpen HOW it's expressed.
2. Use the gpt-image-2 documented slot convention: [image 1] is the canvas to edit; [image 2], [image 3]... are style and character references.
3. Reference images are STYLE ONLY — palette, lighting, line quality, material rendering, identity cues. They must NEVER paste their content (objects, faces, accessories, scene elements) into the result.
4. State explicit preservation: silhouette, geometry, composition, and (when the request doesn't say to mask) any pixels not affected by the requested edit.
5. Single paragraph or short multi-paragraph block. No markdown, no bullet points, no quotes around the whole output, no preamble like "Here is the refined prompt".
6. If the user prompt is already structured and precise, return it nearly verbatim with at most light cleanup.
7. Output ONLY the refined prompt itself.

Common failure patterns to fix:
- User says "make it look like the reference" → make explicit that the reference is style-only and the source's silhouette stays.
- User says "change the color" without specifying region → bind the change to [image 1] and add the no-content-copy clause when refs exist.
- User uses informal language → tighten to imperative voice without losing meaning.`;

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OPENAI_API_KEY not set" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (e) {
    return NextResponse.json(
      { error: `failed to parse JSON body: ${(e as Error).message}` },
      { status: 400 },
    );
  }

  const { userPrompt, layerName, refCount, hasMask, negativePrompt } =
    (body as {
      userPrompt?: unknown;
      layerName?: unknown;
      refCount?: unknown;
      hasMask?: unknown;
      negativePrompt?: unknown;
    }) ?? {};

  if (typeof userPrompt !== "string" || userPrompt.trim().length === 0) {
    return NextResponse.json({ error: "userPrompt required" }, { status: 400 });
  }
  if (typeof refCount !== "number" || refCount < 0) {
    return NextResponse.json({ error: "refCount required (number ≥ 0)" }, { status: 400 });
  }

  // Build the instruction the LLM will rewrite.
  const userMessage = [
    `Subject layer: ${typeof layerName === "string" && layerName ? layerName : "(no display name)"}`,
    `Reference images attached: ${refCount}${refCount === 0 ? " (no slot map needed)" : ""}`,
    `Mask present (alpha-defined edit zone on [image 1]): ${hasMask ? "yes" : "no"}`,
    typeof negativePrompt === "string" && negativePrompt.trim()
      ? `User's "avoid" hints: ${negativePrompt.trim()}`
      : null,
    "",
    `User's raw prompt: """${userPrompt.trim()}"""`,
    "",
    "Produce the refined prompt now. Do not narrate. Output the prompt text only.",
  ]
    .filter((x): x is string => typeof x === "string")
    .join("\n");

  const startedAt = Date.now();
  console.info(
    `[refine-prompt] POST ${ENDPOINT} model=${REFINER_MODEL} refCount=${refCount} hasMask=${hasMask} userPromptLen=${userPrompt.length}`,
  );

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: REFINER_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        // Low-ish temperature so the rewrite stays close to user intent
        // while still cleaning up phrasing. 0 would be too conservative
        // for the "tighten loose phrasing" pass.
        temperature: 0.3,
      }),
    });
  } catch (e) {
    const reason = (e as Error).message;
    console.error("[refine-prompt] network error", reason);
    return NextResponse.json({ error: `network: ${reason}` }, { status: 502 });
  }

  const elapsed = Date.now() - startedAt;
  console.info(`[refine-prompt] response ${response.status} in ${elapsed}ms`);

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    console.warn(`[refine-prompt] error body: ${text.slice(0, 500)}`);
    return NextResponse.json(
      { error: `refine-prompt ${response.status}: ${text.slice(0, 300)}` },
      { status: response.status },
    );
  }

  type ChatResponse = {
    choices?: { message?: { content?: string } }[];
    model?: string;
  };
  const data = (await response.json()) as ChatResponse;
  const refined = data.choices?.[0]?.message?.content?.trim();
  if (!refined) {
    return NextResponse.json({ error: "refine-prompt returned empty content" }, { status: 502 });
  }

  console.info(
    `[refine-prompt] raw="${userPrompt.slice(0, 100)}…" refined="${refined.slice(0, 200)}…"`,
  );

  return NextResponse.json({
    refinedPrompt: refined,
    model: data.model ?? REFINER_MODEL,
  });
}
