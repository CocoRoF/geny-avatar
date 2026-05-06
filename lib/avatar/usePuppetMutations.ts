"use client";

import { useCallback } from "react";
import type { AvatarAdapter } from "../adapters/AvatarAdapter";
import { useEditorStore } from "../store/editor";
import type { LayerId } from "./types";

/**
 * Bridge between the editor store and the runtime adapter. Pages get one
 * function per user action that updates the store *and* tells the adapter
 * to mutate, so the two can never drift.
 *
 * The adapter is passed in (not stored), since it's a mutable runtime
 * object that doesn't belong inside the immer-managed store.
 */
export function usePuppetMutations(adapter: AvatarAdapter | null) {
  const setLayerVisibilityState = useEditorStore((s) => s.setLayerVisibility);
  const bulkSetLayerVisibilityState = useEditorStore((s) => s.bulkSetLayerVisibility);
  const setPlayingAnimationState = useEditorStore((s) => s.setPlayingAnimation);

  const toggleLayer = useCallback(
    (id: LayerId, nextVisible: boolean) => {
      adapter?.setLayerVisibility(id, nextVisible);
      setLayerVisibilityState(id, nextVisible);
    },
    [adapter, setLayerVisibilityState],
  );

  const bulkSetLayerVisibility = useCallback(
    (ids: ReadonlyArray<LayerId>, visible: boolean) => {
      if (adapter) {
        for (const id of ids) adapter.setLayerVisibility(id, visible);
      }
      bulkSetLayerVisibilityState(ids, visible);
    },
    [adapter, bulkSetLayerVisibilityState],
  );

  const playAnimation = useCallback(
    (name: string) => {
      adapter?.playAnimation(name);
      setPlayingAnimationState(name);
    },
    [adapter, setPlayingAnimationState],
  );

  return { toggleLayer, bulkSetLayerVisibility, playAnimation };
}
