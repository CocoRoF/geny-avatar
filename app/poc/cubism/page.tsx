"use client";

import { Application } from "pixi.js";
import { useEffect, useMemo, useRef, useState } from "react";

const MODEL_URL = "/samples/hiyori/Hiyori.model3.json";

type ModelInfo = {
  parameterCount: number;
  partCount: number;
  drawableCount: number;
  textureCount: number;
  motionGroups: { group: string; count: number }[];
};

type PartInfo = { index: number; id: string; visible: boolean; opacity: number };

export default function CubismPoCPage() {
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  // biome-ignore lint/suspicious/noExplicitAny: engine types live behind dynamic import
  const modelRef = useRef<any>(null);
  const [info, setInfo] = useState<ModelInfo | null>(null);
  const [parts, setParts] = useState<PartInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("loading…");
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    const host = canvasHostRef.current;
    if (!host) return;

    const app = new Application();

    (async () => {
      try {
        for (let i = 0; i < 50; i++) {
          // biome-ignore lint/suspicious/noExplicitAny: window global injected by Cubism Core script
          if (typeof (globalThis as any).Live2DCubismCore !== "undefined") break;
          await new Promise((r) => setTimeout(r, 100));
        }
        // biome-ignore lint/suspicious/noExplicitAny: window global injected by Cubism Core script
        if (typeof (globalThis as any).Live2DCubismCore === "undefined") {
          throw new Error(
            "Live2DCubismCore not available — /runtime/live2dcubismcore.min.js failed to load",
          );
        }

        const { configureCubismSDK, Live2DModel } = await import("untitled-pixi-live2d-engine");

        await app.init({
          background: "#0b0d10",
          resizeTo: host,
          antialias: true,
          autoDensity: true,
          resolution: window.devicePixelRatio || 1,
        });
        if (cancelled) {
          app.destroy(true);
          return;
        }
        host.appendChild(app.canvas);
        appRef.current = app;
        setStatus("loading model…");

        configureCubismSDK({ memorySizeMB: 32 });
        const model = await Live2DModel.from(MODEL_URL);
        if (cancelled) return;

        model.anchor.set(0.5, 0.5);
        model.position.set(app.screen.width / 2, app.screen.height / 2);

        const scaleByH = (app.screen.height * 0.9) / 1500;
        model.scale.set(scaleByH);

        app.stage.addChild(model);
        modelRef.current = model;

        // biome-ignore lint/suspicious/noExplicitAny: engine internals
        const internal = (model as any).internalModel;
        // biome-ignore lint/suspicious/noExplicitAny: engine internals
        const coreModel = internal?.coreModel as any;

        if (coreModel) {
          const partCount = coreModel.getPartCount?.() ?? 0;
          const drawableCount = coreModel.getDrawableCount?.() ?? 0;
          const parameterCount = coreModel.getParameterCount?.() ?? 0;
          const textureCount = internal?.settings?.textures?.length ?? 0;
          const motionGroups: { group: string; count: number }[] = [];
          // biome-ignore lint/suspicious/noExplicitAny: settings shape varies
          const motions = internal?.settings?.motions as any;
          if (motions) {
            for (const g of Object.keys(motions)) {
              motionGroups.push({ group: g, count: motions[g].length });
            }
          }
          setInfo({ parameterCount, partCount, drawableCount, textureCount, motionGroups });

          const partList: PartInfo[] = [];
          for (let i = 0; i < partCount; i++) {
            const id = coreModel.getPartId?.(i) ?? `part_${i}`;
            const opacity = coreModel.getPartOpacity?.(i) ?? 1;
            partList.push({ index: i, id, opacity, visible: opacity > 0.01 });
          }
          setParts(partList);
        }

        try {
          // biome-ignore lint/suspicious/noExplicitAny: engine method
          (model as any).motion?.("Idle");
        } catch {
          // engine has no motion shortcut — surface in API exploration if relevant
        }

        setStatus("loaded");
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(e);
          setError(msg);
          setStatus("failed");
        }
      }
    })();

    return () => {
      cancelled = true;
      if (appRef.current) {
        appRef.current.destroy(true, { children: true, texture: false });
        appRef.current = null;
      }
      modelRef.current = null;
    };
  }, []);

  const filteredParts = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return parts;
    return parts.filter((p) => p.id.toLowerCase().includes(f));
  }, [parts, filter]);

  function setPartVisibility(index: number, visible: boolean) {
    const model = modelRef.current;
    if (!model) return;
    // biome-ignore lint/suspicious/noExplicitAny: engine internals
    const coreModel = (model as any).internalModel?.coreModel;
    if (!coreModel?.setPartOpacity) return;
    coreModel.setPartOpacity(index, visible ? 1 : 0);
    setParts((prev) =>
      prev.map((p) => (p.index === index ? { ...p, visible, opacity: visible ? 1 : 0 } : p)),
    );
  }

  function togglePart(index: number) {
    const current = parts.find((p) => p.index === index);
    if (!current) return;
    setPartVisibility(index, !current.visible);
  }

  function bulkSet(visible: boolean) {
    for (const p of filteredParts) setPartVisibility(p.index, visible);
  }

  function playMotion(group: string) {
    const model = modelRef.current;
    if (!model) return;
    try {
      // biome-ignore lint/suspicious/noExplicitAny: engine method
      (model as any).motion?.(group);
    } catch (e) {
      console.warn("motion failed", e);
    }
  }

  return (
    <main className="grid h-full grid-cols-[1fr_320px] overflow-hidden bg-[var(--color-bg)]">
      <section className="flex min-h-0 min-w-0 flex-col">
        <header className="shrink-0 border-b border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-fg-dim)]">
          <span className="font-mono text-[var(--color-accent)]">PoC · Cubism</span>
          <span className="ml-3">Hiyori · {status}</span>
          {error && <span className="ml-3 text-red-400">error: {error}</span>}
        </header>
        <div ref={canvasHostRef} className="min-h-0 flex-1" />
      </section>

      <aside className="flex min-h-0 flex-col border-l border-[var(--color-border)]">
        {info && (
          <div className="shrink-0 border-b border-[var(--color-border)] px-4 py-3 text-xs text-[var(--color-fg-dim)]">
            <div>
              params <span className="text-[var(--color-fg)]">{info.parameterCount}</span> · parts{" "}
              <span className="text-[var(--color-fg)]">{info.partCount}</span> · drawables{" "}
              <span className="text-[var(--color-fg)]">{info.drawableCount}</span>
            </div>
            <div>
              textures <span className="text-[var(--color-fg)]">{info.textureCount}</span>
            </div>
          </div>
        )}

        {info && info.motionGroups.length > 0 && (
          <div className="shrink-0 border-b border-[var(--color-border)] px-4 py-3">
            <div className="mb-2 text-xs uppercase tracking-widest text-[var(--color-fg-dim)]">
              Motions
            </div>
            <div className="flex flex-wrap gap-1">
              {info.motionGroups.map((m) => (
                <button
                  key={m.group}
                  type="button"
                  onClick={() => playMotion(m.group)}
                  className="rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-fg-dim)] hover:border-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
                >
                  {m.group} ({m.count})
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="shrink-0 border-b border-[var(--color-border)] px-4 py-3">
          <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-widest text-[var(--color-fg-dim)]">
            <span>
              Parts ({filteredParts.length}/{parts.length})
            </span>
          </div>
          <input
            type="text"
            placeholder="search part…"
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
          {filteredParts.map((p) => (
            <li key={p.index}>
              <button
                type="button"
                onClick={() => togglePart(p.index)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-[var(--color-panel)]"
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    p.visible ? "bg-[var(--color-accent)]" : "bg-[var(--color-border)]"
                  }`}
                />
                <span className="font-mono text-xs text-[var(--color-fg-dim)]">
                  {String(p.index).padStart(2, "0")}
                </span>
                <span className="truncate">{p.id}</span>
              </button>
            </li>
          ))}
          {filteredParts.length === 0 && (
            <li className="px-2 py-4 text-center text-xs text-[var(--color-fg-dim)]">no match</li>
          )}
        </ul>
      </aside>
    </main>
  );
}
