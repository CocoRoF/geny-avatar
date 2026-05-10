"use client";

import { create } from "zustand";

/**
 * Editor canvas viewport — pan / zoom + the puppet's intrinsic
 * display config (kScale + initial X/Y shift). Held in a tiny store
 * so PuppetCanvas (mounter / event handler) and the Animation tab's
 * DisplaySection (slider source) can compose without prop drilling.
 *
 * Two layers, multiplied at apply time:
 *
 *   - **User viewport** (`userZoom`, `userPan`) — purely transient
 *     view state. Drag to pan, wheel to zoom. Reset on puppet swap.
 *     Never persisted, never exported.
 *   - **Intrinsic** (`kScale`, `shiftX`, `shiftY`) — what Geny's
 *     model_registry calls kScale / initialXshift / initialYshift.
 *     IDB-persisted by the Animation tab (Phase 8.7) and exported
 *     in the baked zip's avatar-editor.json (Phase 8.8).
 *
 * Final transforms = baseFactor × userZoom × intrinsic.kScale,
 * position = canvas_center + userPan + intrinsic.shift.
 */

const MIN_USER_ZOOM = 0.2;
const MAX_USER_ZOOM = 5;

export type ViewportState = {
  /** Fit-to-canvas factor — set by PuppetCanvas once after mount.
   *  Stable across slider movement; only changes on puppet load /
   *  resize. `null` until the puppet is mounted. */
  baseFactor: number | null;
  /** User wheel zoom multiplier on top of baseFactor. */
  userZoom: number;
  /** User drag pan in canvas pixel space. */
  userPan: { x: number; y: number };
  /** Per-puppet display config — what gets exported to Geny. */
  intrinsic: { kScale: number; shiftX: number; shiftY: number };

  setBaseFactor: (n: number) => void;
  setUserZoom: (z: number) => void;
  /** Atomic pan + zoom update for cursor-pivoted wheel zoom. */
  setUserView: (z: number, pan: { x: number; y: number }) => void;
  setUserPan: (pan: { x: number; y: number }) => void;
  setIntrinsic: (next: Partial<ViewportState["intrinsic"]>) => void;
  /** Reset everything to defaults — called on puppet load to drop the
   *  prior puppet's pan/zoom state. */
  reset: () => void;
  /** Reset just user pan/zoom (keep intrinsic). The "fit to canvas"
   *  button in Animation tab — undoes scrolling/panning without
   *  forgetting the user's chosen kScale. */
  resetUserView: () => void;
};

const INITIAL: Pick<ViewportState, "baseFactor" | "userZoom" | "userPan" | "intrinsic"> = {
  baseFactor: null,
  userZoom: 1,
  userPan: { x: 0, y: 0 },
  intrinsic: { kScale: 1, shiftX: 0, shiftY: 0 },
};

export const useViewportStore = create<ViewportState>()((set) => ({
  ...INITIAL,
  setBaseFactor: (n) => set({ baseFactor: n }),
  setUserZoom: (z) => set({ userZoom: Math.max(MIN_USER_ZOOM, Math.min(MAX_USER_ZOOM, z)) }),
  setUserView: (z, pan) =>
    set({
      userZoom: Math.max(MIN_USER_ZOOM, Math.min(MAX_USER_ZOOM, z)),
      userPan: pan,
    }),
  setUserPan: (pan) => set({ userPan: pan }),
  setIntrinsic: (next) => set((s) => ({ intrinsic: { ...s.intrinsic, ...next } })),
  reset: () => set({ ...INITIAL }),
  resetUserView: () => set({ userZoom: INITIAL.userZoom, userPan: INITIAL.userPan }),
}));

export const VIEWPORT_LIMITS = { MIN_USER_ZOOM, MAX_USER_ZOOM };
