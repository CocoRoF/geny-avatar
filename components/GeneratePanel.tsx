"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AvatarAdapter } from "@/lib/adapters/AvatarAdapter";
import {
  buildOpenAIMaskCanvas,
  canvasToPngBlob,
  fetchProviders,
  type ProviderAvailability,
  padToOpenAISquare,
  submitGenerate,
} from "@/lib/ai/client";
import type { ProviderId } from "@/lib/ai/types";
import { extractLayerCanvas } from "@/lib/avatar/regionExtract";
import type { Layer } from "@/lib/avatar/types";
import { useEditorStore } from "@/lib/store/editor";

type Props = {
  adapter: AvatarAdapter | null;
  layer: Layer;
};

/**
 * AI texture generation modal. The submit path now hits real backends
 * — Google Gemini (Nano Banana) and OpenAI gpt-image-2 — through the
 * Next.js `/api/ai/*` routes. Replicate / SDXL ControlNet lands in
 * Sprint 3.2; the picker shows it as unavailable until then.
 *
 * Flow:
 *   1. Mount → extractLayerCanvas captures the layer footprint.
 *   2. Mount → fetch /api/ai/providers to learn which keys are set.
 *   3. User picks provider, types prompt, clicks generate.
 *   4. Client converts source / mask to the provider's expected
 *      shape (canvasToPngBlob, padToOpenAISquare, buildOpenAIMaskCanvas).
 *   5. submitGenerate POSTs and polls until done; returns the result blob.
 *   6. Preview shown next to the source. Apply-to-atlas lands in 3.3.
 */
