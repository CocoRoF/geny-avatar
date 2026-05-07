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

  /** Layer currently open in DecomposeStudio. null = studio closed. */
  studioLayerId: LayerId | null;
  /** Layer currently open in GeneratePanel. null = panel closed. */
  generateLayerId: LayerId | null;
  /** Refined mask blobs per layer (PNG, white=visible, black/transparent=masked).
   *  In-memory only for now; IDB persistence lands when DecomposeStudio
   *  promotes from v1 to a feature you can rely on. */
  layerMasks: Record<LayerId, Blob>;
  /** AI-generated texture overrides per layer (PNG sized to the layer's
   *  upright rect). The adapter composites these onto the atlas page
   *  with `source-over` and triangle clipping. In-memory; IDB
   *  persistence lands in Sprint 3.4. */
  layerTextureOverrides: Record<LayerId, Blob>;

  // ----- actions -----

  setAvatar(avatar: Avatar | null): void;

  setLayerVisibility(id: LayerId, visible: boolean): void;
  bulkSetLayerVisibility(ids: ReadonlyArray<LayerId>, visible: boolean): void;
  /** Merge a per-layer visibility map onto the current overrides — used
   *  by Variant apply. Goes through history so the user can undo. */
  applyVisibilityMap(next: Record<LayerId, boolean>): void;

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

  /** Open / close DecomposeStudio for a layer. */
  setStudioLayer(id: LayerId | null): void;
  /** Open / close GeneratePanel for a layer. */
  setGenerateLayer(id: LayerId | null): void;
  /** Save (or clear with `null`) the refined mask for a layer. */
  setLayerMask(id: LayerId, blob: Blob | null): void;
  /** Save (or clear with `null`) the AI-generated texture override
   *  that should replace the layer's atlas pixels on next render. */
  setLayerTextureOverride(id: LayerId, blob: Blob | null): void;

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
    studioLayerId: null,
    generateLayerId: null,
    layerMasks: {},
    layerTextureOverrides: {},

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
        s.studioLayerId = null;
        s.generateLayerId = null;
        s.layerMasks = {};
        s.layerTextureOverrides = {};
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

    applyVisibilityMap: (next) =>
      set((s) => {
        pushHistory(s);
        for (const [id, visible] of Object.entries(next)) {
          s.visibilityOverrides[id] = visible;
        }
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

    setStudioLayer: (id) =>
      set((s) => {
        s.studioLayerId = id;
      }),

    setGenerateLayer: (id) =>
      set((s) => {
        s.generateLayerId = id;
      }),

    setLayerMask: (id, blob) =>
      set((s) => {
        if (blob == null) delete s.layerMasks[id];
        else s.layerMasks[id] = blob;
      }),

    setLayerTextureOverride: (id, blob) =>
      set((s) => {
        if (blob == null) delete s.layerTextureOverrides[id];
        else s.layerTextureOverrides[id] = blob;
      }),
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
