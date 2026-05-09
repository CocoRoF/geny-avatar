/**
 * POST /api/ai/refine-prompt
 *
 * Vision-enabled prompt refiner. Takes the user's raw prompt + the
 * actual source canvas + the actual reference images, sends them to a
 * vision-capable OpenAI chat model, and returns a precise gpt-image-2
 * edit instruction that *describes the design seen in the references*
 * concretely instead of using vague "style only" language.
 *
 * Earlier (text-only) versions of this endpoint had a fundamental
 * blindspot: the LLM never saw the images, so when the user said
 * "make it look like the reference", the refined prompt could only
 * say "use the reference as a style anchor" — without naming the
 * actual design (e.g. "navy pleated skirt with white lace hem and
 * metal stud accents"). gpt-image-2 then had nothing concrete to
 * apply, and the result borrowed mood / palette but missed the
 * specific design the user wanted.
 *
 * Now the endpoint forwards every image to the chat model with
 * `detail: "high"`, and the system prompt instructs the LLM to LOOK
 * at the references and write specific design descriptions into the
 * refined prompt. This is the cloud-API stand-in for IP-Adapter
 * with proper visual grounding.
 *
 * Body (multipart/form-data):
 *   userPrompt        string  what the user typed
 *   layerName?        string  layer's display name (helps describe subject)
 *   hasMask           string  "true" | "false"
 *   negativePrompt?   string  optional things-to-avoid
 *   sourceImage       File    PNG/JPEG/WebP of the layer being edited
 *   referenceImage    File*   zero or more design references (repeated key)
 *
 * Response: { refinedPrompt, model } on success
 *
 * The endpoint requires `OPENAI_API_KEY`. Caller falls back to the
 * raw prompt if anything goes wrong here.
 */

import { NextResponse } from "next/server";

// Default to OpenAI's flagship `gpt-5.4` so the refinement pass has the
// best language- and vision-quality lever available — looking at a
// reference image and naming its specific design ("navy pleated skirt
// with white lace hem") needs real multimodal reasoning.
// Override per-deployment via OPENAI_PROMPT_REFINER_MODEL when the
// account doesn't have gpt-5.4 access or you want to fall back to a
// cheaper tier (e.g. `gpt-5-mini`, `gpt-4o-mini`, `gpt-4o`). The
// model **must support vision** — text-only models will reject the
// image_url parts in the request body.
const REFINER_MODEL = process.env.OPENAI_PROMPT_REFINER_MODEL ?? "gpt-5.4";
const ENDPOINT = "https://api.openai.com/v1/chat/completions";

