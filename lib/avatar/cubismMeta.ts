"use client";

/**
 * Live2D Cubism manifest (model3.json) — types + parsing helpers.
 *
 * The runtime engine (untitled-pixi-live2d-engine) parses model3.json
 * internally but doesn't expose a stable typed view of it. The editor
 * Animation tab (Phase 8) needs to enumerate motion groups / motion
 * entries / expressions / hit areas to drive its UI, so we re-fetch
 * and re-parse the manifest with our own typing.
 *
 * The fetch is cheap — model3.json is ~1KB and the browser cache
 * services repeat reads for free.
 */

import { useEffect, useState } from "react";
import type { AvatarAdapter } from "@/lib/adapters/AvatarAdapter";
import type { Live2DAdapter } from "@/lib/adapters/Live2DAdapter";

/** One motion entry inside a motion group. `file` is relative to the
 *  manifest URL — resolve via `new URL(file, manifestUrl)` if you
 *  need an absolute URL for fetch / preview. */
export type CubismMotionEntry = {
  group: string;
  file: string;
  fadeInTime?: number;
  fadeOutTime?: number;
  /** Index within the group (`Motions[group][index]`) — what Geny's
   *  `tapMotions` and `emotionMotionMap` reference. */
  index: number;
};

export type CubismMotionGroup = {
  name: string;
  entries: CubismMotionEntry[];
};

export type CubismExpression = {
  name: string;
  file: string;
  /** Index in the model3.json's Expressions array — what Geny's
   *  emotionMap currently references. We surface NAME for the editor
   *  UI (stable across reorders) but keep INDEX for export
   *  compatibility (Phase 8.8 / schemaVersion 2). */
  index: number;
};

export type CubismHitArea = {
  name: string;
  /** Drawable / part id the hit area is anchored to. Editor doesn't
   *  use this directly but exporters / debuggers might. */
  id?: string;
};

export type CubismMeta = {
  motionGroups: CubismMotionGroup[];
  expressions: CubismExpression[];
  hitAreas: CubismHitArea[];
};

// ── Manifest type (only the bits we read) ────────────────────────────

type Model3Manifest = {
  Version?: number;
  FileReferences?: {
    Motions?: Record<string, Array<{ File: string; FadeInTime?: number; FadeOutTime?: number }>>;
    Expressions?: Array<{ Name: string; File: string }>;
  };
  HitAreas?: Array<{ Name: string; Id?: string }>;
};

const EMPTY: CubismMeta = { motionGroups: [], expressions: [], hitAreas: [] };

/** Pure parser — takes a parsed manifest object, returns our typed
 *  view. Defensive against missing sections (some puppets have no
 *  Expressions, no HitAreas). */
export function parseCubismManifest(raw: unknown): CubismMeta {
  if (!raw || typeof raw !== "object") return EMPTY;
  const m = raw as Model3Manifest;

  const motionGroups: CubismMotionGroup[] = [];
  const motions = m.FileReferences?.Motions ?? {};
  for (const [group, entries] of Object.entries(motions)) {
    motionGroups.push({
      name: group,
      entries: (entries ?? []).map((e, index) => ({
        group,
        file: e.File,
        fadeInTime: e.FadeInTime,
        fadeOutTime: e.FadeOutTime,
        index,
      })),
    });
  }

  const expressions: CubismExpression[] = (m.FileReferences?.Expressions ?? []).map((e, index) => ({
    name: e.Name,
    file: e.File,
    index,
  }));

  const hitAreas: CubismHitArea[] = (m.HitAreas ?? []).map((h) => ({
    name: h.Name,
    id: h.Id,
  }));

  return { motionGroups, expressions, hitAreas };
}

/** Fetch + parse a model3.json from a URL. Errors throw — callers
 *  (the hook below) catch and surface as state. */
export async function fetchCubismMeta(manifestUrl: string): Promise<CubismMeta> {
  const res = await fetch(manifestUrl);
  if (!res.ok) {
    throw new Error(`manifest fetch ${res.status}: ${manifestUrl}`);
  }
  const raw = await res.json();
  return parseCubismManifest(raw);
}

// ── Hook ────────────────────────────────────────────────────────────

export type UseCubismMetaResult = {
  meta: CubismMeta | null;
  loading: boolean;
  error: string | null;
};

/**
 * Read motion / expression / hit-area metadata from the adapter's
 * current model3.json. Returns `meta = null` while still loading or
 * when the adapter is non-Live2D (Spine / null). Refetches when the
 * adapter's manifest URL changes (i.e. user switches puppet).
 */
export function useCubismMeta(adapter: AvatarAdapter | null): UseCubismMetaResult {
  const [meta, setMeta] = useState<CubismMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pull the manifest URL up-front so the effect's dep is a primitive.
  // For non-Live2D adapters or pre-load state, this is null and we
  // skip the fetch entirely.
  const manifestUrl =
    adapter && adapter.runtime === "live2d"
      ? (adapter as Live2DAdapter).getModelManifestUrl()
      : null;

  useEffect(() => {
    if (!manifestUrl) {
      setMeta(null);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchCubismMeta(manifestUrl)
      .then((m) => {
        if (cancelled) return;
        setMeta(m);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [manifestUrl]);

  return { meta, loading, error };
}
