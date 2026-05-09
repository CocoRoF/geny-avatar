"use client";

import {
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { submitSam } from "@/lib/ai/sam/client";
import type { SamCandidate, SamPoint } from "@/lib/ai/sam/types";

/**
 * /poc/sam-debug — Sprint 6.1 diagnostic surface.
 *
 *   1. Drop or pick a PNG/JPEG/WebP.
 *   2. Left-click the source canvas to add foreground points (label=1).
 *      Right-click for background points (label=0).
 *   3. "auto-mask" → calls /api/ai/sam → renders the candidate masks.
 *   4. Hover a candidate to overlay it on the source for quick eyeballing.
 *
 * No editor state, no IDB, no DecomposeStudio integration — just a
 * verification harness for the route + client lib. Sprint 6.2 wires
 * the same flow into DecomposeStudio.
 */
export default function SamDebugPage() {
  const [imageBlob, setImageBlob] = useState<Blob | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [imageDims, setImageDims] = useState<{ w: number; h: number } | null>(null);
  const [points, setPoints] = useState<SamPoint[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<{
    candidates: SamCandidate[];
    model: string;
    elapsedMs: number;
  } | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Build object URLs for candidate masks; revoke on change/unmount.
  const candidateUrls = useMemo(() => {
    if (!response) return [];
    return response.candidates.map((c) => URL.createObjectURL(c.maskBlob));
  }, [response]);
  useEffect(() => {
    return () => {
      for (const u of candidateUrls) URL.revokeObjectURL(u);
    };
  }, [candidateUrls]);

  const onPick = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    if (!file) return;
    const url = URL.createObjectURL(file);
    setImageBlob(file);
    setImageDataUrl(url);
    setPoints([]);
    setResponse(null);
    setError(null);
    const img = new Image();
    img.onload = () => setImageDims({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = url;
  }, []);

  // Cleanup the source object URL when it changes.
  useEffect(() => {
    return () => {
      if (imageDataUrl) URL.revokeObjectURL(imageDataUrl);
    };
  }, [imageDataUrl]);

  const handleCanvasClick = useCallback(
    (ev: ReactMouseEvent<HTMLCanvasElement>) => {
      if (!imageDims || !canvasRef.current) return;
      ev.preventDefault();
      const rect = canvasRef.current.getBoundingClientRect();
      const xRatio = (ev.clientX - rect.left) / rect.width;
      const yRatio = (ev.clientY - rect.top) / rect.height;
      const x = Math.round(xRatio * imageDims.w);
      const y = Math.round(yRatio * imageDims.h);
      // 0 = primary (left), 2 = secondary (right). chrome's auxclick
      // can fire button=1 (middle); we treat anything not-left as bg.
      const label: 0 | 1 = ev.button === 0 ? 1 : 0;
      setPoints((p) => [...p, { x, y, label }]);
    },
    [imageDims],
  );

  const submit = useCallback(async () => {
    if (!imageBlob || points.length === 0) return;
    if (!points.some((p) => p.label === 1)) {
      setError("at least one foreground click (left-click) needed");
      return;
    }
    setSubmitting(true);
    setError(null);
    setResponse(null);
    try {
      const r = await submitSam({ imageBlob, points });
      setResponse(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }, [imageBlob, points]);

  return (
    <div className="min-h-screen bg-neutral-950 px-6 py-8 text-neutral-100">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">SAM debug · Sprint 6.1</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Click-driven segmentation harness. Left-click = foreground, right-click = background.
        </p>
      </header>

      <section className="mb-4 flex items-center gap-3 text-sm">
        <label className="cursor-pointer rounded bg-neutral-800 px-3 py-1.5 hover:bg-neutral-700">
          <input type="file" accept="image/*" className="hidden" onChange={onPick} />
          pick image…
        </label>
        <button
          type="button"
          onClick={() => setPoints([])}
          disabled={points.length === 0}
          className="rounded bg-neutral-800 px-3 py-1.5 disabled:opacity-50 hover:bg-neutral-700"
        >
          reset points
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!imageBlob || points.length === 0 || submitting}
          className="rounded bg-blue-600 px-3 py-1.5 disabled:opacity-50 hover:bg-blue-500"
        >
          {submitting ? "running…" : "auto-mask"}
        </button>
        <span className="text-xs text-neutral-500">
          points: {points.length} (fg {points.filter((p) => p.label === 1).length} / bg{" "}
          {points.filter((p) => p.label === 0).length})
        </span>
      </section>

      {error && (
        <div className="mb-4 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        <div>
          <h2 className="mb-2 text-xs uppercase tracking-wide text-neutral-500">source</h2>
          {imageDataUrl && imageDims ? (
            <div className="relative inline-block">
              {/* Source image as a backdrop */}
              {/* biome-ignore lint/performance/noImgElement: ad-hoc poc page, not user-facing */}
              <img
                src={imageDataUrl}
                alt="source"
                className="block max-h-[60vh] max-w-full select-none"
                draggable={false}
              />
              {/* Hovered candidate as a translucent overlay */}
              {hoverIdx !== null && candidateUrls[hoverIdx] && (
                // biome-ignore lint/performance/noImgElement: same
                <img
                  src={candidateUrls[hoverIdx]}
                  alt="hover overlay"
                  className="pointer-events-none absolute inset-0 h-full w-full opacity-60 mix-blend-screen"
                  draggable={false}
                />
              )}
              {/* Click capture canvas sits on top (transparent) */}
              <canvas
                ref={canvasRef}
                width={imageDims.w}
                height={imageDims.h}
                className="absolute inset-0 h-full w-full cursor-crosshair"
                onClick={handleCanvasClick}
                onContextMenu={handleCanvasClick}
              />
              {/* Render the points as SVG dots over the image */}
              <svg
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 h-full w-full"
                viewBox={`0 0 ${imageDims.w} ${imageDims.h}`}
              >
                {points.map((p, idx) => (
                  <circle
                    // biome-ignore lint/suspicious/noArrayIndexKey: stable per click order
                    key={idx}
                    cx={p.x}
                    cy={p.y}
                    r={Math.max(4, imageDims.w / 200)}
                    fill={p.label === 1 ? "#22c55e" : "#ef4444"}
                    stroke="#000"
                    strokeWidth={1}
                  />
                ))}
              </svg>
            </div>
          ) : (
            <div className="rounded border border-dashed border-neutral-700 px-6 py-12 text-center text-sm text-neutral-500">
              pick an image to start
            </div>
          )}
          {imageDims && (
            <p className="mt-2 text-xs text-neutral-500">
              {imageDims.w} × {imageDims.h} px
            </p>
          )}
        </div>

        <div>
          <h2 className="mb-2 text-xs uppercase tracking-wide text-neutral-500">candidates</h2>
          {response ? (
            <>
              <p className="mb-3 text-xs text-neutral-500">
                model {response.model} · {response.elapsedMs}ms · {response.candidates.length} mask
                {response.candidates.length === 1 ? "" : "s"}
              </p>
              <div className="grid grid-cols-3 gap-2">
                {candidateUrls.map((url, idx) => (
                  <button
                    type="button"
                    // biome-ignore lint/suspicious/noArrayIndexKey: order-stable
                    key={idx}
                    onMouseEnter={() => setHoverIdx(idx)}
                    onMouseLeave={() => setHoverIdx(null)}
                    className="group relative overflow-hidden rounded border border-neutral-800 bg-neutral-900 hover:border-blue-500"
                  >
                    {/* biome-ignore lint/performance/noImgElement: same */}
                    <img src={url} alt={`candidate ${idx}`} className="block h-auto w-full" />
                    <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-xs">
                      {idx + 1}
                      {response.candidates[idx].score !== undefined &&
                        ` · ${response.candidates[idx].score?.toFixed(2)}`}
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="rounded border border-dashed border-neutral-700 px-6 py-12 text-center text-sm text-neutral-500">
              {submitting ? "calling SAM…" : "click points and run auto-mask"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
