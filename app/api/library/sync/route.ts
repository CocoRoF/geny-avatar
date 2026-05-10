/**
 * POST /api/library/sync
 *
 * Server-side proxy that forwards a baked puppet zip to Geny's library
 * sync endpoint (`POST /api/vtuber/library/sync`). Used by the browser
 * sync module (`lib/sync/genySync.ts`) whenever an IndexedDB write
 * triggers a debounced library push.
 *
 * Why a proxy instead of a direct browser → Geny call:
 *  - Geny runs on a different origin in docker compose (different port);
 *    a direct browser POST would need CORS coordination.
 *  - Standalone hobby use shouldn't break: when Geny isn't configured,
 *    we 503 with a clear error and the browser sync module logs it
 *    quietly without surfacing anything to the user.
 *
 * Body (multipart/form-data):
 *   zip   File   The baked model ZIP from buildModelZip().
 *
 * Response 200: forwards Geny's response body (model + replaced summary).
 * Response 503: Geny mode not configured (env vars missing).
 * Response 4xx/5xx: forwards Geny's error or local proxy failure.
 */

import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// `GENY_BACKEND_URL` is the server-to-server URL of Geny's FastAPI
// backend (e.g. "http://backend:8000" inside docker compose). We don't
// expose this to the browser — only the Next.js server uses it.
function genyBackendUrl(): string | null {
  return process.env.GENY_BACKEND_URL?.trim() || null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (process.env.NEXT_PUBLIC_GENY_HOST !== "true") {
    return NextResponse.json(
      {
        error:
          "Geny 통합 모드가 아닙니다 (NEXT_PUBLIC_GENY_HOST!=='true'). 단독 모드에서는 라이브러리 sync가 비활성화됩니다.",
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

  // Forward as a fresh multipart body. Building a new FormData rather
  // than passing through the request directly so this proxy is robust
  // to body re-streaming quirks (the original was already consumed).
  const fwd = new FormData();
  fwd.append("zip", file, file.name || "puppet.zip");

  const target = `${backend.replace(/\/$/, "")}/api/vtuber/library/sync`;
  let resp: Response;
  try {
    resp = await fetch(target, {
      method: "POST",
      body: fwd,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[library-sync] proxy fetch failed → ${target}: ${msg}`);
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
