/**
 * Runtime adapter — bridges a specific 2D rigging runtime (Spine, Live2D
 * Cubism) to our domain model + Pixi display tree.
 *
 * Both adapters implement the same surface, but capability flags expose
 * the asymmetries (e.g. Cubism has parameter graphs, Spine has skin
 * attachments). UI checks capabilities before showing a control.
 *
 * Reference: docs/plan/02_architecture.md (D4) and
 *            docs/plan/04_data_model.md
 */

import type { Container } from "pixi.js";
import type {
  Avatar,
  AvatarSourceRuntime,
  LayerId,
  Parameter,
  RGBA,
  TextureId,
} from "../avatar/types";

/**
 * Drawable image + dimensions for a texture page. Used by the layer
 * thumbnail pipeline to crop region rects out of the atlas. The image
 * is anything that can be passed to `CanvasRenderingContext2D.drawImage`.
 */
export type TextureSourceInfo = {
  image: CanvasImageSource;
  width: number;
  height: number;
};

// ----- capability flags -----

export type Tinting = "rgba" | "multiply-rgb" | "opacity-only";

export type AdapterCapabilities = {
  layerUnit: "slot" | "drawable" | "part";
  canChangeMesh: boolean;
  canSwapTexture: boolean;
  tinting: Tinting;
  hasAnimationTimeline: boolean;
  hasParameterGraph: boolean;
  hasPhysics: boolean;
};

// ----- detection / loading -----

export type FormatDetectionResult = {
  runtime: AvatarSourceRuntime;
  version?: string;
  /** "high" = magic-byte / manifest-confirmed; "low" = filename heuristic only */
  confidence: "high" | "low";
};

/**
 * Inputs for adapter loading. Callers can pass live URL paths (e.g. PoC
 * pages with assets in /public) or in-memory blob URLs once drag-drop
 * upload is wired (Phase 1.x).
 */
export type AdapterLoadInput =
  | {
      kind: "spine";
      skeleton: string; // url
      atlas: string; // url
      /** optional override for the asset alias prefix used in Pixi Assets cache */
      aliasPrefix?: string;
    }
  | {
      kind: "live2d";
      model3: string; // url to *.model3.json
    };

// ----- the interface -----

export interface AvatarAdapter {
  /** runtime kind — used for capability dispatch in UI */
  readonly runtime: AvatarSourceRuntime;
  readonly capabilities: AdapterCapabilities;

  /**
   * Load the puppet from URLs / blobs, build the underlying runtime object,
   * and return an Avatar snapshot in our domain shape (no rendering yet —
   * caller mounts the Pixi object via getDisplayObject after this).
   */
  load(input: AdapterLoadInput): Promise<Avatar>;

  /** the Pixi display object representing the loaded puppet — null before load */
  getDisplayObject(): Container | null;

  /** show / hide one logical layer */
  setLayerVisibility(layerId: LayerId, visible: boolean): void;

  /**
   * tint a layer. The semantics follow capabilities.tinting:
   *  - "rgba": full RGBA multiply
   *  - "multiply-rgb": RGB only (alpha ignored)
   *  - "opacity-only": only color.a is honored, RGB ignored
   */
  setLayerColor(layerId: LayerId, color: RGBA): void;

  /** start an animation by name (Spine track 0 / Live2D motion group) */
  playAnimation(name: string): void;

  /** set a parameter (no-op if !capabilities.hasParameterGraph) */
  setParameter(paramId: string, value: number): void;

  /** read parameters — empty for runtimes without a parameter graph */
  getParameters(): Parameter[];

  /**
   * Bitmap source for a texture page referenced by `Avatar.textures`. The
   * layers panel uses this to crop region thumbnails. Returns null if the
   * adapter doesn't know about that id (e.g. Cubism build that hasn't
   * wired UV bbox extraction yet).
   */
  getTextureSource(textureId: TextureId): TextureSourceInfo | null;

  /** tear down the runtime object so callers can recycle the Pixi Application */
  destroy(): void;
}