const SYSTEM_PROMPT = `You are a prompt engineer for OpenAI's gpt-image-2 image-edit API. You see the actual images attached below and rewrite the user's edit request into a precise structured instruction.

How the pipeline works (read carefully — this changes what's "safe" to transfer):

- [image 1] is one slot of a 2D rigged-puppet atlas. It might be a clothing piece (skirt / shirt / shoe), a body region (face / hair / hand), an accessory (ribbon / chain), or a background plate. It is rarely a full character.
- [image 2], [image 3]... are user-attached references for the desired look. They are typically full character/scene illustrations, so you have to pick the part of each reference that matches what [image 1] actually shows.
- After the image model returns its result, our pipeline alpha-clips it to [image 1]'s exact silhouette. So no matter what the model paints, only pixels inside [image 1]'s shape land in the puppet. **You don't have to police silhouette in your prompt — the renderer enforces it for free.** What you have to police is what fills that silhouette.

How to read the images:

1. Look at [image 1]. Decide what region of the puppet it represents — skirt, face, hair, accessory, etc. State this implicitly through the prompt's wording.
2. For each reference, look at the matching region (skirt of the character if [image 1] is a skirt, face of the character if [image 1] is a face, etc.). That's the part the user wants transferred.
3. Embed CONCRETE descriptions of that matching region's visible content — palette, pattern, material, decorations, distinguishing features — into the refined prompt. Concrete words ("navy pleated skirt with white lace hem and metal stud seams", "round face with red irises and short black hair with a red highlight"), NOT abstract style words ("matches the reference's vibe").

Hard rules — never violate:

1. The user's intent dominates. Sharpen HOW it's expressed without changing WHAT they asked for.

2. Content transfer is OPEN. If [image 1] is a face layer and the user wants the reference's face on it, transfer the face. If [image 1] is hair and they want the reference's hair, transfer the hair. The only fixed contract is that the output gets clipped to [image 1]'s silhouette — within that, anything visually justified by the user's intent + the references is fine.

3. Match the right region. Don't paint a face onto a skirt slot. Don't paint a hand onto a hair slot. The "matching region" rule above is what prevents wrong content from landing in [image 1].

4. Embed concrete visual descriptors from the references. "Apply the reference's vibe" is too vague to be useful — name the specific colors, patterns, materials, decorations the model should reproduce.

5. Briefly remind the model to keep [image 1]'s shape framing (silhouette, crop framing, pose if it's a body region) so the result sits on the same canvas the puppet renders into. Don't elaborate — the alpha-clip step handles the rest.

6. Single paragraph or short multi-paragraph block. No markdown, no bullets, no quotes around the whole output, no preamble.

7. Do NOT prepend "Edit [image 1]:" yourself — the wrapper adds that verb. Start with the descriptive instruction.

8. If the user's prompt is already structured and precise, return it nearly verbatim with at most light cleanup.

9. Output ONLY the refined prompt itself.

Common failure patterns to fix:
- User says "make it look like the reference" → identify [image 1]'s region, find the matching region of [image 2..N], embed concrete descriptions of what that region looks like (e.g. for a skirt: "pleated navy mini-skirt with white lace hem and metallic studs along the seams").
- User asks for a feature visible in the reference → call it out by name (lace, pleats, ribbon, blue hair, red eyes) and place it relative to [image 1]'s framing.
- User uses informal language → tighten to imperative voice without losing meaning.`;

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
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
  const layerName = form.get("layerName");
  const hasMaskStr = form.get("hasMask");
  const negativePrompt = form.get("negativePrompt");
  const sourceImage = form.get("sourceImage");
  const refImages = form.getAll("referenceImage").filter((v): v is File => v instanceof File);

  if (typeof userPrompt !== "string" || userPrompt.trim().length === 0) {
    return NextResponse.json({ error: "userPrompt required" }, { status: 400 });
  }
  if (!(sourceImage instanceof Blob)) {
    return NextResponse.json({ error: "sourceImage required" }, { status: 400 });
  }

  const refCount = refImages.length;
  const hasMask = hasMaskStr === "true";

  // Encode every image as a data: URL so it can ride along in the
  // chat completion's `image_url` parts. detail="high" so the model
  // can read texture / pattern details — refining "navy pleated
  // skirt with lace trim" out of a small thumb is exactly what the
  // high-detail tile pipeline is for.
  const sourceMime = sourceImage.type || "image/png";
  const sourceBuf = Buffer.from(await sourceImage.arrayBuffer());
  const sourceDataUrl = `data:${sourceMime};base64,${sourceBuf.toString("base64")}`;
  const refDataUrls = await Promise.all(
    refImages.map(async (f) => {
      const mime = f.type || "image/png";
      const buf = Buffer.from(await f.arrayBuffer());
      return `data:${mime};base64,${buf.toString("base64")}`;
    }),
  );

  const userMessageText = [
    `Subject layer: ${typeof layerName === "string" && layerName ? layerName : "(no display name)"}`,
    `Reference images attached: ${refCount}`,
    `Mask present (alpha-defined edit zone on [image 1]): ${hasMask ? "yes" : "no"}`,
    typeof negativePrompt === "string" && negativePrompt.trim()
      ? `User's "avoid" hints: ${negativePrompt.trim()}`
      : null,
    "",
    `User's raw prompt: """${userPrompt.trim()}"""`,
    "",
    `Below this message: the FIRST image is [image 1] (the source canvas to edit). The next ${refCount} image${refCount === 1 ? "" : "s"} ${refCount === 1 ? "is" : "are"} the design reference${refCount === 1 ? "" : "s"} ${refCount === 1 ? "[image 2]" : `[image 2]..[image ${refCount + 1}]`}.`,
    "",
    "Look at every attached image. Identify the specific design elements visible in the reference(s) that should land on [image 1]'s silhouette. Embed concrete descriptions of those elements (palette, pattern, material, decorations, trim, lighting) directly in the refined prompt. Do not narrate. Output the refined prompt text only — and do not start with the verb 'Edit [image 1]:' since the wrapper adds that.",
  ]
    .filter((x): x is string => typeof x === "string")
    .join("\n");

  // Vision message format: alternating text and image_url parts.
  type ChatContentPart =
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } };
  const userContent: ChatContentPart[] = [
    { type: "text", text: userMessageText },
    { type: "image_url", image_url: { url: sourceDataUrl, detail: "high" } },
    ...refDataUrls.map(
      (url): ChatContentPart => ({
        type: "image_url",
        image_url: { url, detail: "high" },
      }),
    ),
  ];

  const startedAt = Date.now();
  console.info(
    `[refine-prompt] POST ${ENDPOINT} model=${REFINER_MODEL} refCount=${refCount} hasMask=${hasMask} sourceBytes=${sourceImage.size} refBytes=${refImages.map((r) => r.size).join(",")} userPromptLen=${userPrompt.length}`,
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
          { role: "user", content: userContent },
        ],
        // Low-ish temperature so the rewrite stays close to user intent
        // while still naming what's in the reference. 0 would make the
        // model parrot the user prompt verbatim and skip the design
        // description; >0.5 starts inventing details that aren't in the
        // reference.
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
    `[refine-prompt] raw="${userPrompt.slice(0, 100)}…" refined="${refined.slice(0, 400)}${refined.length > 400 ? "…" : ""}"`,
  );

  return NextResponse.json({
    refinedPrompt: refined,
    model: data.model ?? REFINER_MODEL,
  });
}
