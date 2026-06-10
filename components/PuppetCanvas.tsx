"use client";

import type { Application } from "pixi.js";
import { useEffect, useRef, useState } from "react";
import type { AdapterLoadInput, AvatarAdapter } from "@/lib/adapters/AvatarAdapter";
import type { Live2DAdapter } from "@/lib/adapters/Live2DAdapter";
import type { Avatar } from "@/lib/avatar/types";
import { usePuppet } from "@/lib/avatar/usePuppet";
import { useEditorStore } from "@/lib/store/editor";
import { useViewportStore, VIEWPORT_LIMITS } from "@/lib/store/viewport";

type Props = {
  /** null means "show empty state — drop / pick a puppet". */
  input: AdapterLoadInput | null;
  /** Empty state to render when input is null. */
  empty?: React.ReactNode;
  /**
   * Notify the page when a puppet is fully mounted. The page can use the
   * adapter for subsequent mutations (it's not in the store) and the app
   * for e.g. thumbnail capture.
   */
  onReady?: (avatar: Avatar, adapter: AvatarAdapter, app: Application) => void;
  /** Notify of load errors. */
  onError?: (error: string) => void;
  /** Background color override for the Pixi Application. */
  background?: string;
};

const WHEEL_ZOOM_SPEED = 0.0015;
const DRAG_CLICK_THRESHOLD_PX = 4;

/**
 * Mounts a Pixi canvas + adapter and writes the resulting Avatar into the
 * editor store. Pages embed this and listen via the store + an adapter
 * ref the component hands them through `onReady`.
 *
 * Owns the editor viewport (pan / zoom + intrinsic transform) — the
 * Animation tab's DisplaySection writes intrinsic kScale / shifts into
 * the same `useViewportStore`, and this component composes everything
 * into a single `applyTransform` that runs on every state change.
 */
