"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AvatarAdapter } from "@/lib/adapters/AvatarAdapter";
import {
  canvasToPngBlob,
  fetchProviders,
  type ProviderAvailability,
  padToOpenAISquare,
  postprocessGeneratedBlob,
  submitGenerate,
} from "@/lib/ai/client";
import type { ProviderId } from "@/lib/ai/types";
import { extractCurrentLayerCanvas } from "@/lib/avatar/regionExtract";
import type { Layer } from "@/lib/avatar/types";
import { useReferences } from "@/lib/avatar/useReferences";
import { type AIJobRow, listAIJobsForLayer, saveAIJob } from "@/lib/persistence/db";
import { useEditorStore } from "@/lib/store/editor";

type Props = {
  adapter: AvatarAdapter | null;
  layer: Layer;
  /** Stable puppet key for IDB job history. `null` disables persistence. */
  puppetKey: string | null;
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
export function GeneratePanel({ adapter, layer, puppetKey }: Props) {
  const close = useEditorStore((s) => s.setGenerateLayer);
  const existingMask = useEditorStore((s) => s.layerMasks[layer.id] ?? null);
  const existingTexture = useEditorStore((s) => s.layerTextureOverrides[layer.id] ?? null);
  const setLayerTextureOverride = useEditorStore((s) => s.setLayerTextureOverride);

  const sourceRef = useRef<HTMLCanvasElement | null>(null);
  /** Source we send to the AI: post-gen, *pre-mask*. Keeping the
   *  pixels populated under the layer's mask region matters — gpt-
   *  image-2 falls back to free generation when its input is mostly
   *  transparent, so an aggressively pre-masked source produces
   *  prompt-only outputs ("skin" → a hand) instead of edits. The mask
   *  blob is sent separately and tells the model what to preserve. */
  const aiSourceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  /** Source we display in the panel: post-gen, *post-mask*. Matches
   *  what the live atlas renders. */
  const previewSourceRef = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [providers, setProviders] = useState<ProviderAvailability[] | null>(null);
  const [providerId, setProviderId] = useState<ProviderId>("gemini");
  const [modelId, setModelId] = useState<string>("");
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");

  /** Tracks the OpenAI 1024² padding offset across submit→success so
   *  the apply step can crop padding back out. Reset on every submit. */
  const openAIOffsetRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  /** Persisted history for this layer. Newest first. Repopulated on
   *  every successful save so the list reflects what's in IDB. */
  const [history, setHistory] = useState<AIJobRow[]>([]);

  const [phase, setPhase] = useState<
    | { kind: "idle" }
    | { kind: "submitting" }
    | { kind: "running" }
    | { kind: "succeeded"; url: string; blob: Blob }
    | { kind: "applying" }
    | { kind: "failed"; reason: string }
  >({ kind: "idle" });

  // ----- mount: extract two source canvases -----
  // The display canvas mirrors the live atlas (post-gen + post-mask)
  // so the user sees what's currently rendered. The AI canvas keeps
  // the mask region populated so gpt-image-2 has dense content to
  // edit; the mask still ships separately and tells the model what
  // to preserve.
  useEffect(() => {
    setReady(false);
    setError(null);
    if (!adapter || !layer.texture) {
      setError("layer has no texture region");
      return;
    }

    let cancelled = false;
    void (async () => {
      const aiExtracted = await extractCurrentLayerCanvas(adapter, layer, {
        texture: existingTexture,
        // mask deliberately omitted — see comment on aiSourceCanvasRef
      });
      if (cancelled) return;
      if (!aiExtracted) {
        setError("region rect is empty / unrenderable");
        return;
      }
      aiSourceCanvasRef.current = aiExtracted.canvas;

      const previewExtracted = await extractCurrentLayerCanvas(adapter, layer, {
        texture: existingTexture,
        mask: existingMask,
      });
      if (cancelled) return;
      previewSourceRef.current = previewExtracted?.canvas ?? aiExtracted.canvas;

      setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [adapter, layer, existingTexture, existingMask]);

  // ----- after-mount: paint preview onto the display canvas -----
  // Split from the extract effect because the display `<canvas>` is only
  // rendered when `ready === true`, so its ref isn't attached during the
  // same effect tick that flips ready. This effect runs after the next
  // render, when the canvas is actually in the DOM.
  useEffect(() => {
    if (!ready) return;
    const display = sourceRef.current;
    const preview = previewSourceRef.current;
    if (!display || !preview) return;
    display.width = preview.width;
    display.height = preview.height;
    display.getContext("2d")?.drawImage(preview, 0, 0);
  }, [ready]);

  // ----- mount: load AI job history for this layer -----
  useEffect(() => {
    if (!puppetKey) {
      setHistory([]);
      return;
    }
    let cancelled = false;
    listAIJobsForLayer(puppetKey, layer.externalId)
      .then((rows) => {
        if (!cancelled) setHistory(rows);
      })
      .catch((e) => {
        console.warn("[GeneratePanel] history load failed", e);
      });
    return () => {
      cancelled = true;
    };
  }, [puppetKey, layer.externalId]);

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

  // Per-puppet character / style refs. Forwarded as `image[]` to
  // providers whose capabilities advertise multi-image input
  // (gpt-image-2). Other providers see them dropped at the route.
  const { references } = useReferences(puppetKey);
  const supportsRefs = provider?.capabilities.supportsReferenceImages === true;
  const activeRefBlobs = supportsRefs ? references.map((r) => r.blob) : [];

  async function onSubmit() {
    setPhase({ kind: "submitting" });
    openAIOffsetRef.current = null;
    try {
      const sourceCanvas = aiSourceCanvasRef.current;
      if (!sourceCanvas) throw new Error("source not ready");
      if (!provider) throw new Error("provider unavailable");

      let sourceBlob: Blob;
      let maskBlob: Blob | undefined;

      if (providerId === "openai") {
        // OpenAI gets the source only — never the mask.
        //
        // The DecomposeStudio mask is a *live-render* destination-out
        // wipe ("erase this region from the final atlas"); it is NOT
        // an instruction to gpt-image-2. Past iterations sent it as
        // an edit hint and broke the user's actual workflow:
        //   - User paints a region to erase later, runs gen with a
        //     prompt about a different region of the layer.
        //   - Sending the mask told the model "edit only this bbox"
        //     or "preserve the painted region" — both interpretations
        //     produced wrong outputs (small grid patterns, color
        //     biases toward dark, partially-respected mask, etc).
        //
        // What works (the original, mask-less behavior the user
        // confirmed): send the dense, white-padded source + the
        // prompt. gpt-image-2 reads the layer visually, applies the
        // prompt, returns an edited 1024². Postprocess crops back to
        // the layer rect, alpha-enforces against the layer's
        // silhouette so model over-paint doesn't leak past the
        // footprint. The live compositor then applies the user's
        // mask as destination-out at render time. The two effects
        // (gen and erase) compose cleanly — exactly what the user
        // asked for ("edit으로 지우고 gen으로 바꾸는" workflow).
        const { canvas: padded, offset } = padToOpenAISquare(sourceCanvas);
        openAIOffsetRef.current = offset;
        sourceBlob = await canvasToPngBlob(padded);
        // maskBlob deliberately stays undefined.
        console.info(
          `[GeneratePanel] openai submit: sourceDim=${padded.width}x${padded.height}, offset=${JSON.stringify(offset)}, hasUserMask=${!!existingMask}, maskSentToAI=false`,
        );
      } else {
        // Gemini: arbitrary input dims. Pass source + raw mask through.
        // Footprint is enforced post-hoc via alpha multiplication in
        // postprocessGeneratedBlob.
        sourceBlob = await canvasToPngBlob(sourceCanvas);
        maskBlob = existingMask ?? undefined;
      }

      setPhase({ kind: "running" });
      console.info(
        `[GeneratePanel] submit: provider=${providerId} model=${modelId || "(default)"} refs=${activeRefBlobs.length}`,
      );
      const result = await submitGenerate({
        providerId,
        prompt,
        negativePrompt: negativePrompt.trim() || undefined,
        modelId: modelId || undefined,
        sourceImage: sourceBlob,
        maskImage: maskBlob,
        referenceImages: activeRefBlobs.length > 0 ? activeRefBlobs : undefined,
      });
      const url = URL.createObjectURL(result);
      setPhase({ kind: "succeeded", url, blob: result });
    } catch (e) {
      setPhase({ kind: "failed", reason: e instanceof Error ? e.message : String(e) });
    }
  }

  async function onApply() {
    if (phase.kind !== "succeeded") return;
    // Use the AI source (pre-mask) for alpha enforcement so the
    // postprocess output retains the layer's full footprint silhouette;
    // the live compositor's mask destination-out then erases the user's
    // marked area at render time.
    const sourceCanvas = aiSourceCanvasRef.current;
    if (!sourceCanvas) return;
    setPhase({ kind: "applying" });
    try {
      const processed = await postprocessGeneratedBlob({
        blob: phase.blob,
        sourceCanvas,
        openAIPadding: openAIOffsetRef.current ? { offset: openAIOffsetRef.current } : undefined,
      });
      // Save to store. The LayersPanel effect picks it up and the
      // adapter composites onto the atlas page within one frame.
      setLayerTextureOverride(layer.id, processed);

      // Persist the apply'd job to IDB for this layer's history.
      // `puppetKey === null` happens for /poc/upload before autoSave
      // settles — we just skip persistence in that case.
      if (puppetKey) {
        try {
          await saveAIJob({
            puppetKey,
            layerExternalId: layer.externalId,
            providerId,
            modelId: modelId || undefined,
            prompt,
            negativePrompt: negativePrompt.trim() || undefined,
            resultBlob: processed,
          });
          // Refresh history so the user sees the new entry next time
          // the panel opens for this layer.
          listAIJobsForLayer(puppetKey, layer.externalId)
            .then(setHistory)
            .catch(() => {});
        } catch (e) {
          console.warn("[GeneratePanel] saveAIJob failed", e);
        }
      }

      // Free the preview URL — store now owns the blob.
      URL.revokeObjectURL(phase.url);
      close(null);
    } catch (e) {
      setPhase({ kind: "failed", reason: e instanceof Error ? e.message : String(e) });
    }
  }

  /** Re-run the last submission with the same prompt + provider. */
  function onRetry() {
    void onSubmit();
  }

  /** Reload an old job into the result preview. User can then "apply"
   *  it as if it were freshly generated. The blob came from IDB so it's
   *  already postprocessed (alpha-enforced + cropped); we wrap it in a
   *  fresh URL and pretend the submit pipeline produced it. */
  function onRevisit(row: AIJobRow) {
    if (phase.kind === "succeeded") URL.revokeObjectURL(phase.url);
    // Mark the offset as "no padding" — the saved blob is already at
    // the layer's upright dim, no further crop needed in postprocess.
    openAIOffsetRef.current = null;
    const url = URL.createObjectURL(row.resultBlob);
    setPrompt(row.prompt);
    setNegativePrompt(row.negativePrompt ?? "");
    setProviderId(row.providerId);
    if (row.modelId) setModelId(row.modelId);
    setPhase({ kind: "succeeded", url, blob: row.resultBlob });
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
    phase.kind === "applying" ||
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
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={onRetry}
                    className="rounded border border-[var(--color-accent)] px-2 py-0.5 text-[var(--color-accent)]"
                    title="re-run with the same prompt and provider"
                  >
                    retry
                  </button>
                  <button
                    type="button"
                    onClick={onReset}
                    className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
                  >
                    dismiss
                  </button>
                </div>
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

            {provider && provider.capabilities.models.length > 1 && (
              <div className="mb-3">
                <div className="mb-1 uppercase tracking-widest text-[var(--color-fg-dim)]">
                  model
                </div>
                <select
                  value={modelId}
                  onChange={(e) => setModelId(e.target.value)}
                  className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs text-[var(--color-fg)] focus:border-[var(--color-accent)] focus:outline-none"
                >
                  {provider.capabilities.models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName} · {m.id}
                    </option>
                  ))}
                </select>
                {(() => {
                  const m = provider.capabilities.models.find((x) => x.id === modelId);
                  return m?.description ? (
                    <p className="mt-1 leading-relaxed text-[var(--color-fg-dim)]">
                      {m.description}
                    </p>
                  ) : null;
                })()}
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

            {/* Reference image summary — surfaces what's about to ride
                along with the source so the user can correlate result
                quality with the refs they uploaded. Only meaningful for
                providers that support multi-image input; for others we
                show a one-liner explaining why their refs aren't being
                forwarded. */}
            {provider && references.length > 0 && (
              <div className="mb-3 rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2 text-[11px]">
                {supportsRefs ? (
                  <>
                    <div className="mb-1 text-[var(--color-fg)]">
                      {references.length} reference image{references.length === 1 ? "" : "s"} will
                      ride along
                    </div>
                    <div className="text-[var(--color-fg-dim)]">
                      Sent as <span className="font-mono">image[]</span> after the layer source —
                      gpt-image-2 uses them as character / style anchors. Manage in the References
                      panel.
                    </div>
                  </>
                ) : (
                  <div className="text-[var(--color-fg-dim)]">
                    {references.length} reference image{references.length === 1 ? "" : "s"} stored,
                    but {provider.displayName} doesn't accept multi-image input — they'll be ignored
                    for this generation.
                  </div>
                )}
              </div>
            )}

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
              <div className="mt-2 flex flex-col gap-1">
                <button
                  type="button"
                  onClick={onApply}
                  className="rounded border border-[var(--color-accent)] bg-[var(--color-accent)]/10 px-3 py-1.5 text-sm text-[var(--color-accent)]"
                  title="composite the result onto the atlas page"
                >
                  apply to atlas
                </button>
                <button
                  type="button"
                  onClick={onReset}
                  className="rounded border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
                >
                  reset · keep generating
                </button>
              </div>
            )}
            {phase.kind === "applying" && (
              <div className="mt-2 text-xs text-[var(--color-fg-dim)]">applying…</div>
            )}

            {history.length > 0 && (
              <div className="mt-4 flex min-h-0 shrink-0 flex-col">
                <div className="mb-1 flex items-baseline justify-between uppercase tracking-widest text-[var(--color-fg-dim)]">
                  <span>history · {history.length}</span>
                  <span className="normal-case tracking-normal text-[10px]">click to revisit</span>
                </div>
                <ul className="flex flex-col gap-1 overflow-y-auto pr-1">
                  {history.map((row) => (
                    <HistoryRow key={row.id} row={row} onRevisit={onRevisit} />
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-auto leading-relaxed text-[var(--color-fg-dim)]">
              <div className="mb-1 uppercase tracking-widest">flow</div>
              <ul className="list-inside list-disc space-y-1">
                <li>
                  <span className="text-[var(--color-fg)]">decompose</span> refines the mask first
                  (optional)
                </li>
                <li>provider inpaints and returns a new texture</li>
                <li>
                  <span className="text-[var(--color-fg)]">apply</span> composites it onto the atlas
                  page · live render reflects it next frame
                </li>
                <li>esc dismisses · result stays in the layer's overrides until reset</li>
                {!puppetKey && (
                  <li className="text-yellow-400">
                    history is disabled until this puppet is saved to the library
                  </li>
                )}
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

/**
 * Compact history entry. Owns its blob URL lifecycle so the parent
 * doesn't have to track a list of URLs alongside the row list.
 */
function HistoryRow({ row, onRevisit }: { row: AIJobRow; onRevisit: (row: AIJobRow) => void }) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  useEffect(() => {
    const url = URL.createObjectURL(row.resultBlob);
    setThumbUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [row.resultBlob]);

  return (
    <li>
      <button
        type="button"
        onClick={() => onRevisit(row)}
        className="flex w-full items-center gap-2 rounded border border-[var(--color-border)] p-1 text-left text-xs hover:border-[var(--color-accent)]"
      >
        {thumbUrl ? (
          // biome-ignore lint/performance/noImgElement: blob URL output
          <img
            src={thumbUrl}
            alt=""
            className="h-9 w-9 shrink-0 rounded border border-[var(--color-border)] bg-[var(--color-bg)] object-contain"
          />
        ) : (
          <span className="h-9 w-9 shrink-0 rounded border border-dashed border-[var(--color-border)]" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[10px] text-[var(--color-fg-dim)]">
            {row.providerId}
            {row.modelId ? ` · ${row.modelId.split("/").pop()}` : ""}
          </div>
          <div className="truncate text-[var(--color-fg)]">{row.prompt}</div>
          <div className="font-mono text-[10px] text-[var(--color-fg-dim)]">
            {formatRelative(row.createdAt)}
          </div>
        </div>
      </button>
    </li>
  );
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}
