"use client";

import { useCallback, useEffect, useState } from "react";
import {
  deleteVariant,
  listVariantsForPuppet,
  saveVariant,
  updateVariant,
  type VariantRow,
  type VariantRowId,
} from "../persistence/db";
import type { Layer, LayerId } from "./types";

/**
 * Per-puppet outfit presets. Pulls the variant list out of IndexedDB on
 * mount + whenever `puppetKey` changes, exposes capture / apply / rename
 * / delete actions, and re-syncs the list after every mutation so the
 * panel reflects truth without prop drilling.
 *
 * `puppetKey === null` (e.g. /poc/upload before the first autoSave)
 * disables persistence — the hook returns an empty list and rejects all
 * mutations. The same scheme as AI history.
 *
 * Variants store visibility against `Layer.externalId` (runtime-stable),
 * not `Layer.id` (regenerated per load). `apply` is responsible for the
 * lookup back to current Layer ids — it returns the next visibility
 * map, leaving the caller to push it through the adapter (we don't
 * thread the adapter into the hook to keep React/IO concerns separate).
 */
export function useVariants(puppetKey: string | null) {
  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!puppetKey) {
      setVariants([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const rows = await listVariantsForPuppet(puppetKey);
      setVariants(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [puppetKey]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!puppetKey) {
        setVariants([]);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const rows = await listVariantsForPuppet(puppetKey);
        if (!cancelled) setVariants(rows);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [puppetKey]);

  /**
   * Capture the current visibility map as a new variant. `visibility` is
   * keyed by `Layer.id`; we translate to `Layer.externalId` via `layers`
   * before persisting so the variant survives reloads.
   */
  const capture = useCallback(
    async (
      name: string,
      visibilityByLayerId: Record<LayerId, boolean>,
      layers: ReadonlyArray<Layer>,
      description?: string,
    ): Promise<VariantRowId | null> => {
      if (!puppetKey) return null;
      const idToExternal = new Map<LayerId, string>();
      for (const layer of layers) idToExternal.set(layer.id, layer.externalId);
      const visibility: Record<string, boolean> = {};
      for (const [layerId, visible] of Object.entries(visibilityByLayerId)) {
        const ext = idToExternal.get(layerId);
        if (ext) visibility[ext] = visible;
      }
      const id = await saveVariant({ puppetKey, name, description, visibility });
      await refresh();
      return id;
    },
    [puppetKey, refresh],
  );

  /**
   * Translate a stored variant back into a `Layer.id → boolean` map for
   * the current load. Returns `null` if the variant is unknown. Layers
   * present in the variant but absent from the live puppet are dropped
   * silently — that just means a sub-page mismatch, not an error.
   */
  const apply = useCallback(
    (id: VariantRowId, layers: ReadonlyArray<Layer>): Record<LayerId, boolean> | null => {
      const row = variants.find((v) => v.id === id);
      if (!row) return null;
      const externalToId = new Map<string, LayerId>();
      for (const layer of layers) externalToId.set(layer.externalId, layer.id);
      const out: Record<LayerId, boolean> = {};
      for (const [externalId, visible] of Object.entries(row.visibility)) {
        const layerId = externalToId.get(externalId);
        if (layerId) out[layerId] = visible;
      }
      return out;
    },
    [variants],
  );

  const rename = useCallback(
    async (id: VariantRowId, name: string): Promise<void> => {
      if (!puppetKey) return;
      await updateVariant(id, { name });
      await refresh();
    },
    [puppetKey, refresh],
  );

  const remove = useCallback(
    async (id: VariantRowId): Promise<void> => {
      if (!puppetKey) return;
      await deleteVariant(id);
      await refresh();
    },
    [puppetKey, refresh],
  );

  return {
    variants,
    loading,
    error,
    capture,
    apply,
    rename,
    remove,
    refresh,
  };
}
