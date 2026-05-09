"use client";

import { useCallback, useEffect, useState } from "react";
import {
  deleteReference,
  listReferencesForPuppet,
  type ReferenceRow,
  type ReferenceRowId,
  saveReference,
} from "../persistence/db";

/**
 * Per-puppet character / style reference images, persisted in IndexedDB
 * (`puppetReferences` table, v7). At generate time these blobs ride
 * along as additional `image[]` entries on gpt-image-2's
 * `/v1/images/edits` request — that's the cloud-API equivalent of an
 * IP-Adapter character anchor, and it's what lets multiple layer
 * regenerations stay tonally consistent without a custom LoRA.
 *
 * The hook follows the same shape as `useVariants` — list + actions +
 * `null` puppetKey disables persistence (used while /poc/upload is
 * still pre-autoSave). Only Sprint 5.1's CRUD is here; the actual
 * generate-time wiring lands in 5.2.
 */
export function useReferences(puppetKey: string | null) {
  const [references, setReferences] = useState<ReferenceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!puppetKey) {
      setReferences([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const rows = await listReferencesForPuppet(puppetKey);
      setReferences(rows);
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
        setReferences([]);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const rows = await listReferencesForPuppet(puppetKey);
        if (!cancelled) setReferences(rows);
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

  const upload = useCallback(
    async (file: File): Promise<ReferenceRowId | null> => {
      if (!puppetKey) return null;
      const id = await saveReference({
        puppetKey,
        name: file.name,
        blob: file,
      });
      await refresh();
      return id;
    },
    [puppetKey, refresh],
  );

  const remove = useCallback(
    async (id: ReferenceRowId): Promise<void> => {
      if (!puppetKey) return;
      await deleteReference(id);
      await refresh();
    },
    [puppetKey, refresh],
  );

  return {
    references,
    loading,
    error,
    upload,
    remove,
    refresh,
  };
}
