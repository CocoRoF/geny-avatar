"use client";

import { Spine } from "@esotericsoftware/spine-pixi-v8";
import { Application, Assets } from "pixi.js";
import { useEffect, useMemo, useRef, useState } from "react";

type SlotInfo = {
  index: number;
  name: string;
  attachment: string | null;
  visible: boolean;
};

const SKELETON = "/samples/spineboy/spineboy-pro.skel";
const ATLAS = "/samples/spineboy/spineboy-pma.atlas";

export default function SpinePoCPage() {
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const spineRef = useRef<Spine | null>(null);
  const [slots, setSlots] = useState<SlotInfo[]>([]);
  const [animations, setAnimations] = useState<string[]>([]);
  const [activeAnim, setActiveAnim] = useState<string>("");
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
        setStatus("loading assets…");

        Assets.add({ alias: "spineboy-skel", src: SKELETON });
        Assets.add({ alias: "spineboy-atlas", src: ATLAS });
        await Assets.load(["spineboy-skel", "spineboy-atlas"]);

        if (cancelled) return;

        const spine = Spine.from({
          skeleton: "spineboy-skel",
          atlas: "spineboy-atlas",
          scale: 0.5,
        });

        spine.x = app.screen.width / 2;
        spine.y = app.screen.height * 0.85;

        app.stage.addChild(spine);
        spineRef.current = spine;

        const slotData = spine.skeleton.slots.map((s, i) => ({
          index: i,
          name: s.data.name,
          attachment: s.getAttachment()?.name ?? null,
          visible: true,
        }));
        setSlots(slotData);

        const anims = spine.state.data.skeletonData.animations.map((a) => a.name);
        setAnimations(anims);

        const initial = anims.includes("portal") ? "portal" : (anims[0] ?? "");
        if (initial) {
          spine.state.setAnimation(0, initial, true);
          setActiveAnim(initial);
        }
        setStatus(`loaded · ${slotData.length} slots · ${anims.length} animations`);
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
      spineRef.current = null;
    };
  }, []);

  const filteredSlots = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return slots;
    return slots.filter((s) => s.name.toLowerCase().includes(f));
  }, [slots, filter]);

  function setSlotVisibility(index: number, visible: boolean) {
    const spine = spineRef.current;
    if (!spine) return;
    const slot = spine.skeleton.slots[index];
    if (visible) {
      const name = slot.data.attachmentName;
      slot.setAttachment(name ? spine.skeleton.getAttachment(index, name) : null);
    } else {
      slot.setAttachment(null);
    }
    setSlots((prev) => prev.map((s) => (s.index === index ? { ...s, visible } : s)));
  }

  function toggleSlot(index: number) {
    const current = slots.find((s) => s.index === index);
    if (!current) return;
    setSlotVisibility(index, !current.visible);
  }

  function bulkSet(visible: boolean) {
    for (const s of filteredSlots) setSlotVisibility(s.index, visible);
  }

  function playAnim(name: string) {
    const spine = spineRef.current;
    if (!spine) return;
    spine.state.setAnimation(0, name, true);
    setActiveAnim(name);
  }

  return (
    <main className="grid h-full grid-cols-[1fr_320px] overflow-hidden bg-[var(--color-bg)]">
      <section className="flex min-h-0 min-w-0 flex-col">
        <header className="shrink-0 border-b border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-fg-dim)]">
          <span className="font-mono text-[var(--color-accent)]">PoC · Spine</span>
          <span className="ml-3">spineboy-pro · {status}</span>
          {error && <span className="ml-3 text-red-400">error: {error}</span>}
        </header>
        <div ref={canvasHostRef} className="min-h-0 flex-1" />
      </section>

      <aside className="flex min-h-0 flex-col border-l border-[var(--color-border)]">
        <div className="shrink-0 border-b border-[var(--color-border)] px-4 py-3">
          <div className="mb-2 text-xs uppercase tracking-widest text-[var(--color-fg-dim)]">
            Animations
          </div>
          <div className="flex flex-wrap gap-1">
            {animations.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => playAnim(name)}
                className={`rounded border px-2 py-1 text-xs transition-colors ${
                  name === activeAnim
                    ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                    : "border-[var(--color-border)] text-[var(--color-fg-dim)] hover:border-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        </div>

        <div className="shrink-0 border-b border-[var(--color-border)] px-4 py-3">
          <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-widest text-[var(--color-fg-dim)]">
            <span>
              Slots ({filteredSlots.length}/{slots.length})
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
          {filteredSlots.map((s) => (
            <li key={s.index}>
              <button
                type="button"
                onClick={() => toggleSlot(s.index)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-[var(--color-panel)]"
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    s.visible ? "bg-[var(--color-accent)]" : "bg-[var(--color-border)]"
                  }`}
                />
                <span className="font-mono text-xs text-[var(--color-fg-dim)]">
                  {String(s.index).padStart(2, "0")}
                </span>
                <span className="truncate">{s.name}</span>
                {s.attachment && s.attachment !== s.name && (
                  <span className="ml-auto truncate text-xs text-[var(--color-fg-dim)]">
                    → {s.attachment}
                  </span>
                )}
              </button>
            </li>
          ))}
          {filteredSlots.length === 0 && (
            <li className="px-2 py-4 text-center text-xs text-[var(--color-fg-dim)]">no match</li>
          )}
        </ul>
      </aside>
    </main>
  );
}
