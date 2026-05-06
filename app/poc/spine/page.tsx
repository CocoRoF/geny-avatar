"use client";

import { useMemo, useState } from "react";
import type { AdapterLoadInput } from "@/lib/adapters/AvatarAdapter";
import type { LayerId } from "@/lib/avatar/types";
import { usePuppet } from "@/lib/avatar/usePuppet";

const INPUT: AdapterLoadInput = {
  kind: "spine",
  skeleton: "/samples/spineboy/spineboy-pro.skel",
  atlas: "/samples/spineboy/spineboy-pma.atlas",
  aliasPrefix: "poc-spine",
};

type LayerVisible = { id: LayerId; visible: boolean };

export default function SpinePoCPage() {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [activeAnim, setActiveAnim] = useState<string>("");
  const [layerVisible, setLayerVisible] = useState<LayerVisible[]>([]);
  const [filter, setFilter] = useState("");

  const { status, error, avatar, adapter, app } = usePuppet({
    input: INPUT,
    host,
    onMount: (avatar, adapter, app) => {
      const display = adapter.getDisplayObject();
      if (display) {
        display.x = app.screen.width / 2;
        display.y = app.screen.height * 0.85;
        display.scale.set(0.5);
      }
      setLayerVisible(avatar.layers.map((l) => ({ id: l.id, visible: l.defaults.visible })));
      const initial = avatar.animations.find((a) => a.name === "portal") ?? avatar.animations[0];
      if (initial) {
        adapter.playAnimation(initial.name);
        setActiveAnim(initial.name);
      }
    },
  });

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
    setActiveAnim(name);
  }

  const headerText =
    status === "ready" && app && avatar
      ? `${avatar.name} · loaded · ${layers.length} slots · ${animations.length} animations`
      : status === "loading"
        ? "loading…"
        : status === "error"
          ? "failed"
          : "idle";

  return (
    <main className="grid h-full grid-cols-[1fr_320px] overflow-hidden bg-[var(--color-bg)]">
      <section className="flex min-h-0 min-w-0 flex-col">
        <header className="shrink-0 border-b border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-fg-dim)]">
          <span className="font-mono text-[var(--color-accent)]">PoC · Spine</span>
          <span className="ml-3">{headerText}</span>
          {error && <span className="ml-3 text-red-400">error: {error}</span>}
        </header>
        <div ref={setHost} className="min-h-0 flex-1" />
      </section>

      <aside className="flex min-h-0 flex-col border-l border-[var(--color-border)]">
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
                className={`rounded border px-2 py-1 text-xs transition-colors ${
                  a.name === activeAnim
                    ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                    : "border-[var(--color-border)] text-[var(--color-fg-dim)] hover:border-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
                }`}
              >
                {a.name}
              </button>
            ))}
          </div>
        </div>

        <div className="shrink-0 border-b border-[var(--color-border)] px-4 py-3">
          <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-widest text-[var(--color-fg-dim)]">
            <span>
              Slots ({filteredLayers.length}/{layers.length})
            </span>
          </div>
          <input
            type="text"
            placeholder="search slot…"
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
        </ul>
      </aside>
    </main>
  );
}
