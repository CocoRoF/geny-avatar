/**
 * POST /api/library/sync
 *
 * Auto-publish destination. The browser POSTs a baked model zip
 * (produced by `lib/autoPublish/libraryPublisher`) and we write it
 * straight to the configured output directory — typically a docker
 * volume shared with whatever downstream service consumes the
 * library (in our deployment that's Geny, but the route makes no
 * assumption about who picks the zip up).
 *
 * No HTTP forwarding, no upstream coupling. The browser sees a
 * single hop; the downstream service is responsible for noticing
 * new files in its mount of the same volume and acting on them.
 *
 * Filename convention: `<puppet_id>.zip`, derived from the zip's
 * own `avatar-editor.json` sidecar so re-publishes overwrite in
 * place. Downstream dedups by `puppet.id` from the sidecar.
 *
 * Body (multipart/form-data):
 *   zip   File   The baked model ZIP from `buildModelZip()` or
 *                `buildPassthroughZip()`.
 *
 * Response 200: { savedAs: string, bytes: number, puppetId: string }
 * Response 400: malformed upload (missing zip, missing puppet.id)
 * Response 503: output directory unconfigured (stand-alone build)
 * Response 5xx: filesystem failures
 */

import { Buffer } from "node:buffer";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import * as zlib from "node:zlib";
import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Directory on the server filesystem where baked library zips
 *  are written. In deployed builds this is mounted as a docker
 *  volume shared with the downstream consumer; in stand-alone hobby
 *  use it can be any local path. Unset → publish disabled (503). */
function outputDir(): string | null {
  return process.env.GENY_BAKED_EXPORTS_DIR?.trim() || null;
}

/** Slug for the filename — keeps it filesystem-safe across whatever
 *  platform mounts the volume. Mirrors the slug logic the
 *  downstream Geny side uses for de-collision. */
function slugify(s: string, max = 48): string {
  const cleaned = s.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return (cleaned || "puppet").slice(0, max);
}

/** Peek a zip's avatar-editor.json sidecar to extract the puppet
 *  id. Avoids depending on a full zip library by parsing the
 *  central directory ourselves — these zips are small and the
 *  central directory is at the tail so it's fast. */
async function peekPuppetIdFromZip(zipBuffer: Uint8Array): Promise<string | null> {
  // Find EOCD (End of Central Directory) — the signature 0x06054b50
  // sits within the last ~64KB of the file.
  const buf = Buffer.from(zipBuffer.buffer, zipBuffer.byteOffset, zipBuffer.byteLength);
  const EOCD_SIG = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;

  const cdOffset = buf.readUInt32LE(eocd + 16);
  const cdSize = buf.readUInt32LE(eocd + 12);
  let p = cdOffset;
  const cdEnd = cdOffset + cdSize;
  while (p < cdEnd) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break; // central file header sig
    const compMethod = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const fileNameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localHeaderOffset = buf.readUInt32LE(p + 42);
    const fileName = buf.slice(p + 46, p + 46 + fileNameLen).toString("utf-8");
    p += 46 + fileNameLen + extraLen + commentLen;

    if (fileName === "avatar-editor.json" || fileName === "avatar.json") {
      // Read the local file header to find the actual data offset.
      const lh = localHeaderOffset;
      const lhNameLen = buf.readUInt16LE(lh + 26);
      const lhExtraLen = buf.readUInt16LE(lh + 28);
      const dataStart = lh + 30 + lhNameLen + lhExtraLen;
      const raw = buf.slice(dataStart, dataStart + compSize);
      let decoded: Buffer;
      if (compMethod === 0) {
        decoded = raw;
      } else if (compMethod === 8) {
        decoded = zlib.inflateRawSync(raw);
      } else {
        return null;
      }
      try {
        const meta = JSON.parse(decoded.toString("utf-8"));
        return (meta?.puppet?.id as string) || null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const dir = outputDir();
  if (!dir) {
    return NextResponse.json(
      {
        error:
          "auto-publish 가 구성되지 않았습니다 (GENY_BAKED_EXPORTS_DIR 미설정). 단독 모드에서는 라이브러리 sync 가 비활성화됩니다.",
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
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "zip 필드가 없습니다 (File 필요)" }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength === 0) {
    return NextResponse.json({ error: "empty zip upload" }, { status: 400 });
  }

  // The downstream consumer dedupes by puppet.id from the sidecar.
  // We use the same id as the filename so re-publishes overwrite in
  // place and a delete only has to unlink one well-known path.
  const puppetId = await peekPuppetIdFromZip(bytes);
  if (!puppetId) {
    return NextResponse.json(
      {
        error:
          "avatar-editor.json puppet.id 누락 — sidecar 에 puppet.id 가 포함된 zip 만 허용됩니다.",
      },
      { status: 400 },
    );
  }

  const filename = `${slugify(puppetId)}.zip`;
  const target = path.join(dir, filename);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(target, bytes);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[auto-publish] write failed for ${target}:`, msg);
    return NextResponse.json({ error: `출력 디렉토리에 쓰기 실패: ${msg}` }, { status: 500 });
  }
  console.info(`[auto-publish] wrote ${target} (${bytes.byteLength} bytes, puppetId=${puppetId})`);
  return NextResponse.json({
    savedAs: filename,
    bytes: bytes.byteLength,
    puppetId,
  });
}
