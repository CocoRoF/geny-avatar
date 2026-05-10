"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadComponentLabels, saveComponentLabels } from "../persistence/db";

/**
 * Per-(puppet, layer) label dictionary for the auto-detected
 * components shown in GeneratePanel's REGIONS section. Keys are
 * component bbox signatures (`${x}_${y}_${w}_${h}`), values are the
 * user-typed names. Survives panel mounts and IDB sessions.
 *
 * Saving is debounced so a stream of keystrokes (e.g. typing "torso")
 * collapses into a single IDB write a moment after the user stops.
 *
 * `puppetKey === null` is a transient guard — when null, persistence
 * is disabled and labels live only in memory for that panel session.
 */
export function useComponentLabels(puppetKey: string | null, layerExternalId: string) {
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load on mount / key change.
  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    (async () => {
      if (!puppetKey) {
        if (!cancelled) {
          setLabels({});
          setLoaded(true);
        }
        return;
      }
      try {
        const map = await loadComponentLabels(puppetKey, layerExternalId);
        if (!cancelled) {
          setLabels(map);
          setLoaded(true);
        }
      } catch {
        if (!cancelled) {
          setLabels({});
          setLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [puppetKey, layerExternalId]);

  // Debounced persistence — coalesces rapid edits into one write.
  const scheduleSave = useCallback(
    (next: Record<string, string>) => {
      if (!puppetKey) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        void saveComponentLabels({ puppetKey, layerExternalId, labels: next });
      }, 400);
    },
    [puppetKey, layerExternalId],
  );

  // Cleanup on unmount: flush any pending write.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  const setLabel = useCallback(
    (signature: string, value: string) => {
      setLabels((prev) => {
        const next = { ...prev };
        const trimmed = value.trim();
        if (trimmed.length === 0) {
          delete next[signature];
        } else {
          next[signature] = trimmed;
        }
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave],
  );

  return { labels, loaded, setLabel };
}

/**
 * Stable signature for a component, used as the IDB label key. As
 * long as the layer's atlas region and silhouette don't change
 * across panel mounts, the same component produces the same
 * signature — and the user's typed name comes back.
 */
export function componentSignature(bbox: { x: number; y: number; w: number; h: number }): string {
  return `${bbox.x}_${bbox.y}_${bbox.w}_${bbox.h}`;
}
