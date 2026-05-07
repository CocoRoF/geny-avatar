"use client";

import { useEffect, useRef } from "react";
import {
  deleteLayerOverride,
  getPuppetSession,
  listLayerOverridesForPuppet,
  saveLayerOverride,
  savePuppetSession,
} from "../persistence/db";
import { useEditorStore } from "../store/editor";
import type { Layer, LayerId } from "./types";

/**
 * Bridge between the editor store's `layerMasks` / `layerTextureOverrides`
 * (Layer.id-keyed, in-memory) and the IDB `layerOverrides` table
 * (layerExternalId-keyed, persistent). One hook per edit page wires:
 *
 *   1. **Hydrate on mount** — when `puppetKey` + `layers` are both ready,
 *      read both override kinds out of IDB, translate externalId → Layer.id
 *      via the live layer list, and inject into the store.
 *   2. **Persist on change** — diff the store maps against the prior
 *      tick; for each add / replace / delete, write to or remove from
 *      IDB. Skipped while we're still hydrating so the very first
 *      `setLayerMask` (the hydrate itself) doesn't loop back as
 *      another save.
 *
 * Builtin samples (`puppetKey === "builtin:..."`) and pre-autoSave
 * uploads (`puppetKey === null`) are valid: hydrate is a no-op and
 * write goes to a real key as soon as one is supplied.
 */
