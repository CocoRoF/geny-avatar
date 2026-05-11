/**
 * POST /api/send-to-geny — DEPRECATED.
 *
 * Superseded by `POST /api/library/sync`, which forwards directly to
 * Geny's `/api/vtuber/library/sync` endpoint. The new flow is fully
 * automatic (driven by IndexedDB write hooks in `lib/autoPublish/libraryPublisher`)
 * so the legacy "Send to Geny" button is gone. This route stays around
 * in case anything still pokes it programmatically — it keeps the
 * shared-volume drop semantics, but the recommended path is the
 * library sync endpoint. Safe to delete in a follow-up cleanup once
 * the migration is verified end-to-end.
 *
 * Body (multipart/form-data):
 *   zip       File    The baked model ZIP from buildModelZip().
 *   filename  string  Suggested basename (e.g. "spineboy.zip"). We
 *                     sanitize and prepend a timestamp to avoid
 *                     collisions on the receiving side.
 *
 * Response 200: { savedAs: string, bytes: number }
 * Response 4xx/5xx: { error: string }
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { type NextRequest, NextResponse } from "next/server";

// Force the Node runtime — we use fs/promises which doesn't exist on
// the edge. Body size limit raised because baked atlas zips for big
// puppets can comfortably hit 30–50 MB.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXPORTS_DIR = process.env.GENY_BAKED_EXPORTS_DIR || "/exports";

// Strip path separators / null / control chars and clamp the basename
// length. The receiving side (Geny backend) re-validates, but we want
// the filename on disk to be sane regardless.
function sanitizeBasename(input: string): string {
  const last = input.split(/[\\/]/).pop() ?? "puppet.zip";
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping is the point
  const cleaned = last.replace(/[\x00-\x1f\x7f]/g, "_").replace(/\.{2,}/g, "_");
  const trimmed = cleaned.slice(0, 200);
  return trimmed || "puppet.zip";
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `_${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (process.env.NEXT_PUBLIC_GENY_HOST !== "true") {
    return NextResponse.json(
      {
        error:
          "Geny 통합 모드가 아닙니다 (NEXT_PUBLIC_GENY_HOST!=='true'). 단독 사용 시 'export model' 다운로드를 사용하세요.",
      },
      { status: 503 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch (e) {
    return NextResponse.json(
      { error: `multipart 파싱 실패: ${e instanceof Error ? e.message : String(e)}` },
      { status: 400 },
    );
  }

  const file = form.get("zip");
  const suggested = form.get("filename");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "zip 필드가 없습니다 (File 필요)" }, { status: 400 });
  }
  if (typeof suggested !== "string") {
    return NextResponse.json({ error: "filename 필드가 없습니다 (string 필요)" }, { status: 400 });
  }

  const basename = sanitizeBasename(suggested);
  // Inject timestamp BEFORE the extension so file managers still group
  // by puppet name + show ordering by ts within the group.
  const dot = basename.lastIndexOf(".");
  const stem = dot > 0 ? basename.slice(0, dot) : basename;
  const ext = dot > 0 ? basename.slice(dot) : ".zip";
  const finalName = `${stem}__${timestamp()}${ext}`;

  try {
    await mkdir(EXPORTS_DIR, { recursive: true });
    const target = path.join(EXPORTS_DIR, finalName);
    const buf = Buffer.from(await file.arrayBuffer());
    await writeFile(target, buf);
    console.info(`[send-to-geny] wrote ${target} (${buf.length} bytes, original=${suggested})`);
    return NextResponse.json({ savedAs: finalName, bytes: buf.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[send-to-geny] write failed for ${EXPORTS_DIR}/${finalName}:`, msg);
    return NextResponse.json({ error: `${EXPORTS_DIR} 에 쓰기 실패: ${msg}` }, { status: 500 });
  }
}
