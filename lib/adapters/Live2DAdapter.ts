import type { Container } from "pixi.js";
import { ID_PREFIX, newId } from "../avatar/id";
import type { Avatar, AvatarSource, Layer, LayerId, Parameter, RGBA } from "../avatar/types";
import type {
  AdapterCapabilities,
  AdapterLoadInput,
  AvatarAdapter,
  FormatDetectionResult,
} from "./AvatarAdapter";

const CAPABILITIES: AdapterCapabilities = {
  layerUnit: "part",
  canChangeMesh: false,
  canSwapTexture: true,
  // Part-level toggle is opacity-only. Drawable-level multiply-rgb tinting
  // becomes available once we expose Drawable as a layer unit (Phase 1.x).
  tinting: "opacity-only",
  hasAnimationTimeline: true,
  hasParameterGraph: true,
  hasPhysics: true,
};

/**
 * Wraps `untitled-pixi-live2d-engine`. The engine and Cubism Core are imported
 * lazily so non-Cubism pages don't pay the bundle cost.
 *
 * Cubism Core (Live2DCubismCore global) must be on window before load() runs.
 * The root layout injects it via <Script strategy="beforeInteractive" />.
 */
export class Live2DAdapter implements AvatarAdapter {
  readonly runtime = "live2d" as const;
  readonly capabilities = CAPABILITIES;

  // biome-ignore lint/suspicious/noExplicitAny: engine types live behind dynamic import
  private model: any = null;
  // biome-ignore lint/suspicious/noExplicitAny: engine internals
  private coreModel: any = null;
  private layerByPartIndex = new Map<number, Layer>();

  static detect(filenames: ReadonlyArray<string>): FormatDetectionResult | null {
    const lower = filenames.map((f) => f.toLowerCase());
    if (lower.some((f) => f.endsWith(".model3.json"))) {
      return { runtime: "live2d", version: "Cubism4+", confidence: "high" };
    }
    if (lower.some((f) => f.endsWith(".moc"))) {
      return { runtime: "live2d", version: "Cubism2/3", confidence: "low" };
    }
    return null;
  }

  async load(input: AdapterLoadInput): Promise<Avatar> {
    if (input.kind !== "live2d") {
      throw new Error(`Live2DAdapter cannot load input kind ${input.kind}`);
    }

    await this.waitForCubismCore();

    // /cubism sub-export = Cubism Modern (4/5) only — the combined default
    // bundle requires live2d.min.js (Cubism 2 legacy runtime) at startup,
    // which we don't ship. Cubism 2/3 best-effort would import /cubism-legacy.
    const { configureCubismSDK, Live2DModel } = await import("untitled-pixi-live2d-engine/cubism");
    configureCubismSDK({ memorySizeMB: 32 });

    const model = await Live2DModel.from(input.model3);
    this.model = model;

    // biome-ignore lint/suspicious/noExplicitAny: engine internals
    const internal = (model as any).internalModel;
    // biome-ignore lint/suspicious/noExplicitAny: engine internals
    const coreModel = internal?.coreModel as any;
    this.coreModel = coreModel;

    const layers: Layer[] = [];
    const parameters: Parameter[] = [];

    if (coreModel) {
      const partCount: number = coreModel.getPartCount?.() ?? 0;
      for (let i = 0; i < partCount; i++) {
        const externalId = coerceCubismId(coreModel.getPartId?.(i), `part_${i}`);
        const opacity: number = coreModel.getPartOpacity?.(i) ?? 1;
        const layer: Layer = {
          id: newId(ID_PREFIX.layer),
          externalId,
          name: externalId,
          geometry: "other",
          defaults: {
            visible: opacity > 0.01,
            color: { r: 1, g: 1, b: 1, a: 1 },
            opacity,
          },
        };
        layers.push(layer);
        this.layerByPartIndex.set(i, layer);
      }

      const paramCount: number = coreModel.getParameterCount?.() ?? 0;
      for (let i = 0; i < paramCount; i++) {
        const id = coerceCubismId(coreModel.getParameterId?.(i), `param_${i}`);
        const min: number = coreModel.getParameterMinimumValue?.(i) ?? 0;
        const max: number = coreModel.getParameterMaximumValue?.(i) ?? 1;
        const def: number = coreModel.getParameterDefaultValue?.(i) ?? 0;
        parameters.push({
          id,
          name: id,
          min,
          max,
          default: def,
          source: "live2d-param",
        });
      }
    }

    // motions are read off the manifest settings, not the core model
    const motionGroups: { group: string; files: { kind: "url"; url: string }[] }[] = [];
    const animationsRefs: Avatar["animations"] = [];
    // biome-ignore lint/suspicious/noExplicitAny: engine settings shape
    const settingsMotions = internal?.settings?.motions as any;
    if (settingsMotions) {
      for (const group of Object.keys(settingsMotions)) {
        const entries = settingsMotions[group] ?? [];
        const files = entries.map((e: { File: string }) => ({
          kind: "url" as const,
          url: e.File,
        }));
        motionGroups.push({ group, files });
        animationsRefs.push({
          name: group,
          loop: true,
          source: "live2d-motion",
          group,
        });
      }
    }

    const source: AvatarSource = {
      runtime: "live2d",
      model3: { kind: "url", url: input.model3 },
      moc3: { kind: "url", url: this.deriveSibling(input.model3, ".moc3") },
      textures: [],
      motions: motionGroups,
    };

    const now = Date.now();
    const avatar: Avatar = {
      id: newId(ID_PREFIX.avatar),
      name: this.deriveName(input.model3),
      source,
      layers,
      groups: [],
      variants: [],
      textures: [],
      animations: animationsRefs,
      parameters,
      metadata: { createdAt: now, updatedAt: now, schemaVersion: 1 },
    };
    return avatar;
  }

