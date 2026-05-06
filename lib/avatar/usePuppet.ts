"use client";

import { Application } from "pixi.js";
import { useEffect, useRef, useState } from "react";
import type { AdapterLoadInput, AvatarAdapter } from "../adapters/AvatarAdapter";
import { createAdapter } from "../adapters/AvatarRegistry";
import type { Avatar } from "./types";

export type PuppetStatus = "idle" | "loading" | "ready" | "error";

export type PuppetState = {
  status: PuppetStatus;
  error?: string;
  avatar: Avatar | null;
  adapter: AvatarAdapter | null;
  app: Application | null;
};

export type UsePuppetOptions = {
  /**
   * The adapter input. Pass `null` to defer loading (e.g. waiting on the
   * user to pick a file). When this object reference changes, the puppet
   * reloads.
   */
  input: AdapterLoadInput | null;
  /**
   * Element to mount the Pixi canvas inside. The hook calls Application.init
   * with `resizeTo: host` so the canvas tracks the host's box.
   */
  host: HTMLElement | null;
  /** background color passed to Application.init */
  background?: string;
  /**
   * Called when the puppet is mounted on stage. Useful for positioning
   * (anchor / scale / x / y) which differs between Spine slot pivots and
   * Cubism model space.
   */
  onMount?: (avatar: Avatar, adapter: AvatarAdapter, app: Application) => void | Promise<void>;
};

/**
 * Bootstraps a Pixi Application + adapter for one PoC / preview pane. Returns
 * the live state plus the loaded Avatar. Cleans up on unmount or input change.
 */
export function usePuppet(options: UsePuppetOptions): PuppetState {
  const { input, host, background = "#0b0d10", onMount } = options;
  const [state, setState] = useState<PuppetState>({
    status: "idle",
    avatar: null,
    adapter: null,
    app: null,
  });
  const onMountRef = useRef(onMount);
  onMountRef.current = onMount;

  useEffect(() => {
    if (!host || !input) return;

    let cancelled = false;
    const app = new Application();
    let adapter: AvatarAdapter | null = null;

    setState({ status: "loading", avatar: null, adapter: null, app: null });

    (async () => {
      try {
        await app.init({
          background,
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

        adapter = createAdapter(input);
        const avatar = await adapter.load(input);
        if (cancelled) {
          adapter.destroy();
          app.destroy(true);
          return;
        }

        const display = adapter.getDisplayObject();
        if (display) app.stage.addChild(display);

        // Adapters that need per-frame fixups (Cubism opacity overrides
        // that have to outrun motion updates) hook into the ticker here.
        adapter.attachToTicker?.(app.ticker);

        await onMountRef.current?.(avatar, adapter, app);

        if (cancelled) {
          adapter.destroy();
          app.destroy(true, { children: true, texture: false });
          return;
        }

        setState({ status: "ready", avatar, adapter, app });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!cancelled) {
          console.error(e);
          setState({
            status: "error",
            error: msg,
            avatar: null,
            adapter: null,
            app: null,
          });
        }
      }
    })();

    return () => {
      cancelled = true;
      adapter?.destroy();
      app.destroy(true, { children: true, texture: false });
    };
  }, [input, host, background]);

  return state;
}
