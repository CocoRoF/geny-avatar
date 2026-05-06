"use client";

import { useEffect, useMemo, useState } from "react";
import { UploadDropzone } from "@/components/UploadDropzone";
import type { AdapterLoadInput } from "@/lib/adapters/AvatarAdapter";
import type { Live2DAdapter } from "@/lib/adapters/Live2DAdapter";
import type { LayerId } from "@/lib/avatar/types";
import { usePuppet } from "@/lib/avatar/usePuppet";
import { disposeBundle, parseBundle } from "@/lib/upload/parseBundle";
import type { ParsedBundle } from "@/lib/upload/types";

type LayerVisible = { id: LayerId; visible: boolean };

function fitDisplayObject(
  // biome-ignore lint/suspicious/noExplicitAny: pixi/engine display surfaces vary
  display: any,
  runtime: "spine" | "live2d",
  // biome-ignore lint/suspicious/noExplicitAny: per-runtime adapter
  adapter: any,
  screen: { width: number; height: number },
) {
  if (display.scale?.set) display.scale.set(1);

  if (runtime === "live2d") {
    const native = (adapter as Live2DAdapter).getNativeSize?.();
    const baseW = native?.width ?? display.width ?? 800;
    const baseH = native?.height ?? display.height ?? 1200;
    const factor = Math.min((screen.width * 0.9) / baseW, (screen.height * 0.9) / baseH);
    display.scale?.set?.(factor);
    if (display.anchor?.set) display.anchor.set(0.5, 0.5);
    else if (display.pivot?.set) display.pivot.set(baseW / 2, baseH / 2);
    display.position?.set?.(screen.width / 2, screen.height / 2);
  } else {
    // Spine — heuristic placement; user can tweak when we have a Tools panel
    display.scale.set(0.5);
    display.x = screen.width / 2;
    display.y = screen.height * 0.85;
  }
}