export function GeneratePanel({ adapter, layer }: Props) {
  const close = useEditorStore((s) => s.setGenerateLayer);
  const existingMask = useEditorStore((s) => s.layerMasks[layer.id] ?? null);

  const sourceRef = useRef<HTMLCanvasElement | null>(null);
  const sourceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [providers, setProviders] = useState<ProviderAvailability[] | null>(null);
  const [providerId, setProviderId] = useState<ProviderId>("gemini");
  const [modelId, setModelId] = useState<string>("");
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");

  const [phase, setPhase] = useState<
    | { kind: "idle" }
    | { kind: "submitting" }
    | { kind: "running" }
    | { kind: "succeeded"; url: string; blob: Blob }
    | { kind: "failed"; reason: string }
  >({ kind: "idle" });

  // ----- mount: pull source region into a preview canvas -----
  useEffect(() => {
    setReady(false);
    setError(null);
    if (!adapter || !layer.texture) {
      setError("layer has no texture region");
      return;
    }
    const extracted = extractLayerCanvas(adapter, layer);
    if (!extracted) {
      setError("region rect is empty / unrenderable");
      return;
    }
    sourceCanvasRef.current = extracted.canvas;
    const display = sourceRef.current;
    if (display) {
      display.width = extracted.canvas.width;
      display.height = extracted.canvas.height;
      const ctx = display.getContext("2d");
      ctx?.drawImage(extracted.canvas, 0, 0);
    }
    setReady(true);
  }, [adapter, layer]);

  // ----- mount: load provider availability -----
  useEffect(() => {
    let cancelled = false;
    fetchProviders()
      .then((list) => {
        if (cancelled) return;
        setProviders(list);
        // pick the first available; fall back to gemini even if disabled
        const firstAvail = list.find((p) => p.available);
        if (firstAvail) {
          setProviderId(firstAvail.id);
          setModelId(firstAvail.capabilities.defaultModelId);
        }
      })
      .catch((e) => {
        console.warn("[GeneratePanel] /api/ai/providers failed", e);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Update modelId when provider changes
  useEffect(() => {
    const p = providers?.find((x) => x.id === providerId);
    if (p) setModelId(p.capabilities.defaultModelId);
  }, [providerId, providers]);

  // Esc closes (but not while running, to avoid losing in-flight job)
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      if (phase.kind === "running" || phase.kind === "submitting") return;
      close(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, phase.kind]);

  // Cleanup blob URL on phase change / unmount
  useEffect(() => {
    return () => {
      if (phase.kind === "succeeded") URL.revokeObjectURL(phase.url);
    };
  }, [phase]);

  const provider = providers?.find((p) => p.id === providerId);

  async function onSubmit() {
    setPhase({ kind: "submitting" });
    try {
      const sourceCanvas = sourceCanvasRef.current;
      if (!sourceCanvas) throw new Error("source not ready");
      if (!provider) throw new Error("provider unavailable");

      let sourceBlob: Blob;
      let maskBlob: Blob | undefined;

      if (providerId === "openai") {
        // OpenAI: pad source to 1024 square, convert mask alpha + match dims.
        const { canvas: padded, offset } = padToOpenAISquare(sourceCanvas);
        sourceBlob = await canvasToPngBlob(padded);
        if (existingMask) {
          const padMask = await buildOpenAIMaskCanvas(existingMask, offset);
          maskBlob = await canvasToPngBlob(padMask);
        }
      } else {
        // Gemini: arbitrary input dims. Pass source + raw mask through.
        sourceBlob = await canvasToPngBlob(sourceCanvas);
        maskBlob = existingMask ?? undefined;
      }

      setPhase({ kind: "running" });
      const result = await submitGenerate({
        providerId,
        prompt,
        negativePrompt: negativePrompt.trim() || undefined,
        modelId: modelId || undefined,
        sourceImage: sourceBlob,
        maskImage: maskBlob,
      });
      const url = URL.createObjectURL(result);
      setPhase({ kind: "succeeded", url, blob: result });
    } catch (e) {
      setPhase({ kind: "failed", reason: e instanceof Error ? e.message : String(e) });
    }
  }

  function onReset() {
    if (phase.kind === "succeeded") URL.revokeObjectURL(phase.url);
    setPhase({ kind: "idle" });
  }

  const submitDisabled =
    !ready ||
    !provider?.available ||
    phase.kind === "submitting" ||
    phase.kind === "running" ||
    !prompt.trim();

  const previewBg = useMemo<React.CSSProperties>(
    () => ({
      backgroundImage:
        "linear-gradient(45deg, #1a1d22 25%, transparent 25%), linear-gradient(-45deg, #1a1d22 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #1a1d22 75%), linear-gradient(-45deg, transparent 75%, #1a1d22 75%)",
      backgroundSize: "16px 16px",
      backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
      backgroundColor: "#0e1115",
    }),
    [],
  );

  return (
    <div className="fixed inset-0 z-40 flex items-stretch bg-black/70 backdrop-blur-sm">
      <button
        type="button"
        aria-label="close"
        onClick={() => close(null)}
        className="absolute inset-0 cursor-default"
      />
      <div className="relative z-10 m-auto flex h-[90vh] w-[min(92vw,1200px)] flex-col rounded border border-[var(--color-border)] bg-[var(--color-bg)] shadow-2xl">
        <header className="flex shrink-0 items-center gap-3 border-b border-[var(--color-border)] px-4 py-2 text-xs">
          <span className="font-mono text-[var(--color-accent)]">generate · v1</span>
          <span className="text-[var(--color-fg-dim)]">{layer.name}</span>
          {existingMask && provider?.capabilities.supportsBinaryMask && (
            <span
              className="rounded border border-[var(--color-accent)] px-1 font-mono text-[10px] text-[var(--color-accent)]"
              title="DecomposeStudio mask used as inpaint mask"
            >
              mask in use
            </span>
          )}
          {existingMask && provider && !provider.capabilities.supportsBinaryMask && (
            <span
              className="rounded border border-[var(--color-border)] px-1 font-mono text-[10px] text-[var(--color-fg-dim)]"
              title="provider doesn't take a binary mask; passed as a second reference image with prompt instructions"
            >
              mask as ref
            </span>
          )}
          <button
            type="button"
            onClick={() => close(null)}
            className="ml-auto rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
            title="esc"
          >
            close
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[1fr_1fr_320px] overflow-hidden">
          {/* source */}
          <div
            className="flex min-h-0 min-w-0 flex-col items-center justify-center gap-2 border-r border-[var(--color-border)] p-4"
            style={previewBg}
          >
            <div className="text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
              source
            </div>
            {error ? (
              <div className="text-sm text-red-400">{error}</div>
            ) : !ready ? (
              <div className="text-sm text-[var(--color-fg-dim)]">loading region…</div>
            ) : (
              <canvas
                ref={sourceRef}
                className="max-h-full max-w-full border border-[var(--color-border)]"
              />
            )}
          </div>

          {/* result */}
          <div
            className="flex min-h-0 min-w-0 flex-col items-center justify-center gap-2 p-4"
            style={previewBg}
          >
            <div className="text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
              result
            </div>
            {phase.kind === "idle" && (
              <div className="text-sm text-[var(--color-fg-dim)]">generate to see output</div>
            )}
            {phase.kind === "submitting" && (
              <div className="text-sm text-[var(--color-fg-dim)]">submitting…</div>
            )}
            {phase.kind === "running" && (
              <div className="flex flex-col items-center gap-1 text-sm text-[var(--color-fg-dim)]">
                <span>generating · provider call in flight</span>
                <span className="text-xs">Gemini ~5–15s · OpenAI ~10–30s · don't dismiss</span>
              </div>
            )}
            {phase.kind === "failed" && (
              <div className="max-w-md text-sm text-red-400">
                <div className="mb-2 font-medium">failed</div>
                <div className="text-xs">{phase.reason}</div>
                <button
                  type="button"
                  onClick={onReset}
                  className="mt-3 rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
                >
                  try again
                </button>
              </div>
            )}
            {phase.kind === "succeeded" && (
              // biome-ignore lint/performance/noImgElement: blob URL output
              <img
                src={phase.url}
                alt="generated"
                className="max-h-full max-w-full border border-[var(--color-border)]"
              />
            )}
          </div>

          <aside className="flex min-h-0 flex-col border-l border-[var(--color-border)] p-4 text-xs">
            <div className="mb-3">
              <div className="mb-1 uppercase tracking-widest text-[var(--color-fg-dim)]">
                provider
              </div>
              <select
                value={providerId}
                onChange={(e) => setProviderId(e.target.value as ProviderId)}
                className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm text-[var(--color-fg)] focus:border-[var(--color-accent)] focus:outline-none"
              >
                {(providers ?? []).map((p) => (
                  <option key={p.id} value={p.id} disabled={!p.available}>
                    {p.displayName}
                    {!p.available ? ` · ${p.reason}` : ""}
                  </option>
                ))}
              </select>
              {provider && !provider.available && (
                <div className="mt-1 text-[var(--color-fg-dim)]">{provider.reason}</div>
              )}
            </div>

            {provider && provider.capabilities.availableModelIds.length > 1 && (
              <div className="mb-3">
                <div className="mb-1 uppercase tracking-widest text-[var(--color-fg-dim)]">
                  model
                </div>
                <select
                  value={modelId}
                  onChange={(e) => setModelId(e.target.value)}
                  className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono text-xs text-[var(--color-fg)] focus:border-[var(--color-accent)] focus:outline-none"
                >
                  {provider.capabilities.availableModelIds.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="mb-3">
              <div className="mb-1 uppercase tracking-widest text-[var(--color-fg-dim)]">
                prompt
              </div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="describe the new texture — e.g. 'red plaid skirt, soft cotton fabric'"
                className="h-28 w-full resize-none rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-dim)] focus:border-[var(--color-accent)] focus:outline-none"
              />
            </div>

            <div className="mb-3">
              <div className="mb-1 uppercase tracking-widest text-[var(--color-fg-dim)]">
                negative prompt
                <span className="ml-1 normal-case tracking-normal text-[var(--color-fg-dim)]">
                  (optional)
                </span>
              </div>
              <textarea
                value={negativePrompt}
                onChange={(e) => setNegativePrompt(e.target.value)}
                placeholder="things to avoid"
                className="h-16 w-full resize-none rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-dim)] focus:border-[var(--color-accent)] focus:outline-none"
              />
            </div>

            <button
              type="button"
              onClick={onSubmit}
              disabled={submitDisabled}
              className="rounded border border-[var(--color-accent)] px-3 py-1.5 text-sm text-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {phase.kind === "running"
                ? "generating…"
                : phase.kind === "submitting"
                  ? "submitting…"
                  : "generate"}
            </button>
            {phase.kind === "succeeded" && (
              <button
                type="button"
                onClick={onReset}
                className="mt-2 rounded border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
              >
                reset
              </button>
            )}

            <div className="mt-auto leading-relaxed text-[var(--color-fg-dim)]">
              <div className="mb-1 uppercase tracking-widest">flow</div>
              <ul className="list-inside list-disc space-y-1">
                <li>
                  <span className="text-[var(--color-fg)]">decompose</span> first refines the mask
                  (optional)
                </li>
                <li>provider runs the inpaint and returns a new texture</li>
                <li>preview here · atlas apply lands in Sprint 3.3</li>
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
