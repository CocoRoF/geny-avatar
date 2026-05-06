/**
 * Adapter catalog. Two responsibilities:
 *
 *   1. Build an adapter for a given AdapterLoadInput (caller knows the kind).
 *   2. Detect the runtime from a file bundle and pick the right adapter
 *      (drag-drop upload flow).
 *
 * Stays a small module while we have two adapters; if a third runtime lands
 * (Inochi2D), a real registration / DI shape may be useful.
 */

import type { AdapterLoadInput, AvatarAdapter, FormatDetectionResult } from "./AvatarAdapter";
import { Live2DAdapter } from "./Live2DAdapter";
import { SpineAdapter } from "./SpineAdapter";

export type AdapterCtor = {
  new (): AvatarAdapter;
  detect(filenames: ReadonlyArray<string>): FormatDetectionResult | null;
};

const ADAPTERS: AdapterCtor[] = [SpineAdapter, Live2DAdapter];

export function createAdapter(input: AdapterLoadInput): AvatarAdapter {
  switch (input.kind) {
    case "spine":
      return new SpineAdapter();
    case "live2d":
      return new Live2DAdapter();
  }
}

/**
 * Run every adapter's detect() against a bundle of filenames; return the
 * highest-confidence hit.
 *
 * Used by the upload flow once it lands. Returns null when nothing matches —
 * caller can prompt the user.
 */
export function detectFromFilenames(
  filenames: ReadonlyArray<string>,
): { adapter: AdapterCtor; result: FormatDetectionResult } | null {
  let best: { adapter: AdapterCtor; result: FormatDetectionResult } | null = null;
  for (const adapter of ADAPTERS) {
    const result = adapter.detect(filenames);
    if (!result) continue;
    if (!best || (result.confidence === "high" && best.result.confidence !== "high")) {
      best = { adapter, result };
    }
  }
  return best;
}