export function PuppetCanvas({ input, empty, onReady, onError, background }: Props) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const setAvatar = useEditorStore((s) => s.setAvatar);
  const setPlaying = useEditorStore((s) => s.setPlayingAnimation);

  // Viewport store handles. Read individually so we resubscribe with
  // primitive equality (avoids the "object identity always changes"
  // re-render footgun zustand selectors hit when returning records).
  const setBaseFactor = useViewportStore((s) => s.setBaseFactor);
  const setUserView = useViewportStore((s) => s.setUserView);
  const setUserPan = useViewportStore((s) => s.setUserPan);
  const resetViewport = useViewportStore((s) => s.reset);

  // Refs the apply effect reads from on every wake. We could `subscribe`
  // to the store and pull state in the effect body, but stale-closure
  // is easier to reason about with explicit refs.
  const adapterRef = useRef<AvatarAdapter | null>(null);
  const appRef = useRef<Application | null>(null);
  // Untransformed puppet dimensions captured once at mount. Resize
  // recompute MUST NOT re-measure the display object: its width/height
  // include the currently applied scale, so re-measuring feeds the
  // factor back into itself.
  const baseSizeRef = useRef<{ w: number; h: number } | null>(null);
  const dragRef = useRef({
    active: false,
    pointerId: -1,
    moved: false,
    startClientX: 0,
    startClientY: 0,
    startPanX: 0,
    startPanY: 0,
  });

  const { status, error } = usePuppet({
    input,
    host,
    background,
    onMount: (avatar, adapter, app) => {
      adapterRef.current = adapter;
      appRef.current = app;
      // Measure the puppet once (pre-transform), then fit. The size is
      // kept in a ref so window resizes can recompute the fit factor
      // without re-measuring a scaled display object.
      const baseSize = measureBaseSize(adapter);
      baseSizeRef.current = baseSize;
      const baseFactor = fitBaseFactor(adapter, app, baseSize);

      // Anchor the puppet so position addresses its center, then set
      // the initial position to canvas center. apply() below mutates
      // scale + position thereafter.
      const display = adapter.getDisplayObject();
      // biome-ignore lint/suspicious/noExplicitAny: pixi display surface
      const d = display as any;
      if (d?.anchor?.set) d.anchor.set(0.5, 0.5);
      else if (d?.pivot?.set) {
        const native = (adapter as Live2DAdapter).getNativeSize?.();
        const w = native?.width ?? d?.width ?? 800;
        const h = native?.height ?? d?.height ?? 1200;
        d.pivot.set(w / 2, h / 2);
      }

      // Reset viewport state for the new puppet (no carry-over of
      // pan/zoom from a previous edit), then prime the base factor.
      resetViewport();
      setBaseFactor(baseFactor);

      setAvatar(avatar);
      const candidates = ["Idle", "portal"];
      const initial =
        avatar.animations.find((a) => candidates.includes(a.name)) ?? avatar.animations[0];
      if (initial) {
        adapter.playAnimation(initial.name);
        setPlaying(initial.name);
      }
      onReady?.(avatar, adapter, app);
    },
  });

  useEffect(() => {
    if (status === "error" && error) onError?.(error);
  }, [status, error, onError]);

  // When the input goes back to null (user cleared), drop the avatar
  // from the store too.
  useEffect(() => {
    if (input == null) {
      setAvatar(null);
      resetViewport();
      adapterRef.current = null;
      appRef.current = null;
      baseSizeRef.current = null;
    }
  }, [input, setAvatar, resetViewport]);

  // Keep the puppet fitted + centered when the host box changes (window
  // resize, side panel collapse). `resizeTo: host` already resizes the
  // renderer; this recomputes the fit factor from the stored base size
  // and re-centers. User zoom/pan are preserved — only baseFactor moves.
  useEffect(() => {
    if (!host) return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      // Wait a frame so Pixi's own resizeTo handler has updated
      // app.screen before we read it.
      raf = requestAnimationFrame(() => {
        const adapter = adapterRef.current;
        const app = appRef.current;
        const baseSize = baseSizeRef.current;
        if (!adapter || !app || !baseSize) return;
        const v = useViewportStore.getState();
        if (v.baseFactor == null) return;
        const next = fitBaseFactor(adapter, app, baseSize);
        if (Number.isFinite(next) && next > 0 && Math.abs(next - v.baseFactor) > 1e-6) {
          // Store change re-applies the transform via the subscription.
          setBaseFactor(next);
        } else {
          // Same scale but the center moved (e.g. pure width change on
          // Spine's fixed factor) — re-apply for the recenter.
          applyTransform(adapter, app, v);
        }
      });
    });
    ro.observe(host);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [host, setBaseFactor]);

  // Apply transform on every viewport-state change. The store sub-
  // scription pattern means the effect only fires when one of the
  // four contributing values (baseFactor, userZoom, userPan,
  // intrinsic) changes — not on unrelated editor-store mutations.
  useEffect(() => {
    const unsub = useViewportStore.subscribe((state) => {
      applyTransform(adapterRef.current, appRef.current, state);
    });
    // Apply once now to cover the case where the first store update
    // already happened before this effect installed its listener.
    applyTransform(adapterRef.current, appRef.current, useViewportStore.getState());
    return unsub;
  }, []);

  // Pan/zoom event handlers. Bind to host so we don't catch wheel
  // events outside the canvas region.
  useEffect(() => {
    if (!host) return;

    const toScreenCoords = (clientX: number, clientY: number) => {
      const app = appRef.current;
      const rect = host.getBoundingClientRect();
      if (!app || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
      const sx = app.screen.width / rect.width;
      const sy = app.screen.height / rect.height;
      return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
    };

    const onWheel = (e: WheelEvent) => {
      const app = appRef.current;
      if (!adapterRef.current || !app) return;
      e.preventDefault();
      const { userZoom, userPan } = useViewportStore.getState();
      const oldZoom = userZoom;
      const newZoom = Math.max(
        VIEWPORT_LIMITS.MIN_USER_ZOOM,
        Math.min(VIEWPORT_LIMITS.MAX_USER_ZOOM, oldZoom * Math.exp(-e.deltaY * WHEEL_ZOOM_SPEED)),
      );
      if (newZoom === oldZoom) return;

      // Zoom around the cursor: keep the world point under the cursor
      // stationary in screen space.
      const ratio = newZoom / oldZoom;
      const cursor = toScreenCoords(e.clientX, e.clientY);
      const baselineX = app.screen.width / 2;
      const baselineY = app.screen.height / 2;
      const nextPan = {
        x: userPan.x * ratio + (cursor.x - baselineX) * (1 - ratio),
        y: userPan.y * ratio + (cursor.y - baselineY) * (1 - ratio),
      };
      setUserView(newZoom, nextPan);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (!adapterRef.current) return;
      const { userPan } = useViewportStore.getState();
      dragRef.current = {
        active: true,
        moved: false,
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startPanX: userPan.x,
        startPanY: userPan.y,
      };
      try {
        host.setPointerCapture(e.pointerId);
      } catch {
        /* capture optional */
      }
      host.style.cursor = "grabbing";
    };

    const onPointerMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d.active || e.pointerId !== d.pointerId) return;
      const dx = e.clientX - d.startClientX;
      const dy = e.clientY - d.startClientY;
      if (!d.moved && Math.hypot(dx, dy) > DRAG_CLICK_THRESHOLD_PX) d.moved = true;
      if (!d.moved) return;
      const app = appRef.current;
      if (!app) return;
      const rect = host.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const sx = app.screen.width / rect.width;
      const sy = app.screen.height / rect.height;
      setUserPan({
        x: d.startPanX + dx * sx,
        y: d.startPanY + dy * sy,
      });
    };

    const onPointerEnd = (e: PointerEvent) => {
      const d = dragRef.current;
      if (e.pointerId !== d.pointerId) return;
      d.active = false;
      try {
        host.releasePointerCapture(e.pointerId);
      } catch {
        /* release optional */
      }
      host.style.cursor = "grab";
    };

    host.style.cursor = "grab";
    host.addEventListener("wheel", onWheel, { passive: false });
    host.addEventListener("pointerdown", onPointerDown);
    host.addEventListener("pointermove", onPointerMove);
    host.addEventListener("pointerup", onPointerEnd);
    host.addEventListener("pointercancel", onPointerEnd);
    return () => {
      host.style.cursor = "";
      host.removeEventListener("wheel", onWheel);
      host.removeEventListener("pointerdown", onPointerDown);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerup", onPointerEnd);
      host.removeEventListener("pointercancel", onPointerEnd);
    };
  }, [host, setUserView, setUserPan]);

  if (input == null && empty) {
    return <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center">{empty}</div>;
  }

  return <div ref={setHost} className="min-h-0 min-w-0 flex-1" />;
}

