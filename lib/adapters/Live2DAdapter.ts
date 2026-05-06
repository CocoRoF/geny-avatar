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

  /** part-index → forced opacity multiplier (0 = hide, 1 = show).
   *
   *  We can't rely on coreModel.setPartOpacity — motions write the part
   *  opacity through the parameter graph and overwrite our value on every
   *  model.update(). Instead we keep the multiplier here and apply it as
   *  a *post-update* mutation on the drawable opacities Float32Array, which
   *  motions don't touch directly.
   */
  private partOpacityOverrides = new Map<number, number>();
  /** part-index → list of drawable indices that should follow that part's
   *  override. Includes drawables under descendant parts (Cubism parts can
   *  nest), built once at load(). */
  private partToDrawables = new Map<number, number[]>();
  private rafHandle: number | null = null;

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

      // Build part → drawable mapping including descendants. Cubism parts
      // can nest, so a drawable under part X is also under any ancestor of X.
      //
      // We prefer the native model handle's typed-array fields when they're
      // exposed, falling back to the wrapper methods. Different Cubism
      // Framework versions / engine wrappers expose only one of the two,
      // and quietly returning -1 from a missing wrapper method silently
      // empties this map (the bug we're fixing here).
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
      const drawableCount: number = coreModel.getDrawableCount?.() ?? drawables?.count ?? 0;
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

      // One-shot diagnostic — if this prints "0 mapped" then no override
      // can ever take effect; the engine isn't exposing parent indices.
      if (typeof console !== "undefined") {
        console.info(
          `[Live2DAdapter] partToDrawables: ${this.partToDrawables.size} parts mapped (drawables=${drawableCount}, parts=${partCount}, native=${!!drawables})`,
        );
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
    const idx = this.findPartIndex(layerId);
    if (idx == null) return;
    if (visible) {
      // returning to default — no override needed; let the loop drain.
      this.partOpacityOverrides.delete(idx);
    } else {
      this.partOpacityOverrides.set(idx, 0);
      this.ensureOverrideLoop();
    }
  }

  setLayerColor(layerId: LayerId, color: RGBA): void {
    // Part-level honors only alpha (capability: opacity-only).
    const idx = this.findPartIndex(layerId);
    if (idx == null) return;
    if (color.a >= 1) {
      this.partOpacityOverrides.delete(idx);
    } else {
      this.partOpacityOverrides.set(idx, color.a);
      this.ensureOverrideLoop();
    }
  }

  /**
   * Bounding box of the model in its own world units. Useful for caller-side
   * fit-to-canvas math; the engine's Pixi-level width/height varies between
   * builds, so we stick to native Cubism units.
   */
  getNativeSize(): { width: number; height: number } | null {
    const internal = this.model?.internalModel;
    const size = internal?.layout ?? internal?.canvasInfo;
    if (!size) {
      // fall back to display object dims if exposed (pixi-live2d-display compat)
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
    if (this.rafHandle != null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
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

  /**
   * Start a RAF loop that re-applies our overrides on the *drawable* opacity
   * Float32Array. Why drawable, not part:
   *
   *   coreModel.setPartOpacity writes to the part-opacities array, which the
   *   next model.update() recomputes from parameters → motions overwrite our
   *   value every frame. Drawable opacities, by contrast, are computed at
   *   the very end of update() (parameters → parts → drawables) and aren't
   *   read again until render. Mutating that array post-update lets the
   *   render see our value without touching the parameter graph at all.
   *
   * Pixi's ticker registers its RAF first; we register ours later, so our
   * callback runs after model.update() has already filled drawable
   * opacities for the current frame.
   *
   * The loop self-stops when partOpacityOverrides empties, so toggling all
   * layers back to visible has zero ongoing cost.
   */
  private ensureOverrideLoop(): void {
    if (this.rafHandle != null) return;
    const tick = () => {
      if (this.partOpacityOverrides.size === 0) {
        this.rafHandle = null;
        return;
      }
      const cm = this.coreModel;
      // Prefer the native typed array on Live2DCubismCore.Model.drawables.
      // Wrapper methods (getDrawableOpacities) sometimes return a copy
      // instead of a view, which means our mutation is discarded.
      const drawables = getNativeDrawables(cm);
      const opacities: Float32Array | undefined =
        drawables?.opacities ?? cm?.getDrawableOpacities?.();
      if (opacities) {
        for (const [partIdx, multiplier] of this.partOpacityOverrides) {
          if (multiplier === 1) continue;
          const list = this.partToDrawables.get(partIdx);
          if (!list) continue;
          for (const d of list) {
            opacities[d] *= multiplier;
          }
        }
      } else if (cm?.setPartOpacity) {
        // last-ditch fallback for engine builds with neither the buffer
        // nor a typed-array view exposed.
        for (const [index, value] of this.partOpacityOverrides) {
          cm.setPartOpacity(index, value);
        }
      }
      this.rafHandle = requestAnimationFrame(tick);
    };
    this.rafHandle = requestAnimationFrame(tick);
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
 * Reach the native `Live2DCubismCore.Model.drawables` handle through a
 * Cubism Framework wrapper. Different engine versions / wrapper layers
 * expose the native handle at different paths; we probe each.
 *
 * Returns the object containing `opacities: Float32Array`,
 * `parentPartIndices: Int32Array`, etc. Mutating `opacities` is the only
 * reliable way to override Cubism's per-frame opacity computation
 * because it sits after the parameter→part→drawable propagation that
 * motions feed into.
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
    if (c) return c;
  }
  return null;
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
