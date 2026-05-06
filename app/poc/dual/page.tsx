"use client";

import { Application, Container } from "pixi.js";
import { useEffect, useRef, useState } from "react";
import { Live2DAdapter } from "@/lib/adapters/Live2DAdapter";
import { SpineAdapter } from "@/lib/adapters/SpineAdapter";

const SPINE_INPUT = {
  kind: "spine" as const,
  skeleton: "/samples/spineboy/spineboy-pro.skel",
  atlas: "/samples/spineboy/spineboy-pma.atlas",
  aliasPrefix: "poc-dual-spine",
};
const CUBISM_INPUT = {
  kind: "live2d" as const,
  model3: "/samples/hiyori/Hiyori.model3.json",
};

type Status = "pending" | "ok" | "error";
type Bag = { pixi: Status; spine: Status; cubism: Status; detail?: string };

export default function DualMountPocPage() {
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const [bag, setBag] = useState<Bag>({ pixi: "pending", spine: "pending", cubism: "pending" });

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;

    let cancelled = false;
    const app = new Application();
    const spineAdapter = new SpineAdapter();
    const cubismAdapter = new Live2DAdapter();

    (async () => {
      try {
        await app.init({
          background: "#0b0d10",
          resizeTo: host,
          antialias: true,
          autoDensity: true,
          resolution: window.devicePixelRatio || 1,
        });
        if (cancelled) return;
        host.appendChild(app.canvas);
        setBag((b) => ({ ...b, pixi: "ok" }));

        const leftHost = new Container();
        const rightHost = new Container();
        app.stage.addChild(leftHost);
        app.stage.addChild(rightHost);

        // ----- Spine -----
        try {
          const avatar = await spineAdapter.load(SPINE_INPUT);
          if (cancelled) return;
          const display = spineAdapter.getDisplayObject();
          if (display) {
            display.x = app.screen.width * 0.25;
            display.y = app.screen.height * 0.85;
            display.scale.set(0.4);
            leftHost.addChild(display);
          }
          const initial =
            avatar.animations.find((a) => a.name === "portal") ?? avatar.animations[0];
          if (initial) spineAdapter.playAnimation(initial.name);
          setBag((b) => ({ ...b, spine: "ok" }));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setBag((b) => ({ ...b, spine: "error", detail: `spine: ${msg}` }));
        }

        // ----- Cubism -----
        try {
          const avatar = await cubismAdapter.load(CUBISM_INPUT);
          if (cancelled) return;
          const display = cubismAdapter.getDisplayObject();
          if (display) {
            // biome-ignore lint/suspicious/noExplicitAny: engine display object
            const d = display as any;
            d.scale?.set?.(1);
            const native = cubismAdapter.getNativeSize();
            const baseW = native?.width ?? d.width ?? 800;
            const baseH = native?.height ?? d.height ?? 1200;
            // dual layout reserves the right half of the canvas
            const targetH = app.screen.height * 0.85;
            const targetW = app.screen.width * 0.45;
            const factor = Math.min(targetW / baseW, targetH / baseH);
            d.scale?.set?.(factor);
            if (d.anchor?.set) d.anchor.set(0.5, 0.5);
            else if (d.pivot?.set) d.pivot.set(baseW / 2, baseH / 2);
            d.position?.set?.(app.screen.width * 0.75, app.screen.height / 2);
            rightHost.addChild(display);
          }
          const idle = avatar.animations.find((a) => a.name === "Idle") ?? avatar.animations[0];
          if (idle) cubismAdapter.playAnimation(idle.name);
          setBag((b) => ({ ...b, cubism: "ok" }));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setBag((b) => ({ ...b, cubism: "error", detail: `cubism: ${msg}` }));
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setBag((b) => ({ ...b, pixi: "error", detail: `pixi: ${msg}` }));
      }
    })();

    return () => {
      cancelled = true;
      spineAdapter.destroy();
      cubismAdapter.destroy();
      app.destroy(true, { children: true, texture: false });
    };
  }, []);

  function badge(name: string, s: Status) {
    const color =
      s === "ok"
        ? "text-[var(--color-accent)]"
        : s === "error"
          ? "text-red-400"
          : "text-[var(--color-fg-dim)]";
    return (
      <span className={color}>
        {name}={s}
      </span>
    );
  }

  return (
    <main className="flex h-full flex-col overflow-hidden bg-[var(--color-bg)]">
      <header className="shrink-0 border-b border-[var(--color-border)] px-4 py-2 text-xs">
        <span className="font-mono text-[var(--color-accent)]">PoC · Dual Mount (T-rt1)</span>
        <span className="ml-3 font-mono text-[var(--color-fg-dim)]">
          {badge("pixi", bag.pixi)} · {badge("spine", bag.spine)} · {badge("cubism", bag.cubism)}
        </span>
        {bag.detail && <span className="ml-3 text-red-400">{bag.detail}</span>}
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
