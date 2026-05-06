import { Assets, type Container } from "pixi.js";
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
 * Layer (part) overrides hide drawables by mutating
 * `coreModel._model.drawables.opacities` (the Float32Array view that the
 * renderer reads) *after* the engine's per-frame update completes — that's
 * the only window where motion + parameter→drawable propagation are done
 * but render hasn't happened yet.
 *
 * We get there by monkey-patching `internalModel.update(dt, now)`: call
 * the original (which runs motions, parameters, moc propagation, GL
 * vertex update etc.), then mutate. The next render call sees our values.
 *
 * The earlier `beforeModelUpdate` event was the *wrong* hook — it fires
 * before propagation runs, so propagation overwrites our mutation. The
 * d.ts only declares before-events, no after-update event, hence the
 * patch.
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
  /** original internalModel.update bound to the model — kept so destroy()
   *  can restore it. */
  private originalInternalUpdate: ((...args: unknown[]) => unknown) | null = null;

  // diagnostic counters (one-shot logs to keep console quiet after first frame)
  private _hookFireCount = 0;
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

    // Pre-register textures referenced by the manifest with an explicit
    // loadParser. Pixi v8's Assets detectors look at URL extensions to
    // pick a parser; blob: URLs (which is what parseBundle hands us)
    // have no extension, so the detector silently picks nothing and
    // every texture comes back null with "we don't know how to parse it".
    //
    // Pre-loading with `loadParser: 'loadTextures'` bypasses detection
    // entirely. The Cubism engine's later Assets.load(textureUrl) for
    // the same URL hits the cache.
    await this.preloadTextures(input.model3);

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

    // ----- monkey-patch internalModel.update so we can mutate AFTER it -----
    if (internal && typeof internal.update === "function") {
      const original = internal.update.bind(internal) as (...args: unknown[]) => unknown;
      this.originalInternalUpdate = original;
      // biome-ignore lint/suspicious/noExplicitAny: replacing engine method
      (internal as any).update = (...args: unknown[]) => {
        const result = original(...args);
        // After motion + propagation + moc.update — drawable opacities
        // are now finalized for this frame and the renderer will read
        // them next. Mutate here so our override is the last word.
        this.applyOverridesAfterUpdate();
        return result;
      };
      console.info(
        `[Live2DAdapter] patched internalModel.update · parts=${partCount} drawables=${drawableCount} partsMapped=${this.partToDrawables.size} nativeDrawables=${!!getNativeDrawables(coreModel)}`,
      );
    } else {
      console.error(
        "[Live2DAdapter] internalModel.update is not a function — overrides will not apply",
      );
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
   * Called immediately after `internalModel.update(dt, now)` completes.
   * At this point the engine has run motions, propagated parameters into
   * parts, parts into drawables, and called moc.update — drawable
   * opacities are finalized for this frame. We mutate them here so the
   * upcoming render uses our values.
   *
   * (We don't call coreModel.setPartOpacity at all; this build doesn't
   * expose it — `hasSetPartOpacity=false` in the diagnostic. Direct
   * drawable mutation is the only working channel.)
   */
  private applyOverridesAfterUpdate(): void {
    this._hookFireCount++;
    const cm = this.coreModel;
    if (!cm) return;
    if (this.partOpacityOverrides.size === 0) return;

    if (this._hookFireCount === 1 || this._hookFireCount % 240 === 0) {
      console.log(
        `[Live2DAdapter] post-update fire #${this._hookFireCount}, applying ${this.partOpacityOverrides.size} overrides`,
      );
    }

    const drawables = getNativeDrawables(cm);
    const opacities: Float32Array | undefined = drawables?.opacities;
    if (!opacities) return;

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
            `[Live2DAdapter] post-update verify: part[${idx}] → drawable[${sample}] opacity now=${opacities[sample]}`,
          );
          this._loggedDrawableMutate = true;
        }
      }
    }
  }

  getDisplayObject(): Container | null {
    return this.model;
  }

  setLayerVisibility(layerId: LayerId, visible: boolean): void {
    const idx = this.findPartIndex(layerId);
    if (idx == null) return;
    if (visible) {
      this.partOpacityOverrides.delete(idx);
    } else {
      this.partOpacityOverrides.set(idx, 0);
    }
    // The patched internalModel.update will run our applyOverridesAfterUpdate
    // on the next tick — no synchronous mutation here. setPartOpacity is
    // not exposed on this engine build anyway.
  }

  setLayerColor(layerId: LayerId, color: RGBA): void {
    const idx = this.findPartIndex(layerId);
    if (idx == null) return;
    if (color.a >= 1) {
      this.partOpacityOverrides.delete(idx);
    } else {
      this.partOpacityOverrides.set(idx, color.a);
    }
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
    if (this.originalInternalUpdate) {
      const internal = this.model?.internalModel;
      if (internal) {
        // biome-ignore lint/suspicious/noExplicitAny: restoring engine method
        (internal as any).update = this.originalInternalUpdate;
      }
      this.originalInternalUpdate = null;
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
   * Fetch the manifest, walk its texture references, and pre-load each
   * one through Pixi Assets with an explicit `loadParser`. This runs
   * before Live2DModel.from() so the engine's eventual texture fetches
   * hit the asset cache instead of the failing-detector path.
   */
  private async preloadTextures(manifestUrl: string): Promise<void> {
    let preloaded = 0;
    let total = 0;
    try {
      const res = await fetch(manifestUrl);
      const text = await res.text();
      const manifest = JSON.parse(text) as { FileReferences?: { Textures?: unknown[] } };
      const refs = manifest.FileReferences?.Textures ?? [];
      total = refs.length;
      for (const ref of refs) {
        if (typeof ref !== "string") continue;
        try {
          await Assets.load({ src: ref, loadParser: "loadTextures" });
          preloaded++;
        } catch (e) {
          console.warn(`[Live2DAdapter] preload texture failed (${ref.slice(0, 60)}…)`, e);
        }
      }
    } catch (e) {
      console.warn("[Live2DAdapter] could not preload textures from manifest", e);
    }
    console.info(`[Live2DAdapter] preloaded ${preloaded}/${total} textures`);
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
