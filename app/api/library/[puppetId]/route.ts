/**
 * DELETE /api/library/[puppetId]
 *
 * Server-side proxy for the library remove flow. Mirrors the sync POST
 * route — forwards `DELETE /api/vtuber/library/{puppet_id}` to Geny's
 * backend. Used when the user deletes a puppet from geny-avatar's
 * library so the same id is dropped from Geny's model registry.
 *
 * Response 200: forwards Geny's removal summary.
 * Response 404: forwards "no entry with this id"; safe to ignore on
 *               the caller side (idempotent).
 * Response 503: Geny mode not configured.
 */

import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function genyBackendUrl(): string | null {
  return process.env.GENY_BACKEND_URL?.trim() || null;
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ puppetId: string }> },
): Promise<NextResponse> {
  if (process.env.NEXT_PUBLIC_GENY_HOST !== "true") {
    return NextResponse.json(
      {
        error:
          "Geny 통합 모드가 아닙니다 (NEXT_PUBLIC_GENY_HOST!=='true'). 단독 모드에서는 sync delete가 비활성화됩니다.",
      },
      { status: 503 },
    );
  }
  const backend = genyBackendUrl();
  if (!backend) {
    return NextResponse.json(
      { error: "GENY_BACKEND_URL 환경변수가 설정되지 않았습니다." },
      { status: 503 },
    );
  }

  const { puppetId } = await ctx.params;
  if (!puppetId || !puppetId.trim()) {
    return NextResponse.json({ error: "puppetId is required" }, { status: 400 });
  }

  const target = `${backend.replace(/\/$/, "")}/api/vtuber/library/${encodeURIComponent(puppetId)}`;
  let resp: Response;
  try {
    resp = await fetch(target, { method: "DELETE" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[library-delete] proxy fetch failed → ${target}: ${msg}`);
    return NextResponse.json(
      { error: `Geny 백엔드에 연결 실패: ${msg}` },
      { status: 502 },
    );
  }

  let body: unknown;
  try {
    body = await resp.json();
  } catch {
    body = { error: `Geny 응답 파싱 실패 (status=${resp.status})` };
  }
  return NextResponse.json(body, { status: resp.status });
}
