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
import type { Layer, LayerId, NativeVariant, NativeVariantSource, VariantApplyData } from "./types";

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
   * Capture the current visible state as a new variant. `visibility` is
   * keyed by `Layer.id`; we translate to `Layer.externalId` via `layers`
   * before persisting so the variant survives reloads. `applyData`
   * (from `adapter.getActiveVariantData()`) is recorded so the row
   * remembers e.g. which Spine skin was active at capture time.
   */
  const capture = useCallback(
    async (
      name: string,
      visibilityByLayerId: Record<LayerId, boolean>,
      layers: ReadonlyArray<Layer>,
      opts?: {
        description?: string;
        applyData?: VariantApplyData;
      },
    ): Promise<VariantRowId | null> => {
      if (!puppetKey) return null;
      const idToExternal = new Map<LayerId, string>();
      for (const layer of layers) idToExternal.set(layer.id, layer.externalId);
      const visibility: Record<string, boolean> = {};
      for (const [layerId, visible] of Object.entries(visibilityByLayerId)) {
        const ext = idToExternal.get(layerId);
        if (ext) visibility[ext] = visible;
      }
      const id = await saveVariant({
        puppetKey,
        name,
        description: opts?.description,
        visibility,
        applyData: opts?.applyData,
        source: "user",
      });
      await refresh();
      return id;
    },
    [puppetKey, refresh],
  );

  /**
   * Persist a runtime-native preset (Spine Skin, Cubism group) as an
   * IDB variant so the user can rename / delete it like any other
   * captured row. No-op if a row with the same `(source, sourceExternalId)`
   * already exists for this puppet — re-import is a click-through.
   */
  const importNative = useCallback(
    async (native: NativeVariant): Promise<VariantRowId | null> => {
      if (!puppetKey) return null;
      const existing = variants.find(
        (v) => v.source === native.source && v.sourceExternalId === native.externalId,
      );
      if (existing) return existing.id;
      const id = await saveVariant({
        puppetKey,
        name: native.name,
        description: native.description,
        visibility: {},
        applyData: native.applyData,
        source: native.source,
        sourceExternalId: native.externalId,
      });
      await refresh();
      return id;
    },
    [puppetKey, refresh, variants],
  );

  /**
   * Translate a stored variant into the bundle a caller needs to apply
   * it: the visibility map keyed by current `Layer.id` plus the runtime
   * `applyData` to push through `adapter.applyVariantData`. Returns
   * `null` if the variant is unknown. Layers present in the variant but
   * absent from the live puppet are dropped silently — usually a
   * page-suffix mismatch on multi-page Cubism parts, not an error.
   */
  const apply = useCallback(
    (
      id: VariantRowId,
      layers: ReadonlyArray<Layer>,
    ): { visibility: Record<LayerId, boolean>; applyData: VariantApplyData } | null => {
      const row = variants.find((v) => v.id === id);
      if (!row) return null;
      const externalToId = new Map<string, LayerId>();
      for (const layer of layers) externalToId.set(layer.externalId, layer.id);
      const visibility: Record<LayerId, boolean> = {};
      for (const [externalId, visible] of Object.entries(row.visibility)) {
        const layerId = externalToId.get(externalId);
        if (layerId) visibility[layerId] = visible;
      }
      return { visibility, applyData: row.applyData ?? {} };
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
    importNative,
    apply,
    rename,
    remove,
    refresh,
  };
}

/**
 * Native variants the user hasn't imported yet. Filters out anything
 * already represented in `variants` by `(source, sourceExternalId)`.
 */
export function filterUnimportedNativeVariants(
  natives: ReadonlyArray<NativeVariant>,
  variants: ReadonlyArray<VariantRow>,
): NativeVariant[] {
  const importedKeys = new Set<string>();
  for (const v of variants) {
    if (v.source !== "user" && v.sourceExternalId) {
      importedKeys.add(`${v.source}\0${v.sourceExternalId}`);
    }
  }
  return natives.filter(
    (n) => !importedKeys.has(`${n.source as NativeVariantSource}\0${n.externalId}`),
  );
}
