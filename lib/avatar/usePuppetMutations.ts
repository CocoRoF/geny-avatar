"use client";

import { useCallback } from "react";
import type { AvatarAdapter } from "../adapters/AvatarAdapter";
import { useEditorStore } from "../store/editor";
import type { LayerId, VariantApplyData } from "./types";

/**
 * Bridge between the editor store and the runtime adapter. Pages get one
 * function per user action that updates the store *and* tells the adapter
 * to mutate, so the two can never drift.
 *
 * undo/redo restore the whole visibilityOverrides map in one shot, then
 * we walk it and re-issue setLayerVisibility on the adapter so the Pixi
 * runtime reflects the same state.
 */
export function usePuppetMutations(adapter: AvatarAdapter | null) {
  const setLayerVisibilityState = useEditorStore((s) => s.setLayerVisibility);
  const bulkSetLayerVisibilityState = useEditorStore((s) => s.bulkSetLayerVisibility);
  const applyVisibilityMapState = useEditorStore((s) => s.applyVisibilityMap);
  const setPlayingAnimationState = useEditorStore((s) => s.setPlayingAnimation);
  const resetOverridesState = useEditorStore((s) => s.resetOverrides);
  const undoState = useEditorStore((s) => s.undo);
  const redoState = useEditorStore((s) => s.redo);

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

  /**
   * Apply a per-layer visibility map (e.g. from a saved Variant). Goes
   * through history so the user can undo back to the prior look.
   * Layers absent from the map keep their current visibility — partial
   * variants are intentional.
   */
  const applyVisibilityMap = useCallback(
    (next: Record<LayerId, boolean>) => {
      if (adapter) {
        for (const [id, visible] of Object.entries(next)) {
          adapter.setLayerVisibility(id, visible);
        }
      }
      applyVisibilityMapState(next);
    },
    [adapter, applyVisibilityMapState],
  );

  /**
   * Apply a Variant — runtime preset (Spine skin etc.) first, then the
   * visibility overlay. Order matters: switching the skin can change
   * which slots are present and what their default attachments are, so
   * the visibility hide pass needs to run on the post-skin skeleton to
   * land on the right slots. Skin switching itself isn't recorded in
   * undo history (the visibility step is); to revert, re-apply the
   * previous variant.
   */
  const applyVariant = useCallback(
    (bundle: { visibility: Record<LayerId, boolean>; applyData: VariantApplyData }) => {
      adapter?.applyVariantData(bundle.applyData);
      // setSkinByName resets slot attachments — push current store
      // visibility through the adapter so any prior overrides on
      // unaffected layers stay visible. The bundle.visibility merge
      // below then layers the variant's own changes on top.
      if (adapter && bundle.applyData.spineSkin !== undefined) {
        const current = useEditorStore.getState().visibilityOverrides;
        for (const [id, visible] of Object.entries(current)) {
          adapter.setLayerVisibility(id, visible);
        }
      }
      if (Object.keys(bundle.visibility).length > 0) {
        applyVisibilityMap(bundle.visibility);
      }
    },
    [adapter, applyVisibilityMap],
  );

  const syncAdapterFromStore = useCallback(() => {
    if (!adapter) return;
    const visibility = useEditorStore.getState().visibilityOverrides;
    for (const [layerId, visible] of Object.entries(visibility)) {
      adapter.setLayerVisibility(layerId, visible);
    }
  }, [adapter]);

  const reset = useCallback(() => {
    resetOverridesState();
    syncAdapterFromStore();
  }, [resetOverridesState, syncAdapterFromStore]);

  const undo = useCallback(() => {
    undoState();
    syncAdapterFromStore();
  }, [undoState, syncAdapterFromStore]);

  const redo = useCallback(() => {
    redoState();
    syncAdapterFromStore();
  }, [redoState, syncAdapterFromStore]);

  return {
    toggleLayer,
    bulkSetLayerVisibility,
    applyVisibilityMap,
    applyVariant,
    playAnimation,
    reset,
    undo,
    redo,
  };
}
