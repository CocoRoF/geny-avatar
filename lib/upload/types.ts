/**
 * Drag-drop upload types — what the parser produces from a dropped file
 * (or set of files / a ZIP), and what the adapter wants to consume.
 */

import type { AdapterLoadInput, FormatDetectionResult } from "../adapters/AvatarAdapter";

/**
 * One file inside a dropped bundle. `path` is what the bundle's manifest
 * (Spine atlas, Cubism model3.json) will use to refer to it — relative,
 * forward-slash, lowercased lookups handled by the parser. `url` is a
 * blob URL ready for the adapter / Pixi Assets to fetch from.
 */
export type BundleEntry = {
  /** filename only, e.g. "Hiyori.moc3" */
  name: string;
  /** path inside the bundle (folder/file.ext); equals name if flat */
  path: string;
  /** size in bytes (for diagnostics) */
  size: number;
  /** lazily-created blob URL — created on first access via getURL() */
  blob: Blob;
};

/**
 * Final result of parseBundle. The caller hands `loadInput` straight to
 * `createAdapter(loadInput).load(loadInput)`.
 */
export type ParsedBundle =
  | {
      ok: true;
      detection: FormatDetectionResult;
      /**
       * Ready-to-pass adapter input. URLs inside are blob: URLs for the
       * primary entry files (skeleton+atlas for Spine, model3 for
       * Live2D). Sibling assets live in `entries`.
       */
      loadInput: AdapterLoadInput;
      /** All files in the bundle, keyed by lowercased path. */
      entries: Map<string, BundleEntry>;
      /** All blob URLs the parser created — caller revokes them on unmount. */
      urls: string[];
      /** Non-fatal warnings (missing referenced files, ambiguous detection). */
      warnings: string[];
    }
  | {
      ok: false;
      reason: string;
      entries: Map<string, BundleEntry>;
      /** Detection result if we got that far, otherwise null. */
      detection: FormatDetectionResult | null;
    };
