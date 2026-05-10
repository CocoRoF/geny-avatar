/**
 * Built-in sample puppets shipped with the app via the vendor submodule
 * (synced to /public/samples/ at predev/prebuild).
 *
 * Clicking one of these on the home page jumps straight to /edit/
 * builtin/<key> — no IndexedDB save, no upload step. Useful for first-
 * time visitors who don't have a puppet yet, and for development.
 */

import type { AdapterLoadInput } from "../adapters/AvatarAdapter";
import type { AvatarSourceRuntime } from "../avatar/types";
import { assetUrl } from "../basePath";

export type BuiltinSample = {
  /** stable url-safe key, used in /edit/builtin/<key> */
  key: string;
  /** display name */
  name: string;
  runtime: AvatarSourceRuntime;
  version?: string;
  /** short blurb shown on the home card */
  blurb: string;
  /** static URLs handed straight to the adapter (no blob URL juggling) */
  loadInput: AdapterLoadInput;
};

export const BUILTIN_SAMPLES: BuiltinSample[] = [
  {
    key: "hiyori",
    name: "Hiyori",
    runtime: "live2d",
    version: "Cubism 4",
    blurb: "Live2D 공식 샘플 — 24 parts, 9 idle motions",
    loadInput: {
      kind: "live2d",
      model3: assetUrl("/samples/hiyori/Hiyori.model3.json"),
    },
  },
  {
    key: "spineboy",
    name: "spineboy",
    runtime: "spine",
    version: "4.2",
    blurb: "Esoteric 공식 샘플 — 52 slots, 11 animations",
    loadInput: {
      kind: "spine",
      skeleton: assetUrl("/samples/spineboy/spineboy-pro.skel"),
      atlas: assetUrl("/samples/spineboy/spineboy-pma.atlas"),
      aliasPrefix: "builtin-spineboy",
    },
  },
];

export function findBuiltin(key: string): BuiltinSample | null {
  return BUILTIN_SAMPLES.find((s) => s.key === key) ?? null;
}
