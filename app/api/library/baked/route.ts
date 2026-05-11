/**
 * GET /api/library/baked
 *
 * Lists the baked puppet zips currently sitting in the auto-publish
 * output directory. The library landing page calls this to render a
 * `[Baked]` badge on each library card, so the user can tell at a
 * glance which puppets are actually exposed via the shared volume
 * (vs. still living only in their browser IndexedDB).
 *
 * No assumption about who consumes the volume downstream — this
 * route just reports "what files are on disk right now". In deployed
 * builds the docker volume is shared with Geny; in stand-alone hobby
 * use the directory is unset and we return 503.
 *
 * Filename convention (mirrors `POST /api/library/sync`):
 *   `<puppet_id>.zip` at the top level of the output directory.
 *
 * Response 200: {
 *   outputDir: string,
 *   baked: Array<{
 *     puppetId: string,        // derived from filename (slugified id)
 *     filename: string,
 *     sizeBytes: number,
 *     modifiedIso: string,     // ISO 8601 mtime
 *   }>
 * }
 * Response 503: output directory unconfigured (stand-alone build)
 */

import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function outputDir(): string | null {
  return process.env.GENY_BAKED_EXPORTS_DIR?.trim() || null;
}

export async function GET(_req: NextRequest): Promise<NextResponse> {
  const dir = outputDir();
  if (!dir) {
    return NextResponse.json(
      {
        error:
          "auto-publish 가 구성되지 않았습니다 (GENY_BAKED_EXPORTS_DIR 미설정). 단독 모드에서는 baked 목록이 비활성화됩니다.",
      },
      { status: 503 },
    );
  }

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    // Directory hasn't been created yet (no puppet has been baked).
    // That's a valid empty state, not an error.
    return NextResponse.json({ outputDir: dir, baked: [] });
  }

  const baked: Array<{
    puppetId: string;
    filename: string;
    sizeBytes: number;
    modifiedIso: string;
  }> = [];

  for (const name of entries) {
    if (!name.toLowerCase().endsWith(".zip")) continue;
    // Filename is `<puppet_id>.zip` (slugified). Puppet IDs we issue
    // are already filesystem-safe (e.g. "av_XXXXXX") so the slug is
    // a no-op and stripping ".zip" recovers the id. Legacy zips with
    // exotic ids might mis-decode here — that's acceptable, the
    // library page only uses this for visual badge UX, not as a
    // primary key.
    const puppetId = name.replace(/\.zip$/i, "");
    try {
      const st = await stat(path.join(dir, name));
      if (!st.isFile()) continue;
      baked.push({
        puppetId,
        filename: name,
        sizeBytes: st.size,
        modifiedIso: new Date(st.mtimeMs).toISOString(),
      });
    } catch {
      // Race or permissions issue on a single entry — skip it rather
      // than failing the whole listing.
    }
  }

  baked.sort((a, b) => b.modifiedIso.localeCompare(a.modifiedIso));
  return NextResponse.json({ outputDir: dir, baked });
}
