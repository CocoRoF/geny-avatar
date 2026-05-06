import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { Avatar, LayerId } from "../avatar/types";

/**
 * Editor state — single source of truth for the avatar viewer / editor UI.
 *
 * The runtime adapter sits *outside* this store. Adapters are mutable class
 * instances (Pixi/engine objects under the hood); putting them inside an
 * immer-managed slice would either trigger structural-clone errors or get
 * frozen and break. Pages keep an `adapter` ref from `usePuppet` and call
 * its mutating methods *next to* the store action that records the new
 * intent — small wrapper functions in the page bridge the two.
 *
 * This sprint ships the minimum needed for the editor shell:
 *   - avatar (loaded puppet snapshot)
 *   - selection
 *   - playing animation
 *   - layer search filter
 *   - per-layer visibility overrides
 *
 * Color overrides, AI jobs, viewport, panel mode, undo/redo, variants
 * land later in 1.4b / 1.5+.
 */
export type EditorState = {
  avatar: Avatar | null;
  selectedLayerIds: ReadonlyArray<LayerId>;
  playingAnimation: string | null;
  layerFilter: string;
  /** layerId → visible. Initialized from layer.defaults.visible when the
   *  avatar lands; user toggles overlay on top. */
  visibilityOverrides: Record<LayerId, boolean>;

  // ----- actions -----

  /** Replace the whole avatar; resets selection, animation, filter, and
   *  re-seeds visibility from the new layers' defaults. */
  setAvatar(avatar: Avatar | null): void;

  /** Update one layer's visibility. Caller (page) is also responsible for
   *  calling adapter.setLayerVisibility — store doesn't reach into the
   *  adapter from inside the action. */
  setLayerVisibility(id: LayerId, visible: boolean): void;

  /** Bulk override — used by show-all / hide-all from a filtered subset. */
  bulkSetLayerVisibility(ids: ReadonlyArray<LayerId>, visible: boolean): void;

  selectLayers(ids: ReadonlyArray<LayerId>): void;
  toggleLayerSelected(id: LayerId): void;

  setPlayingAnimation(name: string | null): void;
  setLayerFilter(query: string): void;

  /** Wipe all overrides + selection + filter, keep avatar + animation. */
  resetOverrides(): void;
};

export const useEditorStore = create<EditorState>()(
  immer((set) => ({
    avatar: null,
    selectedLayerIds: [],
    playingAnimation: null,
    layerFilter: "",
    visibilityOverrides: {},

    setAvatar: (avatar) =>
      set((s) => {
        s.avatar = avatar;
        s.selectedLayerIds = [];
        s.playingAnimation = null;
        s.layerFilter = "";
        s.visibilityOverrides = avatar
          ? Object.fromEntries(avatar.layers.map((l) => [l.id, l.defaults.visible]))
          : {};
      }),

    setLayerVisibility: (id, visible) =>
      set((s) => {
        s.visibilityOverrides[id] = visible;
      }),

    bulkSetLayerVisibility: (ids, visible) =>
      set((s) => {
        for (const id of ids) s.visibilityOverrides[id] = visible;
      }),

    selectLayers: (ids) =>
      set((s) => {
        s.selectedLayerIds = [...ids];
      }),

    toggleLayerSelected: (id) =>
      set((s) => {
        const idx = s.selectedLayerIds.indexOf(id);
        if (idx === -1) s.selectedLayerIds = [...s.selectedLayerIds, id];
        else s.selectedLayerIds = s.selectedLayerIds.filter((x) => x !== id);
      }),

    setPlayingAnimation: (name) =>
      set((s) => {
        s.playingAnimation = name;
      }),

    setLayerFilter: (query) =>
      set((s) => {
        s.layerFilter = query;
      }),

    resetOverrides: () =>
      set((s) => {
        s.selectedLayerIds = [];
        s.layerFilter = "";
        s.visibilityOverrides = s.avatar
          ? Object.fromEntries(s.avatar.layers.map((l) => [l.id, l.defaults.visible]))
          : {};
      }),
  })),
);

// ----- selectors (cached references for stable re-renders) -----

export const selectLayers = (s: EditorState) => s.avatar?.layers ?? [];
export const selectAnimations = (s: EditorState) => s.avatar?.animations ?? [];
