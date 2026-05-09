"use client";

import { useCallback, useEffect, useState } from "react";
import {
  deleteRegionMasks,
  loadRegionMasks,
  type RegionMaskEntry,
  saveRegionMasks,
} from "../persistence/db";

/**
 * Per-(puppet, layer) manually-defined region list — name + color +
 * binary mask, painted in DecomposeStudio's split mode (Sprint E.2).
 * GeneratePanel reads these as the primary source of truth for
 * multi-region generation when present, falling back to auto-detect
 * (Sprint E.3 wires that fallback).
 *
 * The hook just owns the IDB load/save cycle. Editing happens in
 * DecomposeStudio's local state (so brush strokes stay in-memory
 * canvases until the user saves), and the resulting blob array is
 * handed to `save()` once.
 *
 * `puppetKey === null` (the /poc/upload case before autoSave fires)
 * disables persistence entirely — `regions` stays `[]`.
 */
export function useRegionMasks(puppetKey: string | null, layerExternalId: string) {
  const [regions, setRegions] = useState<RegionMaskEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    (async () => {
      if (!puppetKey) {
        if (!cancelled) {
          setRegions([]);
          setLoaded(true);
        }
        return;
      }
      try {
        const rows = await loadRegionMasks(puppetKey, layerExternalId);
        if (!cancelled) {
          setRegions(rows);
          setLoaded(true);
        }
      } catch {
        if (!cancelled) {
          setRegions([]);
          setLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [puppetKey, layerExternalId]);

  const save = useCallback(
    async (next: RegionMaskEntry[]) => {
      if (!puppetKey) return;
      await saveRegionMasks({ puppetKey, layerExternalId, regions: next });
      setRegions(next);
    },
    [puppetKey, layerExternalId],
  );

  const clear = useCallback(async () => {
    if (!puppetKey) return;
    await deleteRegionMasks(puppetKey, layerExternalId);
    setRegions([]);
  }, [puppetKey, layerExternalId]);

  return { regions, loaded, save, clear };
}
