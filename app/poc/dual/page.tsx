"use client";

import { Spine } from "@esotericsoftware/spine-pixi-v8";
import { Application, Assets, Container } from "pixi.js";
import { useEffect, useRef, useState } from "react";

const SPINE_SKEL = "/samples/spineboy/spineboy-pro.skel";
const SPINE_ATLAS = "/samples/spineboy/spineboy-pma.atlas";
const CUBISM_MODEL = "/samples/hiyori/Hiyori.model3.json";

type Status = {
  pixi: "pending" | "ok" | "error";
  spine: "pending" | "ok" | "error";
  cubism: "pending" | "ok" | "error";
  detail?: string;
};

export default function DualMountPocPage() {
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const [status, setStatus] = useState<Status>({
    pixi: "pending",
    spine: "pending",
    cubism: "pending",
  });

  useEffect(() => {
    let cancelled = false;
    const host = canvasHostRef.current;
    if (!host) return;

    const app = new Application();

    (async () => {
      try {
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
        setStatus((s) => ({ ...s, pixi: "ok" }));

        // Two side-by-side root containers, one per runtime.
        const leftHost = new Container();
        const rightHost = new Container();
        app.stage.addChild(leftHost);
        app.stage.addChild(rightHost);

        // ----- Spine half -----
        try {
          Assets.add({ alias: "dual-spine-skel", src: SPINE_SKEL });
          Assets.add({ alias: "dual-spine-atlas", src: SPINE_ATLAS });
          await Assets.load(["dual-spine-skel", "dual-spine-atlas"]);
          if (cancelled) return;
          const spine = Spine.from({
            skeleton: "dual-spine-skel",
            atlas: "dual-spine-atlas",
            scale: 0.4,
          });
          const anims = spine.state.data.skeletonData.animations.map((a) => a.name);
          const initial = anims.includes("portal") ? "portal" : (anims[0] ?? "");
          if (initial) spine.state.setAnimation(0, initial, true);
          spine.x = app.screen.width * 0.25;
          spine.y = app.screen.height * 0.85;
          leftHost.addChild(spine);
          if (!cancelled) setStatus((s) => ({ ...s, spine: "ok" }));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (!cancelled) setStatus((s) => ({ ...s, spine: "error", detail: `spine: ${msg}` }));
        }

        // ----- Cubism half -----
        try {
          for (let i = 0; i < 50; i++) {
            // biome-ignore lint/suspicious/noExplicitAny: Cubism Core global
            if (typeof (globalThis as any).Live2DCubismCore !== "undefined") break;
            await new Promise((r) => setTimeout(r, 100));
          }
          // biome-ignore lint/suspicious/noExplicitAny: Cubism Core global
          if (typeof (globalThis as any).Live2DCubismCore === "undefined") {
            throw new Error("Live2DCubismCore not available");
          }

          const { configureCubismSDK, Live2DModel } = await import("untitled-pixi-live2d-engine");
          configureCubismSDK({ memorySizeMB: 32 });
          const model = await Live2DModel.from(CUBISM_MODEL);
          if (cancelled) return;

          model.anchor.set(0.5, 0.5);
          const targetH = app.screen.height * 0.85;
          model.scale.set(targetH / 1500);
          model.position.set(app.screen.width * 0.75, app.screen.height * 0.5);
          rightHost.addChild(model);
          if (!cancelled) setStatus((s) => ({ ...s, cubism: "ok" }));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (!cancelled) setStatus((s) => ({ ...s, cubism: "error", detail: `cubism: ${msg}` }));
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!cancelled) setStatus((s) => ({ ...s, pixi: "error", detail: `pixi: ${msg}` }));
      }
    })();

    return () => {
      cancelled = true;
      if (appRef.current) {
        appRef.current.destroy(true, { children: true, texture: false });
        appRef.current = null;
      }
    };
  }, []);

  function badge(name: string, s: Status[keyof Status]) {
    const color =
      s === "ok"
        ? "text-[var(--color-accent)]"
        : s === "error"
          ? "text-red-400"
          : "text-[var(--color-fg-dim)]";
    return (
      <span className={color}>
        {name}={String(s)}
      </span>
    );
  }

  return (
    <main className="flex h-full flex-col overflow-hidden bg-[var(--color-bg)]">
      <header className="shrink-0 border-b border-[var(--color-border)] px-4 py-2 text-xs">
        <span className="font-mono text-[var(--color-accent)]">PoC · Dual Mount (T-rt1)</span>
        <span className="ml-3 font-mono text-[var(--color-fg-dim)]">
          {badge("pixi", status.pixi)} · {badge("spine", status.spine)} ·{" "}
          {badge("cubism", status.cubism)}
        </span>
        {status.detail && <span className="ml-3 text-red-400">{status.detail}</span>}
      </header>
      <div className="grid shrink-0 grid-cols-2 border-b border-[var(--color-border)]">
        <div className="border-r border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-fg-dim)]">
          Spine spineboy
        </div>
        <div className="px-4 py-2 text-xs text-[var(--color-fg-dim)]">Cubism Hiyori</div>
      </div>
      <div ref={canvasHostRef} className="min-h-0 flex-1" />
    </main>
  );
}
