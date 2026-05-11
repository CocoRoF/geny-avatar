/**
 * DELETE /api/library/[puppetId]
 *
 * Unlink the puppet's published zip from the auto-publish output
 * directory. The downstream consumer's watcher notices the file
 * disappear on the next scan and drops its registry entry — no
 * HTTP coupling.
 *
 * Cleans up two locations:
 *   - `<output>/<puppet_id>.zip` — the live published copy
 *   - `<output>/installed/<puppet_id>.zip` — legacy archive copy
 *     left behind by manual installs from before auto-publish (still
 *     unlinks if present so the watcher doesn't keep the entry alive
 *     via the archive).
 *
 * Idempotent: always returns 200, body lists which files were
 * actually removed.
 */

import { stat, unlink } from "node:fs/promises";
import path from "node:path";
import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function outputDir(): string | null {
  return process.env.GENY_BAKED_EXPORTS_DIR?.trim() || null;
}

function slugify(s: string, max = 48): string {
  const cleaned = s.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return (cleaned || "puppet").slice(0, max);
}

async function tryUnlink(p: string): Promise<boolean> {
  try {
    await stat(p);
  } catch {
    return false;
  }
  try {
    await unlink(p);
    return true;
  } catch (e) {
    console.warn(`[auto-publish] unlink failed for ${p}:`, e);
    return false;
  }
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ puppetId: string }> },
): Promise<NextResponse> {
  const dir = outputDir();
  if (!dir) {
    return NextResponse.json(
      {
        error:
          "auto-publish 가 구성되지 않았습니다 (GENY_BAKED_EXPORTS_DIR 미설정). 단독 모드에서는 sync delete 가 비활성화됩니다.",
      },
      { status: 503 },
    );
  }

  const { puppetId } = await ctx.params;
  if (!puppetId || !puppetId.trim()) {
    return NextResponse.json({ error: "puppetId is required" }, { status: 400 });
  }

  const filename = `${slugify(puppetId)}.zip`;
  const removed: string[] = [];

  for (const candidate of [path.join(dir, filename), path.join(dir, "installed", filename)]) {
    if (await tryUnlink(candidate)) {
      removed.push(candidate);
    }
  }

  console.info(`[auto-publish] removed ${removed.length} file(s) for puppetId=${puppetId}`);
  return NextResponse.json({
    status: "ok",
    puppetId,
    removed,
  });
}