export default function UploadPocPage() {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [bundle, setBundle] = useState<ParsedBundle | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [layerVisible, setLayerVisible] = useState<LayerVisible[]>([]);
  const [filter, setFilter] = useState("");

  const input: AdapterLoadInput | null = bundle?.ok ? bundle.loadInput : null;

  const { status, error, avatar, adapter } = usePuppet({
    input,
    host,
    onMount: (avatar, adapter, app) => {
      const display = adapter.getDisplayObject();
      if (display) fitDisplayObject(display, adapter.runtime, adapter, app.screen);
      setLayerVisible(avatar.layers.map((l) => ({ id: l.id, visible: l.defaults.visible })));
      const candidates = ["Idle", "portal"];
      const initial =
        avatar.animations.find((a) => candidates.includes(a.name)) ?? avatar.animations[0];
      if (initial) adapter.playAnimation(initial.name);
    },
  });

  // dispose blob URLs when bundle is replaced or page unmounts
  useEffect(() => {
    return () => {
      if (bundle) disposeBundle(bundle);
    };
  }, [bundle]);

  async function handleFiles(files: File[]) {
    if (bundle) disposeBundle(bundle);
    setParseError(null);
    setLayerVisible([]);
    try {
      const input: File | File[] =
        files.length === 1 && files[0].name.toLowerCase().endsWith(".zip") ? files[0] : files;
      const parsed = await parseBundle(input);
      if (parsed.ok) {
        setBundle(parsed);
      } else {
        setBundle(null);
        setParseError(parsed.reason);
      }
    } catch (e) {
      setBundle(null);
      setParseError(e instanceof Error ? e.message : String(e));
    }
  }

  function clear() {
    if (bundle) disposeBundle(bundle);
    setBundle(null);
    setParseError(null);
    setLayerVisible([]);
  }

  const layers = avatar?.layers ?? [];
  const animations = avatar?.animations ?? [];

  const filteredLayers = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return layers;
    return layers.filter((l) => l.name.toLowerCase().includes(f));
  }, [layers, filter]);

  const visibleSet = useMemo(() => {
    const m = new Map<LayerId, boolean>();
    for (const v of layerVisible) m.set(v.id, v.visible);
    return m;
  }, [layerVisible]);

  function setVisibility(id: LayerId, visible: boolean) {
    adapter?.setLayerVisibility(id, visible);
    setLayerVisible((prev) => prev.map((v) => (v.id === id ? { ...v, visible } : v)));
  }
  function toggleLayer(id: LayerId) {
    const current = visibleSet.get(id) ?? true;
    setVisibility(id, !current);
  }
  function bulkSet(visible: boolean) {
    for (const l of filteredLayers) setVisibility(l.id, visible);
  }
  function playAnim(name: string) {
    adapter?.playAnimation(name);
  }

  const headerStatus =
    parseError != null
      ? `parse failed: ${parseError}`
      : !bundle
        ? "drop a bundle to begin"
        : status === "loading"
          ? "loading…"
          : status === "ready" && avatar && bundle.ok
            ? `${avatar.name} · ${bundle.detection.runtime} · ${layers.length} layers · ${animations.length} animations`
            : status === "error"
              ? `load failed: ${error}`
              : "loaded";

  const warnings = bundle?.ok ? bundle.warnings : [];

  return (
    <main className="grid h-full grid-cols-[1fr_320px] overflow-hidden bg-[var(--color-bg)]">
      <section className="flex min-h-0 min-w-0 flex-col">
        <header className="shrink-0 border-b border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-fg-dim)]">
          <span className="font-mono text-[var(--color-accent)]">PoC · Upload</span>
          <span className="ml-3">{headerStatus}</span>
          {bundle && (
            <button
              type="button"
              onClick={clear}
              className="ml-3 rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
            >
              clear
            </button>
          )}
        </header>

        {!bundle && (
          <div className="flex min-h-0 flex-1 items-center justify-center p-8">
            <UploadDropzone onFiles={handleFiles} className="h-72 w-full max-w-2xl" />
          </div>
        )}

        {bundle && (
          <>
            <div ref={setHost} className="min-h-0 flex-1" />
            {warnings.length > 0 && (
              <div className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-panel)] px-4 py-2 text-xs text-yellow-300">
                <span className="font-medium">warnings ({warnings.length})</span>:{" "}
                {warnings.slice(0, 3).join(" · ")}
                {warnings.length > 3 && ` · …`}
              </div>
            )}
          </>
        )}
      </section>

      <aside className="flex min-h-0 flex-col border-l border-[var(--color-border)]">
        {animations.length > 0 && (
          <div className="shrink-0 border-b border-[var(--color-border)] px-4 py-3">
            <div className="mb-2 text-xs uppercase tracking-widest text-[var(--color-fg-dim)]">
              Animations
            </div>
            <div className="flex flex-wrap gap-1">
              {animations.map((a) => (
                <button
                  key={a.name}
                  type="button"
                  onClick={() => playAnim(a.name)}
                  className="rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-fg-dim)] hover:border-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
                >
                  {a.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="shrink-0 border-b border-[var(--color-border)] px-4 py-3">
          <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-widest text-[var(--color-fg-dim)]">
            <span>
              Layers ({filteredLayers.length}/{layers.length})
            </span>
          </div>
          <input
            type="text"
            placeholder="search layer…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-dim)] focus:border-[var(--color-accent)] focus:outline-none"
          />
          <div className="mt-2 flex gap-1 text-xs">
            <button
              type="button"
              onClick={() => bulkSet(true)}
              className="rounded border border-[var(--color-border)] px-2 py-1 text-[var(--color-fg-dim)] hover:border-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
            >
              show all
            </button>
            <button
              type="button"
              onClick={() => bulkSet(false)}
              className="rounded border border-[var(--color-border)] px-2 py-1 text-[var(--color-fg-dim)] hover:border-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
            >
              hide all
            </button>
          </div>
        </div>

        <ul className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {filteredLayers.map((l, i) => {
            const visible = visibleSet.get(l.id) ?? true;
            return (
              <li key={l.id}>
                <button
                  type="button"
                  onClick={() => toggleLayer(l.id)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-[var(--color-panel)]"
                >
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      visible ? "bg-[var(--color-accent)]" : "bg-[var(--color-border)]"
                    }`}
                  />
                  <span className="font-mono text-xs text-[var(--color-fg-dim)]">
                    {String(i).padStart(2, "0")}
                  </span>
                  <span className="truncate">{l.name}</span>
                </button>
              </li>
            );
          })}
          {filteredLayers.length === 0 && layers.length > 0 && (
            <li className="px-2 py-4 text-center text-xs text-[var(--color-fg-dim)]">no match</li>
          )}
          {layers.length === 0 && bundle?.ok && status === "ready" && (
            <li className="px-2 py-4 text-center text-xs text-[var(--color-fg-dim)]">
              no layers in this bundle
            </li>
          )}
        </ul>
      </aside>
    </main>
  );
}
