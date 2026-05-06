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
  tinting: "opacity-only",
  hasAnimationTimeline: true,
  hasParameterGraph: true,
  hasPhysics: true,
};

/**
 * Wraps `untitled-pixi-live2d-engine`. Cubism Core (loaded via the layout
 * script tag) must be on window before load() runs.
 *
 * Layer (part) overrides are enforced through two channels — both applied
 * inside the engine's `beforeModelUpdate` event so motion can't overwrite
 * them later in the same frame:
 *
 *   1. coreModel.setPartOpacity(idx, value) — feeds the propagation step
 *   2. drawables.opacities[d] *= multiplier — direct render-input mutation
 *
 * Some Cubism models bind drawable opacity to parameters rather than parts,
 * so setPartOpacity alone has no visible effect on those models. The
 * drawable mutation is a robust fallback for that case.
 */
export class Live2DAdapter implements AvatarAdapter {
  readonly runtime = "live2d" as const;
  readonly capabilities = CAPABILITIES;

  // biome-ignore lint/suspicious/noExplicitAny: engine types live behind dynamic import
  private model: any = null;
  // biome-ignore lint/suspicious/noExplicitAny: engine internals
  private coreModel: any = null;
  private layerByPartIndex = new Map<number, Layer>();

  /** part-index → opacity multiplier (0 = hide, 1 = show). 1.0 means "no
   *  override needed", so we delete instead of storing 1. */
  private partOpacityOverrides = new Map<number, number>();
  /** part-index → drawable indices that should follow the part's override.
   *  Includes drawables under descendant parts (Cubism part trees nest). */
  private partToDrawables = new Map<number, number[]>();
  /** Cached so destroy() can off() the listener. */
  private beforeModelUpdateHandler: (() => void) | null = null;

  // diagnostic counters (one-shot logs to keep console quiet after first frame)
  private _hookFireCount = 0;
  private _loggedSetCheck = false;
  private _loggedDrawableMutate = false;

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
    let partCount = 0;
    let drawableCount = 0;

