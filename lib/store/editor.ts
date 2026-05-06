import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { Avatar, LayerId } from "../avatar/types";

/**
 * Editor state — single source of truth for the avatar viewer / editor UI.
 *
 * The runtime adapter sits *outside* this store. Adapters are mutable class
 * instances; putting them in an immer slice would freeze them. Pages keep
 * an `adapter` ref from `usePuppet` and reach the two together via
 * `usePuppetMutations`.
 *
 * History is a snapshot stack of override maps. Per-action snapshots are
 * cheap (record-of-id-to-bool) and undo restores the whole map at once,
 * which matches the user's intent for bulk operations like "hide all".
 */

type VisibilitySnapshot = Record<LayerId, boolean>;

const HISTORY_LIMIT = 50;

export type EditorState = {
  avatar: Avatar | null;
  selectedLayerIds: ReadonlyArray<LayerId>;
  playingAnimation: string | null;
  layerFilter: string;
  visibilityOverrides: Record<LayerId, boolean>;
  /** snapshots before each visibility-changing action (most recent at end) */
  past: VisibilitySnapshot[];
  /** snapshots ahead of current (filled by undo, drained by redo) */
  future: VisibilitySnapshot[];

  // ----- actions -----

  setAvatar(avatar: Avatar | null): void;

  setLayerVisibility(id: LayerId, visible: boolean): void;
  bulkSetLayerVisibility(ids: ReadonlyArray<LayerId>, visible: boolean): void;

  selectLayers(ids: ReadonlyArray<LayerId>): void;
  toggleLayerSelected(id: LayerId): void;

  setPlayingAnimation(name: string | null): void;
  setLayerFilter(query: string): void;

  /** Wipe overrides + selection + filter, keep avatar + animation.
   *  Goes through history so it's undoable. */
  resetOverrides(): void;

  /** Restore the most recent past snapshot. No-op if past is empty. */
  undo(): void;
  /** Replay the most recent undone snapshot. No-op if future is empty. */
  redo(): void;

  // ----- selectors / read-helpers -----

  canUndo(): boolean;
  canRedo(): boolean;
};

export const useEditorStore = create<EditorState>()(
  immer((set, get) => ({
    avatar: null,
    selectedLayerIds: [],
    playingAnimation: null,
    layerFilter: "",
    visibilityOverrides: {},
    past: [],
    future: [],

    setAvatar: (avatar) =>
      set((s) => {
        s.avatar = avatar;
        s.selectedLayerIds = [];
        s.playingAnimation = null;
        s.layerFilter = "";
        s.visibilityOverrides = avatar
          ? Object.fromEntries(avatar.layers.map((l) => [l.id, l.defaults.visible]))
          : {};
        s.past = [];
        s.future = [];
      }),

    setLayerVisibility: (id, visible) =>
      set((s) => {
        pushHistory(s);
        s.visibilityOverrides[id] = visible;
      }),

    bulkSetLayerVisibility: (ids, visible) =>
      set((s) => {
        pushHistory(s);
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
        pushHistory(s);
        s.selectedLayerIds = [];
        s.layerFilter = "";
        s.visibilityOverrides = s.avatar
          ? Object.fromEntries(s.avatar.layers.map((l) => [l.id, l.defaults.visible]))
          : {};
      }),

    undo: () =>
      set((s) => {
        const prev = s.past.pop();
        if (!prev) return;
        s.future.push({ ...s.visibilityOverrides });
        if (s.future.length > HISTORY_LIMIT) s.future.shift();
        s.visibilityOverrides = prev;
      }),

    redo: () =>
      set((s) => {
        const next = s.future.pop();
        if (!next) return;
        s.past.push({ ...s.visibilityOverrides });
        if (s.past.length > HISTORY_LIMIT) s.past.shift();
        s.visibilityOverrides = next;
      }),

    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,
  })),
);

function pushHistory(s: {
  past: VisibilitySnapshot[];
  future: VisibilitySnapshot[];
  visibilityOverrides: Record<LayerId, boolean>;
}) {
  s.past.push({ ...s.visibilityOverrides });
  if (s.past.length > HISTORY_LIMIT) s.past.shift();
  s.future = [];
}

// ----- selectors (cached references for stable re-renders) -----

// Stable empty arrays — selectors must return the same reference across calls
// when nothing changed, otherwise useSyncExternalStore loops.
const EMPTY_LAYERS: NonNullable<Avatar["layers"]> = [];
const EMPTY_ANIMATIONS: NonNullable<Avatar["animations"]> = [];

export const selectLayers = (s: EditorState) => s.avatar?.layers ?? EMPTY_LAYERS;
export const selectAnimations = (s: EditorState) => s.avatar?.animations ?? EMPTY_ANIMATIONS;
