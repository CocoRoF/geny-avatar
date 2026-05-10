"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadPuppetAnimationConfig,
  type PuppetAnimationConfigRow,
  savePuppetAnimationConfig,
} from "@/lib/persistence/db";

/** What the editor's Animation tab manipulates. Kept structurally
 *  identical to {@link PuppetAnimationConfigRow} minus `updatedAt` —
 *  the row is what we persist, the value is what the UI hands around. */
export type AnimationConfigValue = Omit<PuppetAnimationConfigRow, "puppetKey" | "updatedAt">;

const DEFAULTS: AnimationConfigValue = {
  display: {
    kScale: 0.7,
    initialXshift: 0,
    initialYshift: 0,
  },
  idleMotionGroupName: "",
  emotionMap: {},
  tapMotions: {},
};

const SAVE_DEBOUNCE_MS = 400;

export type UsePuppetAnimationConfigResult = {
  /** The current config. Always defined after `loading` flips to false;
   *  starts as DEFAULTS during initial IDB read. */
  config: AnimationConfigValue;
  /** True until the IDB read completes. AnimationPanel uses this to
   *  delay mounting the per-section components — they read their
   *  initial via a lazy `useState` initializer and won't refresh on
   *  prop change without a remount. */
  loading: boolean;
  /** Merge a partial update into the current config and schedule a
   *  debounced IDB write. Repeated calls within the debounce window
   *  collapse into a single save with the latest merged value. */
  update: (patch: Partial<AnimationConfigValue>) => void;
  /** Force-flush the pending debounced write — useful before "send to
   *  Geny" to make sure the latest values are on disk. */
  flush: () => Promise<void>;
};

/**
 * Phase 8.7 — single source of truth for a puppet's animation config.
 *
 * Loads from IDB on mount (or whenever puppetKey changes), exposes
 * the merged config + a debounced `update` for sections to call on
 * every slider tick / dropdown click. All four Animation tab sections
 * (display / motions / expressions / hit areas) bubble their changes
 * up through this hook, and 8.8's export reads via the same shape.
 *
 * `puppetKey === null` short-circuits — returns DEFAULTS, never reads
 * or writes IDB. Same disable convention as the other puppet-scoped
 * hooks (useReferences, useVariants, etc.).
 */
export function usePuppetAnimationConfig(puppetKey: string | null): UsePuppetAnimationConfigResult {
  const [config, setConfig] = useState<AnimationConfigValue>(DEFAULTS);
  const [loading, setLoading] = useState<boolean>(puppetKey != null);

  // Latest state in a ref so the debounced write always sees the most
  // recent merge — `setConfig` is async-ish and the timer fires in a
  // separate microtask.
  const configRef = useRef<AnimationConfigValue>(config);
  configRef.current = config;

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<Promise<void> | null>(null);

  // Initial load — re-runs when puppetKey changes (different puppet
  // edited in the same session, e.g. user navigates between two
  // tabs). Cancellation flag guards against state writes after a key
  // change races a slow read.
  useEffect(() => {
    if (puppetKey == null) {
      setConfig(DEFAULTS);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    loadPuppetAnimationConfig(puppetKey)
      .then((row) => {
        if (cancelled) return;
        if (row) {
          setConfig({
            display: row.display,
            idleMotionGroupName: row.idleMotionGroupName,
            emotionMap: row.emotionMap,
            tapMotions: row.tapMotions,
          });
        } else {
          setConfig(DEFAULTS);
        }
      })
      .catch((e: unknown) => {
        console.warn(`[animationConfig] load failed for ${puppetKey}`, e);
        if (!cancelled) setConfig(DEFAULTS);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [puppetKey]);

  const flush = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (pendingSaveRef.current) {
      await pendingSaveRef.current;
      return;
    }
    if (puppetKey == null) return;
    const promise = savePuppetAnimationConfig({
      puppetKey,
      ...configRef.current,
    });
    pendingSaveRef.current = promise;
    try {
      await promise;
    } finally {
      pendingSaveRef.current = null;
    }
  }, [puppetKey]);

  const update = useCallback(
    (patch: Partial<AnimationConfigValue>) => {
      setConfig((prev) => ({ ...prev, ...patch }));
      if (puppetKey == null) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        savePuppetAnimationConfig({
          puppetKey,
          ...configRef.current,
        }).catch((e) => {
          console.warn(`[animationConfig] save failed for ${puppetKey}`, e);
        });
      }, SAVE_DEBOUNCE_MS);
    },
    [puppetKey],
  );

  // Cleanup on unmount — fire any pending write so a freshly-changed
  // value isn't lost when the tab closes mid-debounce.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        if (puppetKey != null) {
          savePuppetAnimationConfig({ puppetKey, ...configRef.current }).catch(() => {
            /* swallow on unmount */
          });
        }
      }
    };
  }, [puppetKey]);

  return { config, loading, update, flush };
}