    if (coreModel) {
      partCount = coreModel.getPartCount?.() ?? 0;
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

      // Build part → drawable map (incl. ancestors). Used by the drawable
      // fallback inside the beforeModelUpdate hook.
      const drawables = getNativeDrawables(coreModel);
      const parts = getNativeParts(coreModel);
      const partParent = (i: number): number => {
        const v = parts?.parentIndices?.[i];
        if (typeof v === "number") return v;
        const m = coreModel.getPartParentPartIndex?.(i);
        return typeof m === "number" ? m : -1;
      };
      const drawableParent = (d: number): number => {
        const v = drawables?.parentPartIndices?.[d];
        if (typeof v === "number") return v;
        const m = coreModel.getDrawableParentPartIndex?.(d);
        return typeof m === "number" ? m : -1;
      };
      const ancestorChains: number[][] = [];
      for (let i = 0; i < partCount; i++) {
        const chain: number[] = [i];
        let p = partParent(i);
        for (let depth = 0; p >= 0 && depth < 64; depth++) {
          chain.push(p);
          p = partParent(p);
        }
        ancestorChains.push(chain);
      }
      drawableCount = coreModel.getDrawableCount?.() ?? drawables?.count ?? 0;
      for (let d = 0; d < drawableCount; d++) {
        const directPart = drawableParent(d);
        if (directPart < 0) continue;
        const chain = ancestorChains[directPart] ?? [directPart];
        for (const partIdx of chain) {
          let arr = this.partToDrawables.get(partIdx);
          if (!arr) {
            arr = [];
            this.partToDrawables.set(partIdx, arr);
          }
          arr.push(d);
        }
      }

      const paramCount: number = coreModel.getParameterCount?.() ?? 0;
      for (let i = 0; i < paramCount; i++) {
        const id = coerceCubismId(coreModel.getParameterId?.(i), `param_${i}`);
        parameters.push({
          id,
          name: id,
          min: coreModel.getParameterMinimumValue?.(i) ?? 0,
          max: coreModel.getParameterMaximumValue?.(i) ?? 1,
          default: coreModel.getParameterDefaultValue?.(i) ?? 0,
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
        animationsRefs.push({ name: group, loop: true, source: "live2d-motion", group });
      }
    }

    // ----- per-frame override hook -----
    if (internal && typeof internal.on === "function") {
      this.beforeModelUpdateHandler = () => this.applyOverridesInsideHook();
      internal.on("beforeModelUpdate", this.beforeModelUpdateHandler);
      console.info(
        `[Live2DAdapter] hooked beforeModelUpdate · parts=${partCount} drawables=${drawableCount} partsMapped=${this.partToDrawables.size} nativeDrawables=${!!getNativeDrawables(coreModel)} hasSetPartOpacity=${typeof coreModel?.setPartOpacity === "function"}`,
      );
    } else {
      console.error("[Live2DAdapter] internalModel.on() not available — overrides will not apply");
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

  /**
   * Runs every frame inside the engine's beforeModelUpdate event. This is
   * the only point in the per-frame cycle where motion has finished writing
   * parameters but the propagation that turns them into drawable state
   * hasn't run yet, so anything we do here either feeds the propagation
   * (setPartOpacity) or sits where the renderer reads it (drawable opacity
   * Float32Array).
   */
  private applyOverridesInsideHook(): void {
    this._hookFireCount++;
    const cm = this.coreModel;
    if (!cm) return;
    if (this.partOpacityOverrides.size === 0) return;

    if (this._hookFireCount === 1 || this._hookFireCount % 120 === 0) {
      console.log(
        `[Live2DAdapter] hook fire #${this._hookFireCount}, applying ${this.partOpacityOverrides.size} overrides`,
      );
    }

    // Channel 1 — setPartOpacity (Cubism's intended way; works for models
    // whose part has direct drawable bindings, ignored by models that bind
    // drawable opacity to parameters instead).
    if (cm.setPartOpacity) {
      for (const [partIdx, value] of this.partOpacityOverrides) {
        cm.setPartOpacity(partIdx, value);
      }

      if (!this._loggedSetCheck && cm.getPartOpacity) {
        const first = this.partOpacityOverrides.entries().next().value;
        if (first) {
          const [idx, want] = first;
          const got = cm.getPartOpacity(idx);
          console.log(
            `[Live2DAdapter] setPartOpacity verify part[${idx}]: want=${want}, read-back=${got}`,
          );
          this._loggedSetCheck = true;
        }
      }
    }

    // Channel 2 — direct drawable opacity mutation, by far the most reliable
    // because it sits between propagation (which we hooked just before) and
    // render. For models that ignore part opacity, this is the path that
    // actually hides anything.
    const drawables = getNativeDrawables(cm);
    const opacities: Float32Array | undefined = drawables?.opacities;
    if (opacities) {
      for (const [partIdx, multiplier] of this.partOpacityOverrides) {
        if (multiplier === 1) continue;
        const list = this.partToDrawables.get(partIdx);
        if (!list) continue;
        for (const d of list) {
          opacities[d] *= multiplier;
        }
      }

      if (!this._loggedDrawableMutate) {
        const first = this.partOpacityOverrides.entries().next().value;
        if (first) {
          const [idx] = first;
          const list = this.partToDrawables.get(idx) ?? [];
          const sample = list[0];
          if (typeof sample === "number") {
            console.log(
              `[Live2DAdapter] drawable mutate verify: part[${idx}] → drawable[${sample}] opacity now=${opacities[sample]}`,
            );
            this._loggedDrawableMutate = true;
          }
        }
      }
    }
  }

  getDisplayObject(): Container | null {
    return this.model;
  }

  setLayerVisibility(layerId: LayerId, visible: boolean): void {
    const idx = this.findPartIndex(layerId);
    console.log(`[Live2DAdapter] setLayerVisibility(${layerId}, ${visible}) → partIdx=${idx}`);
    if (idx == null) return;
    if (visible) {
      this.partOpacityOverrides.delete(idx);
    } else {
      this.partOpacityOverrides.set(idx, 0);
    }
    // synchronous one-shot so we don't have to wait a tick for first feedback
    this.coreModel?.setPartOpacity?.(idx, visible ? 1 : 0);
  }

  setLayerColor(layerId: LayerId, color: RGBA): void {
    const idx = this.findPartIndex(layerId);
    if (idx == null) return;
    if (color.a >= 1) {
      this.partOpacityOverrides.delete(idx);
    } else {
      this.partOpacityOverrides.set(idx, color.a);
    }
    this.coreModel?.setPartOpacity?.(idx, color.a);
  }

  /**
   * Native canvas size (Cubism units). Used by the page for fit-to-canvas.
   */
  getNativeSize(): { width: number; height: number } | null {
    const internal = this.model?.internalModel;
    const size = internal?.layout ?? internal?.canvasInfo;
    if (!size) {
      // biome-ignore lint/suspicious/noExplicitAny: engine display surface
      const m = this.model as any;
      if (typeof m?.width === "number" && typeof m?.height === "number") {
        return { width: m.width, height: m.height };
      }
      return null;
    }
    return {
      width: size.width ?? size.canvasWidth ?? 1,
      height: size.height ?? size.canvasHeight ?? 1,
    };
  }

  playAnimation(name: string): void {
    if (!this.model) return;
    try {
      this.model.motion?.(name);
    } catch {
      // some engine builds spell it differently; surface during exploration
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
    if (this.beforeModelUpdateHandler) {
      const internal = this.model?.internalModel;
      if (internal && typeof internal.off === "function") {
        internal.off("beforeModelUpdate", this.beforeModelUpdateHandler);
      }
      this.beforeModelUpdateHandler = null;
    }
    this.partOpacityOverrides.clear();
    this.partToDrawables.clear();
    this.model?.destroy?.();
    this.model = null;
    this.coreModel = null;
    this.layerByPartIndex.clear();
  }

  // ----- helpers -----

  private findPartIndex(layerId: LayerId): number | null {
    for (const [index, layer] of this.layerByPartIndex.entries()) {
      if (layer.id === layerId) return index;
    }
    return null;
  }

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
 * Reach the native Live2DCubismCore.Model.drawables handle through Cubism
 * Framework wrappers. The native handle has typed-array fields (opacities,
 * parentPartIndices, dynamicFlags) that we mutate directly.
 */
// biome-ignore lint/suspicious/noExplicitAny: probing engine internals
function getNativeDrawables(coreModel: any): any | null {
  if (!coreModel) return null;
  const candidates = [
    coreModel._model?.drawables,
    coreModel.model?.drawables,
    coreModel._coreModel?._model?.drawables,
    coreModel.drawables,
  ];
  for (const c of candidates) {
    if (c?.opacities) return c;
  }
  return null;
}

// biome-ignore lint/suspicious/noExplicitAny: probing engine internals
function getNativeParts(coreModel: any): any | null {
  if (!coreModel) return null;
  const candidates = [
    coreModel._model?.parts,
    coreModel.model?.parts,
    coreModel._coreModel?._model?.parts,
    coreModel.parts,
  ];
  for (const c of candidates) {
    if (c?.parentIndices) return c;
  }
  return null;
}

/**
 * Cubism Core's getPartId / getParameterId returns CubismIdHandle objects
 * (`{ _id, getString() }`). We coerce to a plain string at the boundary so
 * React can render the layer name without throwing.
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