export function useLayerOverridesPersistence(
  puppetKey: string | null,
  layers: ReadonlyArray<Layer>,
) {
  const setLayerMask = useEditorStore((s) => s.setLayerMask);
  const setLayerTextureOverride = useEditorStore((s) => s.setLayerTextureOverride);
  const applyVisibilityMapState = useEditorStore((s) => s.applyVisibilityMap);

  // Track "did we finish hydrating for the current puppetKey" so the
  // post-hydrate change subscriber doesn't echo IDB writes back as
  // duplicate saves on the first paint.
  const hydratedKeyRef = useRef<string | null>(null);
  // Snapshots of the maps the LAST time we wrote to IDB. Used to diff.
  const masksRef = useRef<Record<LayerId, Blob>>({});
  const texturesRef = useRef<Record<LayerId, Blob>>({});
  const visibilityRef = useRef<Record<LayerId, boolean>>({});

  // ----- hydrate -----
  useEffect(() => {
    if (!puppetKey || layers.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const externalToId = new Map<string, LayerId>();
        for (const layer of layers) externalToId.set(layer.externalId, layer.id);

        const [maskRows, texRows, sessionRow] = await Promise.all([
          listLayerOverridesForPuppet(puppetKey, "mask"),
          listLayerOverridesForPuppet(puppetKey, "texture"),
          getPuppetSession(puppetKey),
        ]);
        if (cancelled) return;

        const masks: Record<LayerId, Blob> = {};
        const textures: Record<LayerId, Blob> = {};
        for (const row of maskRows) {
          const layerId = externalToId.get(row.layerExternalId);
          if (layerId) masks[layerId] = row.blob;
        }
        for (const row of texRows) {
          const layerId = externalToId.get(row.layerExternalId);
          if (layerId) textures[layerId] = row.blob;
        }

        // Apply each entry through the store action so reactive
        // selectors notice. setLayerMask(null) clears, setLayerMask(blob)
        // sets — the hook never deletes during hydrate.
        for (const [id, blob] of Object.entries(masks)) setLayerMask(id, blob);
        for (const [id, blob] of Object.entries(textures)) setLayerTextureOverride(id, blob);

        // Visibility: translate externalId-keyed map back to Layer.id and
        // apply through the store. Goes through history because we want
        // undo to reach back to the post-load default.
        const visibility: Record<LayerId, boolean> = {};
        if (sessionRow?.visibility) {
          for (const [externalId, visible] of Object.entries(sessionRow.visibility)) {
            const layerId = externalToId.get(externalId);
            if (layerId) visibility[layerId] = visible;
          }
          if (Object.keys(visibility).length > 0) {
            applyVisibilityMapState(visibility);
          }
        }

        masksRef.current = { ...masks };
        texturesRef.current = { ...textures };
        visibilityRef.current = { ...useEditorStore.getState().visibilityOverrides };
        hydratedKeyRef.current = puppetKey;
        if (maskRows.length + texRows.length + Object.keys(visibility).length > 0) {
          console.info(
            `[overridesPersist] hydrated puppet=${puppetKey.slice(-6)} masks=${maskRows.length} textures=${texRows.length} visibility=${Object.keys(visibility).length}`,
          );
        }
      } catch (e) {
        console.warn("[overridesPersist] hydrate failed", e);
      }
    })();
    return () => {
      cancelled = true;
      // Reset snapshot on key change so the next hydrate isn't diffed
      // against the previous puppet's maps.
      hydratedKeyRef.current = null;
      masksRef.current = {};
      texturesRef.current = {};
    };
  }, [puppetKey, layers, setLayerMask, setLayerTextureOverride, applyVisibilityMapState]);

  // ----- persist on change -----
  useEffect(() => {
    if (!puppetKey) return;

    const idToExternal = new Map<LayerId, string>();
    for (const layer of layers) idToExternal.set(layer.id, layer.externalId);

    return useEditorStore.subscribe((state, prev) => {
      // Skip writes until hydrate has finished applying its own
      // setLayerMask calls — those would otherwise look like new
      // mutations and bounce back to IDB.
      if (hydratedKeyRef.current !== puppetKey) return;

      diffAndPersist({
        kind: "mask",
        puppetKey,
        nextMap: state.layerMasks,
        prevMap: masksRef.current,
        idToExternal,
      });
      diffAndPersist({
        kind: "texture",
        puppetKey,
        nextMap: state.layerTextureOverrides,
        prevMap: texturesRef.current,
        idToExternal,
      });
      masksRef.current = { ...state.layerMasks };
      texturesRef.current = { ...state.layerTextureOverrides };

      // Visibility: persist the whole map as a single row whenever it
      // differs from the snapshot. Cheap (<1KB) so no debounce. The
      // visibility map is keyed by Layer.id; we translate to externalId
      // before saving so the row survives reloads.
      if (state.visibilityOverrides !== visibilityRef.current) {
        const visibility: Record<string, boolean> = {};
        for (const [layerId, visible] of Object.entries(state.visibilityOverrides)) {
          const ext = idToExternal.get(layerId);
          if (ext) visibility[ext] = visible;
        }
        void savePuppetSession({ puppetKey, visibility }).catch((e) =>
          console.warn("[overridesPersist] visibility save failed", e),
        );
        visibilityRef.current = { ...state.visibilityOverrides };
      }

      // Touch `prev` to satisfy the subscribe signature without using
      // it — we already do our own diff against the ref snapshots.
      void prev;
    });
  }, [puppetKey, layers]);
}

function diffAndPersist(input: {
  kind: "mask" | "texture";
  puppetKey: string;
  nextMap: Record<LayerId, Blob>;
  prevMap: Record<LayerId, Blob>;
  idToExternal: Map<LayerId, string>;
}): void {
  const { kind, puppetKey, nextMap, prevMap, idToExternal } = input;

  for (const [layerId, blob] of Object.entries(nextMap)) {
    if (prevMap[layerId] === blob) continue;
    const ext = idToExternal.get(layerId);
    if (!ext) continue;
    void saveLayerOverride({ puppetKey, layerExternalId: ext, kind, blob }).catch((e) =>
      console.warn(`[overridesPersist] save ${kind} failed for ${ext}`, e),
    );
  }
  for (const layerId of Object.keys(prevMap)) {
    if (nextMap[layerId] !== undefined) continue;
    const ext = idToExternal.get(layerId);
    if (!ext) continue;
    void deleteLayerOverride(puppetKey, ext, kind).catch((e) =>
      console.warn(`[overridesPersist] delete ${kind} failed for ${ext}`, e),
    );
  }
}
