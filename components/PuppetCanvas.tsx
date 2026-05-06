"use client";

import type { Application } from "pixi.js";
import { useEffect, useState } from "react";
import type { AdapterLoadInput, AvatarAdapter } from "@/lib/adapters/AvatarAdapter";
import type { Live2DAdapter } from "@/lib/adapters/Live2DAdapter";
import type { Avatar } from "@/lib/avatar/types";
import { usePuppet } from "@/lib/avatar/usePuppet";
import { useEditorStore } from "@/lib/store/editor";

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

/**
 * Mounts a Pixi canvas + adapter and writes the resulting Avatar into the
 * editor store. Pages embed this and listen via the store + an adapter
 * ref the component hands them through `onReady`.
 *
 * The runtime-specific fit math (Cubism native size vs Spine pivot) is
 * applied here so callers don't have to know whether the input is Live2D
 * or Spine.
 */
export function PuppetCanvas({ input, empty, onReady, onError, background }: Props) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const setAvatar = useEditorStore((s) => s.setAvatar);
  const setPlaying = useEditorStore((s) => s.setPlayingAnimation);

  const { status, error } = usePuppet({
    input,
    host,
    background,
    onMount: (avatar, adapter, app) => {
      const display = adapter.getDisplayObject();
      if (display) fitDisplayObject(display, adapter, app);
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
    if (input == null) setAvatar(null);
  }, [input, setAvatar]);

  if (input == null && empty) {
    return <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center">{empty}</div>;
  }

  return <div ref={setHost} className="min-h-0 min-w-0 flex-1" />;
}

// biome-ignore lint/suspicious/noExplicitAny: pixi/engine display surfaces vary
function fitDisplayObject(display: any, adapter: AvatarAdapter, app: Application) {
  if (display.scale?.set) display.scale.set(1);
  const screen = app.screen;

  if (adapter.runtime === "live2d") {
    const native = (adapter as Live2DAdapter).getNativeSize?.();
    const baseW = native?.width ?? display.width ?? 800;
    const baseH = native?.height ?? display.height ?? 1200;
    const factor = Math.min((screen.width * 0.9) / baseW, (screen.height * 0.9) / baseH);
    display.scale?.set?.(factor);
    if (display.anchor?.set) display.anchor.set(0.5, 0.5);
    else if (display.pivot?.set) display.pivot.set(baseW / 2, baseH / 2);
    display.position?.set?.(screen.width / 2, screen.height / 2);
  } else {
    display.scale.set(0.5);
    display.x = screen.width / 2;
    display.y = screen.height * 0.85;
  }
}