  getDisplayObject(): Container | null {
    return this.model;
  }

  setLayerVisibility(layerId: LayerId, visible: boolean): void {
    if (!this.coreModel?.setPartOpacity) return;
    for (const [index, layer] of this.layerByPartIndex.entries()) {
      if (layer.id === layerId) {
        this.coreModel.setPartOpacity(index, visible ? 1 : 0);
        return;
      }
    }
  }

  setLayerColor(layerId: LayerId, color: RGBA): void {
    // Part-level honors only alpha (capability: opacity-only).
    if (!this.coreModel?.setPartOpacity) return;
    for (const [index, layer] of this.layerByPartIndex.entries()) {
      if (layer.id === layerId) {
        this.coreModel.setPartOpacity(index, color.a);
        return;
      }
    }
  }

  playAnimation(name: string): void {
    if (!this.model) return;
    try {
      // engine exposes `motion(group, index?)` shorthand
      this.model.motion?.(name);
    } catch {
      // some engine builds spell it differently; surface in v1.x exploration
    }
  }

  setParameter(paramId: string, value: number): void {
    this.coreModel?.setParameterValueById?.(paramId, value);
  }

  getParameters(): Parameter[] {
    if (!this.coreModel) return [];
    const out: Parameter[] = [];
    const count: number = this.coreModel.getParameterCount?.() ?? 0;
    for (let i = 0; i < count; i++) {
      const id = coerceCubismId(this.coreModel.getParameterId?.(i), `param_${i}`);
      out.push({
        id,
        name: id,
        min: this.coreModel.getParameterMinimumValue?.(i) ?? 0,
        max: this.coreModel.getParameterMaximumValue?.(i) ?? 1,
        default: this.coreModel.getParameterDefaultValue?.(i) ?? 0,
        source: "live2d-param",
      });
    }
    return out;
  }

  destroy(): void {
    this.model?.destroy?.();
    this.model = null;
    this.coreModel = null;
    this.layerByPartIndex.clear();
  }

  // ----- helpers -----

  private async waitForCubismCore(timeoutMs = 5000): Promise<void> {
    const start = performance.now();
    while (performance.now() - start < timeoutMs) {
      // biome-ignore lint/suspicious/noExplicitAny: window global injected by Cubism Core script
      if (typeof (globalThis as any).Live2DCubismCore !== "undefined") return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(
      "Live2DCubismCore not available — /runtime/live2dcubismcore.min.js failed to load",
    );
  }

  private deriveName(url: string): string {
    const file = url.split("/").pop() ?? url;
    return file.replace(/\.model3\.json$/, "");
  }

  private deriveSibling(url: string, suffix: string): string {
    const base = url.replace(/\.model3\.json$/, "");
    return `${base}${suffix}`;
  }
}

/**
 * Cubism Core's getPartId / getParameterId returns CubismIdHandle objects
 * (`{ _id: string, getString(): string }`), not raw strings. The engine
 * accepts either when calling setParameterValueById, but storing the handle
 * in our domain model means React tries to render it as text and throws.
 *
 * Coerce to string at the adapter boundary.
 */
function coerceCubismId(value: unknown, fallback: string): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    // biome-ignore lint/suspicious/noExplicitAny: probing handle shape
    const v = value as any;
    if (typeof v.getString === "function") {
      const s = v.getString();
      if (typeof s === "string") return s;
    }
    if (typeof v._id === "string") return v._id;
    if (typeof v.id === "string") return v.id;
  }
  return fallback;
}
