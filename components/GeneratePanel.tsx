"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AvatarAdapter } from "@/lib/adapters/AvatarAdapter";
import { extractLayerCanvas } from "@/lib/avatar/regionExtract";
import type { Layer } from "@/lib/avatar/types";
import { useEditorStore } from "@/lib/store/editor";

type Props = {
  adapter: AvatarAdapter | null;
  layer: Layer;
};

/**
 * AI texture generation modal. Sprint 3.0 ships the UI shell only —
 * region preview, prompt input, mask awareness — without a real
 * provider behind it. Sprint 3.1 lands the API route + Replicate
 * client; the panel's submit path then turns into a real call.
 *
 * The shape is deliberately close to DecomposeStudio: same modal
 * geometry, same Esc-to-dismiss, same single layer focus. Workflow:
 * user opens DecomposeStudio to refine a mask → switches to
 * GeneratePanel for the same layer → AI inpaints inside the mask.
 */
export function GeneratePanel({ adapter, layer }: Props) {
  const close = useEditorStore((s) => s.setGenerateLayer);
  const existingMask = useEditorStore((s) => s.layerMasks[layer.id] ?? null);

  const sourceRef = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [submitNote, setSubmitNote] = useState<string | null>(null);

  // ----- pull the layer region into a preview canvas -----
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
    const canvas = sourceRef.current;
    if (!canvas) return;
    canvas.width = extracted.canvas.width;
    canvas.height = extracted.canvas.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(extracted.canvas, 0, 0);
    setReady(true);
  }, [adapter, layer]);

  // Esc closes
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") close(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  function onSubmit() {
    if (!prompt.trim()) {
      setSubmitNote("prompt required");
      return;
    }
    setSubmitNote("backend not wired yet — Sprint 3.1 hooks the Replicate provider");
  }

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
      <div className="relative z-10 m-auto flex h-[90vh] w-[min(90vw,1100px)] flex-col rounded border border-[var(--color-border)] bg-[var(--color-bg)] shadow-2xl">
        <header className="flex shrink-0 items-center gap-3 border-b border-[var(--color-border)] px-4 py-2 text-xs">
          <span className="font-mono text-[var(--color-accent)]">generate · v0</span>
          <span className="text-[var(--color-fg-dim)]">{layer.name}</span>
          {existingMask && (
            <span
              className="rounded border border-[var(--color-accent)] px-1 font-mono text-[10px] text-[var(--color-accent)]"
              title="DecomposeStudio mask will be used as the inpaint mask"
            >
              mask in use
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

        <div className="grid min-h-0 flex-1 grid-cols-[1fr_320px] overflow-hidden">
          <div className="flex min-h-0 min-w-0 items-center justify-center p-6" style={previewBg}>
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

          <aside className="flex min-h-0 flex-col border-l border-[var(--color-border)] p-4 text-xs">
            <div className="mb-3">
              <div className="mb-1 uppercase tracking-widest text-[var(--color-fg-dim)]">
                prompt
              </div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="describe the new texture — e.g. 'red plaid skirt, soft cotton'"
                className="h-32 w-full resize-none rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-dim)] focus:border-[var(--color-accent)] focus:outline-none"
              />
            </div>

            <div className="mb-3">
              <div className="mb-1 uppercase tracking-widest text-[var(--color-fg-dim)]">
                negative prompt
                <span className="ml-1 text-[var(--color-fg-dim)] normal-case tracking-normal">
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
              disabled={!ready}
              className="rounded border border-[var(--color-accent)] px-3 py-1.5 text-sm text-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              generate
            </button>
            {submitNote && (
              <div className="mt-2 rounded border border-[var(--color-border)] bg-[var(--color-panel)] p-2 text-xs text-[var(--color-fg-dim)]">
                {submitNote}
              </div>
            )}

            <div className="mt-auto leading-relaxed text-[var(--color-fg-dim)]">
              <div className="mb-1 uppercase tracking-widest">flow</div>
              <ul className="list-inside list-disc space-y-1">
                <li>
                  <span className="text-[var(--color-fg)]">decompose</span> refines the mask first
                  (optional)
                </li>
                <li>
                  <span className="text-[var(--color-fg)]">generate</span> inpaints inside the mask
                  using your prompt
                </li>
                <li>result is composited back onto the atlas page</li>
                <li>esc dismisses without submitting</li>
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
