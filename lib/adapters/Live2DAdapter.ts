import { Assets, type Container, type Texture as PixiTexture } from "pixi.js";
import { ID_PREFIX, newId } from "../avatar/id";
import type {
  Avatar,
  AvatarSource,
  Texture as DomainTexture,
  Layer,
  LayerId,
  Parameter,
  RGBA,
  TextureId,
  TextureSlice,
} from "../avatar/types";
import type {
  AdapterCapabilities,
  AdapterLoadInput,
  AvatarAdapter,
  FormatDetectionResult,
  LayerTriangles,
  TextureSourceInfo,
} from "./AvatarAdapter";
import { applyLayerOverrides } from "./applyOverrides";

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
  /**
   * part-index → drawables whose `parentPartIndex` *is* this part. Used
   * for the part's own footprint (thumbnail, DecomposeStudio, Layer.texture).
   * Pure container parts have an empty list here.
   */
  private partToDirectDrawables = new Map<number, number[]>();
  /**
   * part-index → drawables under this part *or any descendant part*. Used
   * by visibility hiding so toggling a parent off cascades into children
   * the way Cubism semantics expect.
   */
  private partToDescendantDrawables = new Map<number, number[]>();
  /**
   * Drawables that are referenced as a clipping mask by ≥1 other drawable.
   * Built once at load via the reverse lookup of `getDrawableMasks()`.
   * Used to filter "pure-clip" parts whose drawables exist only to shape
   * other layers — they have UVs in the atlas but nothing visible in the
   * final render, so they're noise in the layers panel.
   */
  private maskDrawables = new Set<number>();
  /** original internalModel.update bound to the model — kept so destroy()
   *  can restore it. */
  private originalInternalUpdate: ((...args: unknown[]) => unknown) | null = null;

  /** atlas page bitmaps keyed by the textureId we mint at load. Layer
   *  thumbnails crop these via `getTextureSource`. */
  private textureSourcesById = new Map<TextureId, TextureSourceInfo>();
  /** Live Pixi Texture per page — `setLayerMasks` swaps `.source.resource`
   *  to push masked pixels to the GPU. */
  private pixiTextureById = new Map<TextureId, PixiTexture>();
  /** Reverse of `textureIdByPageIndex` — used by `getLayerTriangles` to
   *  filter drawables to those that live on the layer's dominant page. */
  private pageIndexByTextureId = new Map<TextureId, number>();

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

    // Pull human-readable part names out of the puppet's cdi3.json when
    // the manifest references one. cdi3 is the only standard Cubism file
    // that maps engine ids ("PartArtMesh1") to artist-authored display
    // names ("頬"); we override Layer.name with that when available.
    // Empty map when the puppet ships without a DisplayInfo file.
    const partDisplayNames = await this.loadCdi3PartNames(input.model3);

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
          name: partDisplayNames.get(externalId) ?? externalId,
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

        // Direct: drawable belongs to its immediate parent part only.
        // Used for the part's own footprint (no atlas neighbors).
        let directList = this.partToDirectDrawables.get(directPart);
        if (!directList) {
          directList = [];
          this.partToDirectDrawables.set(directPart, directList);
        }
        directList.push(d);

        // Descendant: drawable also contributes to every ancestor part.
        // Used for visibility hide so a container toggle cascades to
        // its children the way Cubism semantics expect.
        const chain = ancestorChains[directPart] ?? [directPart];
        for (const partIdx of chain) {
          let descList = this.partToDescendantDrawables.get(partIdx);
          if (!descList) {
            descList = [];
            this.partToDescendantDrawables.set(partIdx, descList);
          }
          descList.push(d);
        }
      }

      // Build the "drawable is used as a clipping mask" set. Cubism's
      // mask relation is forward — each drawable has a list of mask
      // drawables (`getDrawableMasks()[d]`). Reversing it gives us the
      // set of drawables that *exist as masks* for ≥1 other drawable.
      // Parts whose direct drawables are entirely in this set are
      // pure-clip parts and get filtered from `Avatar.layers` below.
      const drawableMaskLists = coreModel.getDrawableMasks?.() as Int32Array[] | undefined;
      if (Array.isArray(drawableMaskLists)) {
        for (let d = 0; d < drawableMaskLists.length; d++) {
          const list = drawableMaskLists[d];
          if (!list) continue;
          for (let i = 0; i < list.length; i++) {
            const maskIdx = list[i];
            if (typeof maskIdx === "number" && maskIdx >= 0) {
              this.maskDrawables.add(maskIdx);
            }
          }
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

    // ----- texture page catalog + per-part region bbox -----
    // The engine exposes loaded Pixi textures on `model.textures`. We turn
    // each into a Domain texture entry, then compute one UV bbox per part
    // (over its drawables on the dominant page). UV space is GL-style with
    // v=0 at the bottom, so y is flipped before storing the pixel rect.
    const textures: DomainTexture[] = [];
    const textureIdByPageIndex = new Map<number, TextureId>();
    // biome-ignore lint/suspicious/noExplicitAny: engine internals
    const pixiTextures: unknown[] = ((model as any).textures ?? []) as unknown[];
    pixiTextures.forEach((tex, idx) => {
      const info = pixiTextureToSourceInfo(tex);
      if (!info) return;
      const id = newId(ID_PREFIX.texture);
      textureIdByPageIndex.set(idx, id);
      this.pageIndexByTextureId.set(id, idx);
      this.textureSourcesById.set(id, info);
      // Pixi Texture handle for live mutation. Some engine builds expose
      // `tex.texture` (wrapper) — we duck-type to find the actual Pixi
      // Texture (it has `.source.resource`).
      const pixiTex = (isPixiTexture(tex) ? tex : null) as PixiTexture | null;
      if (pixiTex) this.pixiTextureById.set(id, pixiTex);
      textures.push({
        id,
        pageIndex: idx,
        origin: "original",
        pixelSize: { w: info.width, h: info.height },
        data: { kind: "url", url: input.model3 },
      });
    });

    if (coreModel && textureIdByPageIndex.size > 0) {
      let withSlice = 0;
      for (const [partIdx, layer] of this.layerByPartIndex.entries()) {
        // Footprint = the part's *own* drawables only. Container parts
        // with empty `partToDirectDrawables` get no slice (they're also
        // filtered out of `Avatar.layers` further down).
        const drawableList = this.partToDirectDrawables.get(partIdx);
        if (!drawableList || drawableList.length === 0) continue;
        const slice = this.buildPartSlice(coreModel, drawableList, textureIdByPageIndex);
        if (slice) {
          layer.texture = slice;
          withSlice++;
        }
      }
      console.info(
        `[Live2DAdapter] populated Layer.texture for ${withSlice}/${this.layerByPartIndex.size} parts (pages=${textureIdByPageIndex.size})`,
      );
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
        `[Live2DAdapter] patched internalModel.update · parts=${partCount} drawables=${drawableCount} partsWithDirect=${this.partToDirectDrawables.size} partsWithDescendants=${this.partToDescendantDrawables.size} nativeDrawables=${!!getNativeDrawables(coreModel)}`,
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

    // Filter the panel-visible layer list down to parts that own real
    // visible content. Two structural exclusions, both decided from
    // Cubism's own data — no heuristic:
    //   1. Pure container parts (zero direct drawables). They group
    //      children, they have no atlas footprint of their own, and
    //      our deeper code paths (thumbnail / DecomposeStudio) have
    //      nothing to render for them. Remain in `layerByPartIndex`
    //      so id-keyed visibility still reaches them if needed.
    //   2. Pure-clip parts: every direct drawable is referenced as a
    //      clipping mask by some other drawable. These exist to define
    //      clip shapes — Cubism may render them but the artist intent
    //      is "I'm a stencil for someone else", and we surface them as
    //      ghosts in DecomposeStudio. Filter them out.
    let hiddenContainerCount = 0;
    let hiddenClipCount = 0;
    let multiPagePartCount = 0;
    const exposedLayers = layers.filter((_, partIdx) => {
      const direct = this.partToDirectDrawables.get(partIdx);
      if (!direct || direct.length === 0) {
        hiddenContainerCount++;
        return false;
      }
      const allMasks = direct.every((d) => this.maskDrawables.has(d));
      if (allMasks) {
        hiddenClipCount++;
        return false;
      }
      // Diagnostic: parts whose direct drawables span >1 atlas page get
      // partial coverage in DecomposeStudio (we crop the dominant page
      // only). Logged for debugging; not filtered — partial is better
      // than nothing, and authors rarely produce these.
      if (coreModel) {
        const pages = new Set<number>();
        for (const d of direct) {
          const p: number | undefined = coreModel.getDrawableTextureIndex?.(d);
          if (typeof p === "number" && p >= 0) pages.add(p);
        }
        if (pages.size > 1) multiPagePartCount++;
      }
      return true;
    });
    if (hiddenContainerCount > 0 || hiddenClipCount > 0 || multiPagePartCount > 0) {
      console.info(
        `[Live2DAdapter] hidden ${hiddenContainerCount} containers + ${hiddenClipCount} clip-only parts of ${layers.length}; ${multiPagePartCount} parts span multi-page (dominant page only)`,
      );
    }

    const now = Date.now();
    const avatar: Avatar = {
      id: newId(ID_PREFIX.avatar),
      name: this.deriveName(input.model3),
      source,
      layers: exposedLayers,
      groups: [],
      variants: [],
      textures: [],
      animations: animationsRefs,
      parameters,
      metadata: { createdAt: now, updatedAt: now, schemaVersion: 1 },
    };
    avatar.textures = textures;
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
      // Visibility cascades down the part tree — hiding a parent must
      // hide every drawable underneath, not just the parent's direct ones.
      const list = this.partToDescendantDrawables.get(partIdx);
      if (!list) continue;
      for (const d of list) {
        opacities[d] *= multiplier;
      }
    }

    if (!this._loggedDrawableMutate) {
      const first = this.partOpacityOverrides.entries().next().value;
      if (first) {
        const [idx] = first;
        const list = this.partToDescendantDrawables.get(idx) ?? [];
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

  getTextureSource(textureId: TextureId): TextureSourceInfo | null {
    return this.textureSourcesById.get(textureId) ?? null;
  }

  getLayerTriangles(layerId: LayerId): LayerTriangles | null {
    const cm = this.coreModel;
    if (!cm) return null;
    const partIdx = this.findPartIndex(layerId);
    if (partIdx == null) return null;
    const layer = this.layerByPartIndex.get(partIdx);
    if (!layer?.texture) return null;
    const targetPageIdx = this.pageIndexByTextureId.get(layer.texture.textureId);
    if (targetPageIdx == null) return null;
    // Footprint = the part's *direct* drawables only. Pre-2.5 used
    // descendants here, which made every container part appear to own
    // its children's atlas regions — confusing in DecomposeStudio.
    const drawables = this.partToDirectDrawables.get(partIdx);
    if (!drawables || drawables.length === 0) return null;

    // Collect triangle UVs from drawables on the target page only. Cubism
    // UV space has v=0 at the bottom; we flip to top-down so consumers
    // match Spine + atlas-page-bitmap conventions.
    const tris: number[] = [];
    for (const d of drawables) {
      const dPageIdx: number | undefined = cm.getDrawableTextureIndex?.(d);
      if (dPageIdx !== targetPageIdx) continue;
      const uvs = cm.getDrawableVertexUvs?.(d) as Float32Array | undefined;
      const indices = cm.getDrawableVertexIndices?.(d) as Uint16Array | Uint32Array | undefined;
      if (!uvs || !indices) continue;
      for (let i = 0; i < indices.length; i++) {
        const v = indices[i];
        const u = uvs[v * 2];
        const vv = uvs[v * 2 + 1];
        if (typeof u !== "number" || typeof vv !== "number") continue;
        tris.push(u, 1 - vv);
      }
    }
    if (tris.length === 0) return null;
    return {
      textureId: layer.texture.textureId,
      uvs: new Float32Array(tris),
    };
  }

  async setLayerOverrides(opts: {
    masks: Readonly<Record<LayerId, Blob>>;
    textures: Readonly<Record<LayerId, Blob>>;
  }): Promise<void> {
    await applyLayerOverrides(opts, {
      findLayer: (id) => this.findLayerByLayerId(id),
      getTriangles: (id) => this.getLayerTriangles(id),
      textureSources: this.textureSourcesById,
      pixiTextures: this.pixiTextureById,
    });
  }

  private findLayerByLayerId(layerId: LayerId): import("../avatar/types").Layer | null {
    for (const layer of this.layerByPartIndex.values()) {
      if (layer.id === layerId) return layer;
    }
    return null;
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
    this.partToDirectDrawables.clear();
    this.partToDescendantDrawables.clear();
    this.maskDrawables.clear();
    this.textureSourcesById.clear();
    this.pixiTextureById.clear();
    this.pageIndexByTextureId.clear();
    this.model?.destroy?.();
    this.model = null;
    this.coreModel = null;
    this.layerByPartIndex.clear();
  }

  // ----- texture / region helpers -----

  /**
   * Compute the atlas region rect for a Cubism part by walking its
   * drawables' UVs. We pick the texture page that the most drawables
   * sit on (parts can technically span pages but most don't), union
   * UVs across drawables, then convert to pixel coords on that page.
   *
   * Cubism UV space has v=0 at the bottom; canvas pixel y is top-down,
   * so the v range is flipped when computing the rect.
   */
  private buildPartSlice(
    // biome-ignore lint/suspicious/noExplicitAny: cubism core model
    coreModel: any,
    drawableList: number[],
    textureIdByPageIndex: Map<number, TextureId>,
  ): TextureSlice | null {
    const drawablesByPage = new Map<number, number[]>();
    for (const d of drawableList) {
      const pageIdx: number | undefined = coreModel.getDrawableTextureIndex?.(d);
      if (typeof pageIdx !== "number" || pageIdx < 0) continue;
      let arr = drawablesByPage.get(pageIdx);
      if (!arr) {
        arr = [];
        drawablesByPage.set(pageIdx, arr);
      }
      arr.push(d);
    }
    if (drawablesByPage.size === 0) return null;

    let bestPage = -1;
    let bestCount = 0;
    for (const [pi, arr] of drawablesByPage) {
      if (arr.length > bestCount) {
        bestPage = pi;
        bestCount = arr.length;
      }
    }
    if (bestPage < 0) return null;
    const textureId = textureIdByPageIndex.get(bestPage);
    if (!textureId) return null;
    const srcInfo = this.textureSourcesById.get(textureId);
    if (!srcInfo) return null;

    const drawablesOnPage = drawablesByPage.get(bestPage);
    if (!drawablesOnPage) return null;

    let minU = Number.POSITIVE_INFINITY;
    let minV = Number.POSITIVE_INFINITY;
    let maxU = Number.NEGATIVE_INFINITY;
    let maxV = Number.NEGATIVE_INFINITY;
    let sawAny = false;

    for (const d of drawablesOnPage) {
      const uvs = coreModel.getDrawableVertexUvs?.(d) as Float32Array | undefined;
      if (!uvs || uvs.length < 2) continue;
      for (let i = 0; i + 1 < uvs.length; i += 2) {
        const u = uvs[i];
        const v = uvs[i + 1];
        if (u < minU) minU = u;
        if (u > maxU) maxU = u;
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
        sawAny = true;
      }
    }
    if (!sawAny || maxU <= minU || maxV <= minV) return null;

    // clamp to [0,1] then convert to canvas pixel space (top-left origin)
    const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
    minU = clamp01(minU);
    maxU = clamp01(maxU);
    minV = clamp01(minV);
    maxV = clamp01(maxV);
    const w = srcInfo.width;
    const h = srcInfo.height;
    const x = Math.max(0, Math.floor(minU * w));
    const y = Math.max(0, Math.floor((1 - maxV) * h));
    const rectW = Math.min(w - x, Math.ceil((maxU - minU) * w));
    const rectH = Math.min(h - y, Math.ceil((maxV - minV) * h));
    if (rectW <= 0 || rectH <= 0) return null;

    return {
      textureId,
      rect: { x, y, w: rectW, h: rectH },
      rotated: false,
    };
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

  /**
   * Read part display names from the puppet's `.cdi3.json` (Cubism
   * Display Info) when the manifest references one. Cubism Editor lets
   * artists author per-part Japanese / Korean names and stashes them in
   * cdi3 — pulling them in turns LayersPanel rows from `PartArtMesh1`
   * into something a human can scan.
   *
   * Pure data lookup with a fully-defined source: no heuristic, no name
   * guessing. Returns an empty map (silently) when the puppet ships
   * without a DisplayInfo file or when the file is malformed — callers
   * fall back to the raw engine id.
   */
  private async loadCdi3PartNames(manifestUrl: string): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    try {
      const manifestRes = await fetch(manifestUrl);
      const manifest = (await manifestRes.json()) as {
        FileReferences?: { DisplayInfo?: string };
      };
      const rel = manifest?.FileReferences?.DisplayInfo;
      if (typeof rel !== "string" || rel.length === 0) {
        console.info("[Live2DAdapter] no cdi3 DisplayInfo in manifest");
        return out;
      }
      const cdi3Url = resolveSiblingUrl(manifestUrl, rel);
      const cdi3Res = await fetch(cdi3Url);
      if (!cdi3Res.ok) {
        console.warn(`[Live2DAdapter] cdi3 fetch failed: ${cdi3Res.status} ${cdi3Url}`);
        return out;
      }
      const cdi3 = (await cdi3Res.json()) as {
        Parts?: { Id?: unknown; Name?: unknown }[];
      };
      const parts = Array.isArray(cdi3?.Parts) ? cdi3.Parts : [];
      for (const p of parts) {
        if (typeof p?.Id === "string" && typeof p?.Name === "string" && p.Name.length > 0) {
          out.set(p.Id, p.Name);
        }
      }
      console.info(`[Live2DAdapter] cdi3 part display names: ${out.size}`);
    } catch (e) {
      console.warn("[Live2DAdapter] cdi3 load failed (continuing with engine ids)", e);
    }
    return out;
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
 * Resolve a path relative to a manifest URL — `model3.json`'s file
 * references are siblings (e.g. "Hiyori.cdi3.json" lives next to
 * "Hiyori.model3.json"). We strip the manifest's filename and append
 * the relative path. Works for both absolute (`/samples/.../`) and
 * blob URLs whose querystring carries the original path.
 */
function resolveSiblingUrl(manifestUrl: string, relPath: string): string {
  const slashIdx = manifestUrl.lastIndexOf("/");
  const base = slashIdx >= 0 ? manifestUrl.substring(0, slashIdx + 1) : "";
  return base + relPath;
}

/**
 * Pull a drawable bitmap + dimensions out of a Pixi v8 Texture without
 * coupling this file to Pixi types. Pixi v8 stores the source bitmap on
 * `texture.source.resource` (HTMLImageElement / ImageBitmap / etc.) and
 * the page dimensions on `texture.source.width/height`.
 */
function pixiTextureToSourceInfo(tex: unknown): TextureSourceInfo | null {
  // biome-ignore lint/suspicious/noExplicitAny: pixi internals
  const t = tex as any;
  const source = t?.source;
  const resource = source?.resource;
  if (!isCanvasImageSource(resource)) return null;
  const width: number = source.width ?? source.pixelWidth ?? 0;
  const height: number = source.height ?? source.pixelHeight ?? 0;
  if (!width || !height) return null;
  return { image: resource, width, height };
}

function isCanvasImageSource(v: unknown): v is CanvasImageSource {
  if (!v) return false;
  if (typeof HTMLImageElement !== "undefined" && v instanceof HTMLImageElement) return true;
  if (typeof ImageBitmap !== "undefined" && v instanceof ImageBitmap) return true;
  if (typeof HTMLCanvasElement !== "undefined" && v instanceof HTMLCanvasElement) return true;
  if (typeof OffscreenCanvas !== "undefined" && v instanceof OffscreenCanvas) return true;
  return false;
}

/**
 * Heuristic for "is this a live Pixi v8 Texture instance?". We can't
 * `instanceof Texture` here without coupling this file to pixi, and the
 * engine's `model.textures` array shape varies subtly across builds.
 * Anything with a `source.resource` qualifies — that's all the swap
 * code needs.
 */
function isPixiTexture(v: unknown): boolean {
  // biome-ignore lint/suspicious/noExplicitAny: probing pixi shape
  const t = v as any;
  return !!t?.source && (t.source.resource !== undefined || typeof t.source.update === "function");
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