/**
 * Measure the puppet's untransformed dimensions. Must run before any
 * scale is applied (i.e. at mount): the display.width fallback reads
 * the CURRENT rendered extent, which includes scale once applied.
 */
function measureBaseSize(adapter: AvatarAdapter): { w: number; h: number } {
  if (adapter.runtime !== "live2d") return { w: 1, h: 1 };
  // biome-ignore lint/suspicious/noExplicitAny: display surface varies per runtime
  const display = adapter.getDisplayObject() as any;
  const native = (adapter as Live2DAdapter).getNativeSize?.();
  // pixi-live2d-display's display.width/height end up as the
  // current rendered pixel extent, which is the most reliable
  // signal across engine versions. native (canvas info / layout)
  // is preferred when present but the fallback to display.width
  // matches the historical behavior so existing puppets stay sized
  // the way users are used to.
  return {
    w: pickPositive(native?.width, display?.width, 800),
    h: pickPositive(native?.height, display?.height, 1200),
  };
}

/**
 * Fit-to-canvas factor for a measured puppet — 90% of the smaller axis
 * covers the puppet without crowding viewport edges. Recomputed on
 * window resize from the stored base size.
 */
function fitBaseFactor(
  adapter: AvatarAdapter,
  app: Application,
  baseSize: { w: number; h: number },
): number {
  const screen = app.screen;
  if (adapter.runtime === "live2d") {
    return Math.min((screen.width * 0.9) / baseSize.w, (screen.height * 0.9) / baseSize.h);
  }
  // Spine — anchored at feet, modest fixed scale matches the existing
  // PuppetCanvas behavior.
  return 0.5;
}

function pickPositive(...candidates: Array<number | null | undefined>): number {
  for (const c of candidates) {
    if (typeof c === "number" && Number.isFinite(c) && c > 0) return c;
  }
  return 1;
}

/**
 * Apply the composed transform to the puppet's display object.
 * Defensive against missing adapter/app/baseFactor (any of which mean
 * "the puppet hasn't fully loaded yet" — just bail).
 */
function applyTransform(
  adapter: AvatarAdapter | null,
  app: Application | null,
  v: ReturnType<typeof useViewportStore.getState>,
): void {
  if (!adapter || !app || v.baseFactor == null) return;
  const display = adapter.getDisplayObject();
  if (!display) return;
  // biome-ignore lint/suspicious/noExplicitAny: pixi display surface
  const d = display as any;

  if (adapter.runtime === "live2d") {
    const finalScale = v.baseFactor * v.userZoom * v.intrinsic.kScale;
    const x = app.screen.width / 2 + v.userPan.x + v.intrinsic.shiftX;
    const y = app.screen.height / 2 + v.userPan.y + v.intrinsic.shiftY;
    d.scale?.set?.(finalScale);
    d.position?.set?.(x, y);
  } else {
    // Spine — keep the foot-anchored layout for now; pan/zoom still
    // applies but intrinsic kScale/shifts aren't used (Spine's animation
    // tab is out of scope, see Phase 8 plan).
    const finalScale = v.baseFactor * v.userZoom;
    const x = app.screen.width / 2 + v.userPan.x;
    const y = app.screen.height * 0.85 + v.userPan.y;
    d.scale?.set?.(finalScale);
    d.x = x;
    d.y = y;
  }
}
