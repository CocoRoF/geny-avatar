"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Per-canvas undo/redo stack for the DecomposeStudio editor.
 *
 * Photoshop's History panel sets the bar here: every discrete user
 * action becomes one undoable step, Ctrl+Z walks back through them,
 * Ctrl+Shift+Z walks forward, clicking an entry jumps to that state.
 *
 * Storage model:
 *
 *   - `baseline`: full snapshot of every editable canvas at the
 *     moment the studio became interactive. Acts as the "zero
 *     edits" anchor. When the stack overflows, the oldest entries
 *     are folded forward into the baseline so we never lose the
 *     ability to undo all the way back from the current state.
 *
 *   - `entries[]`: an action log. Each entry stores ONLY the
 *     canvases that actually changed in that action — a brush
 *     stroke in mask mode produces an entry with a single `mask`
 *     snapshot, never a copy of every untouched canvas.
 *
 *   - `pointer`: index of the current entry. -1 means we're at
 *     baseline. To compute the full canvas state at any pointer,
 *     walk entries backward from pointer; the first entry with a
 *     snapshot for a given key wins. Fall back to baseline.
 *
 * Snapshots are stored as `HTMLCanvasElement`, NOT `ImageData`. The
 * earlier ImageData approach triggered Chrome's "willReadFrequently"
 * heuristic — repeated getImageData() reads on the live mask / paint
 * canvas after every stroke would demote the canvas from GPU-backed
 * to CPU-backed storage, after which:
 *   - brush stamps lose GPU acceleration (slow on big brushes),
 *   - WebGL texImage2D() of the canvas forces CPU→GPU re-uploads
 *     instead of the GPU-to-GPU blit it gets for accelerated
 *     canvases.
 * The combined effect was severe lag after a handful of edits.
 * Canvas-to-canvas snapshots via drawImage stay GPU-to-GPU on both
 * the capture (target → snapshot) and restore (snapshot → target)
 * paths, so the live canvases keep their accelerated backing.
 *
 * Memory cost: equivalent to the ImageData approach (4 bytes/pixel)
 * but lives in GPU texture memory instead of the JS heap, which
 * also relieves JS GC pressure.
 */

export type CanvasKey = "mask" | "paint" | `region:${string}`;

export interface HistoryEntry {
  id: number;
  label: string;
  timestamp: number;
  /** Per-canvas snapshots taken AFTER this action. Only canvases
   *  that actually changed appear here; canvases outside this map
   *  inherit their state from the most recent earlier entry that
   *  touched them (or the baseline). */
  snapshots: ReadonlyMap<CanvasKey, HTMLCanvasElement>;
}

const MAX_ENTRIES = 30;

export interface UseHistoryResult {
  entries: ReadonlyArray<HistoryEntry>;
  pointer: number;
  canUndo: boolean;
  canRedo: boolean;
  /** Snapshot the editor's current canvas state as the zero-edit
   *  baseline. Past entries are wiped — call this whenever the
   *  studio's source / mode changes underneath. */
  setBaseline: (snapshots: ReadonlyMap<CanvasKey, HTMLCanvasElement>) => void;
  /** Append an entry capturing the changed canvases. Truncates any
   *  forward history if the pointer wasn't already at the tip
   *  (matches Photoshop's "you can't redo after a new edit"). */
  commit: (label: string, changes: ReadonlyMap<CanvasKey, HTMLCanvasElement>) => void;
  /** Step backward; returns the canvas state to restore. null when
   *  already at baseline. */
  undo: () => Map<CanvasKey, HTMLCanvasElement> | null;
  /** Step forward; returns the canvas state to restore. null when
   *  no forward history exists. */
  redo: () => Map<CanvasKey, HTMLCanvasElement> | null;
  /** Jump directly to an entry (or `-1` for baseline). Returns the
   *  state to restore or null when the index is out of range. */
  goto: (index: number) => Map<CanvasKey, HTMLCanvasElement> | null;
}

