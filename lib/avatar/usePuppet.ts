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

    // Teardown helpers shared by the unmount cleanup and the in-flight
    // async's cancelled branches. Both paths can fire for the same load
    // (cleanup runs synchronously on unmount, then the awaited step
    // resolves and hits its cancelled check) — destroying a Pixi
    // Application twice throws, so the app teardown is run-once.
    // Adapter destroy stays callable from both paths on purpose: when
    // cleanup lands while `adapter.load()` is mid-await, the first
    // destroy sees a half-built adapter and the second call (from the
    // cancelled branch, after load resolved) is what actually releases
    // the late-materialized model. Adapter `destroy()` is idempotent.
    let appDestroyed = false;
    const destroyApp = () => {
      if (appDestroyed) return;
      appDestroyed = true;
      try {
        app.destroy(true, { children: true, texture: false });
      } catch (e) {
        console.warn("[usePuppet] app destroy failed", e);
      }
    };
    const destroyAdapter = () => {
      try {
        adapter?.destroy();
      } catch (e) {
        console.warn("[usePuppet] adapter destroy failed", e);
      }
    };

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
          destroyApp();
          return;
        }
        host.appendChild(app.canvas);

        adapter = createAdapter(input);
        const avatar = await adapter.load(input);
        if (cancelled) {
          destroyAdapter();
          destroyApp();
          return;
        }

        const display = adapter.getDisplayObject();
        if (display) app.stage.addChild(display);

        await onMountRef.current?.(avatar, adapter, app);

        if (cancelled) {
          destroyAdapter();
          destroyApp();
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
      destroyAdapter();
      destroyApp();
    };
  }, [input, host, background]);

  return state;
}