export function useHistory(): UseHistoryResult {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [pointer, setPointer] = useState(-1);
  const baselineRef = useRef<Map<CanvasKey, HTMLCanvasElement>>(new Map());
  const idCounterRef = useRef(0);

  // Mirror state into refs so the operation callbacks below don't
  // capture stale `entries` / `pointer` closures — important because
  // undo + redo + goto can run in rapid succession (Ctrl+Z held).
  const entriesRef = useRef<HistoryEntry[]>([]);
  const pointerRef = useRef(-1);
  entriesRef.current = entries;
  pointerRef.current = pointer;

  /** Walk backward from `ptr` to assemble the full canvas state.
   *  For each key seen in baseline or any entry, the most recent
   *  entry ≤ ptr that snapshotted it wins; baseline is the
   *  fallback. */
  const computeState = useCallback((ptr: number): Map<CanvasKey, HTMLCanvasElement> => {
    const allKeys = new Set<CanvasKey>();
    for (const k of baselineRef.current.keys()) allKeys.add(k);
    for (const e of entriesRef.current) for (const k of e.snapshots.keys()) allKeys.add(k);

    const result = new Map<CanvasKey, HTMLCanvasElement>();
    for (const key of allKeys) {
      let found: HTMLCanvasElement | null = null;
      // ptr can be -1 (baseline) — the loop just doesn't enter.
      for (let i = Math.min(ptr, entriesRef.current.length - 1); i >= 0; i--) {
        const snap = entriesRef.current[i].snapshots.get(key);
        if (snap) {
          found = snap;
          break;
        }
      }
      if (!found) {
        const base = baselineRef.current.get(key);
        if (base) found = base;
      }
      if (found) result.set(key, found);
    }
    return result;
  }, []);

  const setBaseline = useCallback((snapshots: ReadonlyMap<CanvasKey, HTMLCanvasElement>) => {
    baselineRef.current = new Map(snapshots);
    setEntries([]);
    setPointer(-1);
    idCounterRef.current = 0;
  }, []);

  const commit = useCallback(
    (label: string, changes: ReadonlyMap<CanvasKey, HTMLCanvasElement>) => {
      if (changes.size === 0) return;
      // Truncate forward history — any pending redo is discarded the
      // moment the user makes a new edit. Matches Photoshop semantics.
      const truncated = entriesRef.current.slice(0, pointerRef.current + 1);
      const newEntry: HistoryEntry = {
        id: ++idCounterRef.current,
        label,
        timestamp: Date.now(),
        snapshots: new Map(changes),
      };
      const next = [...truncated, newEntry];
      // Overflow: fold the oldest entry's snapshots into baseline so
      // we never lose the ability to undo past it; just lose the
      // user-visible row in the history list.
      while (next.length > MAX_ENTRIES) {
        const dropped = next.shift();
        if (!dropped) break;
        for (const [k, v] of dropped.snapshots) baselineRef.current.set(k, v);
      }
      setEntries(next);
      setPointer(next.length - 1);
    },
    [],
  );

  const undo = useCallback((): Map<CanvasKey, HTMLCanvasElement> | null => {
    if (pointerRef.current < 0) return null;
    const newPtr = pointerRef.current - 1;
    setPointer(newPtr);
    return computeState(newPtr);
  }, [computeState]);

  const redo = useCallback((): Map<CanvasKey, HTMLCanvasElement> | null => {
    if (pointerRef.current >= entriesRef.current.length - 1) return null;
    const newPtr = pointerRef.current + 1;
    setPointer(newPtr);
    return computeState(newPtr);
  }, [computeState]);

  const goto = useCallback(
    (index: number): Map<CanvasKey, HTMLCanvasElement> | null => {
      if (index < -1 || index >= entriesRef.current.length) return null;
      setPointer(index);
      return computeState(index);
    },
    [computeState],
  );

  return {
    entries,
    pointer,
    canUndo: pointer >= 0,
    canRedo: pointer < entries.length - 1,
    setBaseline,
    commit,
    undo,
    redo,
    goto,
  };
}
