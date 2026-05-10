import { Assets, type Container, type Texture as PixiTexture } from "pixi.js";
import { ID_PREFIX, newId } from "../avatar/id";
import type {
  Avatar,
  AvatarSource,
  Texture as DomainTexture,
  Layer,
  LayerId,
  NativeVariant,
  Parameter,
  RGBA,
  TextureId,
  TextureSlice,
  VariantApplyData,
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
  /**
   * partIndex → all `Layer` entries that share this Cubism part. A part
   * is split into one entry per atlas page when its drawables span
   * multiple pages: previously the dominant page's content was the
   * only one editable, so leg / tail meshes spread across two pages
   * would be partially missing from the panel. Each entry now carries
   * its own page-specific `Layer.texture`.
   */
  private layersByPartIndex = new Map<number, Layer[]>();
  /** Reverse lookup: layerId → its Cubism part index. */
  private partIndexByLayerId = new Map<LayerId, number>();

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
  /** atlas pageIndex → textureId. Inverse of `pageIndexByTextureId`,
   *  populated alongside it at load. Used by `listHiddenAtlasFootprints`
   *  to translate a drawable's `getDrawableTextureIndex` (a page index)
   *  back into the textureId that the export baker keys footprints by. */
  private textureIdByPageIndex = new Map<number, TextureId>();

  /** URL of the model3.json the adapter is currently driving — handed
   *  in via load(input.model3). Phase 8.2 (animation tab) needs this
   *  to re-parse the manifest for motion / expression / hit-area
   *  metadata; the engine does its own parse but doesn't expose the
   *  result through a stable API. Cached as a class field instead of
   *  an extra fetch round trip on every meta read. */
  private model3Url: string | null = null;

  /**
   * Cubism part groups pulled out of cdi3.json `Groups` (Target="Part").
   * Keyed by group name → list of part IDs declared in that group.
   * Surfaced via `listNativeVariants` so the user can import each
   * outfit / expression set as an IDB Variant. Empty when the puppet
   * ships without cdi3 Groups (Hiyori, etc.).
   */
  private cdi3PartGroups: { name: string; partIds: string[] }[] = [];

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
    this.model3Url = input.model3;

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
    // Same fetch also pulls cdi3 Groups (Target="Part"), stashed on
    // the adapter for `listNativeVariants` to surface as importable
    // outfit / expression presets. Empty when the puppet ships without
    // a DisplayInfo file.
    const cdi3 = await this.loadCdi3(input.model3);
    const partDisplayNames = cdi3.partNames;
    this.cdi3PartGroups = cdi3.partGroups;

    // Pull pose3.json and identify any parts that the Cubism Framework
    // will force to invisible regardless of editor toggles. The set is
    // surfaced to the UI via `Layer.bakedHidden` so re-imports of a
    // previously-exported puppet visibly mark the parts that are
    // already locked off by the model file.
    const bakedHiddenPartIds = await this.loadPose3HiddenParts(input.model3);

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
      // NOTE: Layer creation is deferred until *after* the texture
      // catalog is built. We need to know which atlas page each part's
      // drawables live on so we can split multi-page parts into one
      // layer per page (otherwise the non-dominant page's content —
      // e.g. the lower half of a leg that's split across pages — is
      // missing from the panel entirely). The deferred creation block
      // is below the texture catalog construction.

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
      this.textureIdByPageIndex.set(idx, id);
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

    // ----- create Layer entries (one per part, or one per page for
    // multi-page parts) -----
    //
    // Multi-page parts have direct drawables that live on more than one
    // atlas page. The earlier "dominant page only" approach silently
    // dropped the non-dominant page's pixels — leg / tail meshes split
    // across two atlas pages were partially missing from the panel. We
    // now expose ONE Layer per (part, page) pair: each layer owns a
    // page-specific TextureSlice, so the user can find and edit every
    // page's content. Single-page parts behave exactly as before
    // (one layer, original externalId, no name suffix).
    let multiPagePartCount = 0;
    let virtualLayerCount = 0;
    if (coreModel) {
      for (let partIdx = 0; partIdx < partCount; partIdx++) {
        const partExternalId = coerceCubismId(coreModel.getPartId?.(partIdx), `part_${partIdx}`);
        const partDisplayName = partDisplayNames.get(partExternalId) ?? partExternalId;
        const partOpacity: number = coreModel.getPartOpacity?.(partIdx) ?? 1;
        const partBakedHidden = bakedHiddenPartIds.has(partExternalId);
        const direct = this.partToDirectDrawables.get(partIdx) ?? [];

        // Group drawables by atlas page index. Drawables with no valid
        // texture index (rare; usually clipping helpers) get bucketed
        // under -1 and produce no slice.
        const drawablesByPage = new Map<number, number[]>();
        for (const d of direct) {
          const p = coreModel.getDrawableTextureIndex?.(d);
          if (typeof p !== "number" || p < 0) continue;
          let arr = drawablesByPage.get(p);
          if (!arr) {
            arr = [];
            drawablesByPage.set(p, arr);
          }
          arr.push(d);
        }

        const partLayers: Layer[] = [];

        if (drawablesByPage.size === 0) {
          // Container part (no direct drawables) OR a part whose direct
          // drawables all lack texture indices. Single layer with no
          // texture; the exposedLayers filter further down hides these
          // from the panel but they stay in `layersByPartIndex` so
          // visibility cascades still resolve.
          const layer: Layer = {
            id: newId(ID_PREFIX.layer),
            externalId: partExternalId,
            name: partDisplayName,
            geometry: "other",
            defaults: {
              visible: partOpacity > 0.01,
              color: { r: 1, g: 1, b: 1, a: 1 },
              opacity: partOpacity,
            },
            bakedHidden: partBakedHidden,
          };
          partLayers.push(layer);
          layers.push(layer);
          this.partIndexByLayerId.set(layer.id, partIdx);
        } else {
          const isMultiPage = drawablesByPage.size > 1;
          if (isMultiPage) multiPagePartCount++;
          // Iterate in deterministic order so panel ordering is stable
          // across reloads.
          const sortedPages = [...drawablesByPage.keys()].sort((a, b) => a - b);
          for (const pageIdx of sortedPages) {
            const drawablesOnPage = drawablesByPage.get(pageIdx);
            if (!drawablesOnPage) continue;
            // Multi-page parts get a `#p${pageIdx}` suffix on
            // externalId so IDB job history can persist independent
            // entries per page; single-page parts keep their original
            // externalId for IDB stability.
            const externalId = isMultiPage ? `${partExternalId}#p${pageIdx}` : partExternalId;
            const name = isMultiPage ? `${partDisplayName} · page ${pageIdx + 1}` : partDisplayName;
            const layer: Layer = {
              id: newId(ID_PREFIX.layer),
              externalId,
              name,
              geometry: "other",
              defaults: {
                visible: partOpacity > 0.01,
                color: { r: 1, g: 1, b: 1, a: 1 },
                opacity: partOpacity,
              },
              bakedHidden: partBakedHidden,
            };
            const slice = this.buildSliceForPage(
              coreModel,
              drawablesOnPage,
              pageIdx,
              textureIdByPageIndex,
            );
            if (slice) layer.texture = slice;
            partLayers.push(layer);
            layers.push(layer);
            this.partIndexByLayerId.set(layer.id, partIdx);
            virtualLayerCount++;
          }
        }

        if (partLayers.length > 0) {
          this.layersByPartIndex.set(partIdx, partLayers);
        }
      }

      const withSlice = layers.filter((l) => !!l.texture).length;
      console.info(
        `[Live2DAdapter] populated Layer.texture for ${withSlice}/${layers.length} layers across ${this.layersByPartIndex.size} parts (pages=${textureIdByPageIndex.size}; ${multiPagePartCount} multi-page parts → ${virtualLayerCount} virtual layers)`,
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

    // Filter the panel-visible layer list. Strict rule per user
    // requirement: NEVER hide a layer that has visible texture content,
    // even if our dedup heuristics think it's redundant. The only
    // exclusion is purely structural:
    //
    //   Layers without a TextureSlice. These are either pure container
    //   parts (zero direct drawables) or parts whose drawables all
    //   lack a valid texture index. They have no atlas footprint, no
    //   thumbnail to show, and no surface for DecomposeStudio /
    //   GeneratePanel to act on. Stay in `layersByPartIndex` so any
    //   id-keyed visibility cascade still reaches them.
    let hiddenContainerCount = 0;
    let clipRoleLayerCount = 0;
    const exposedLayers = layers.filter((layer) => {
      if (!layer.texture) {
        hiddenContainerCount++;
        return false;
      }
      // Diagnostic only: layers whose drawables are *also* referenced
      // as clipping masks for other drawables. Not filtered — a Cubism
      // drawable can be both visible content of its own AND a clip
      // shape for another layer.
      const partIdx = this.partIndexByLayerId.get(layer.id);
      if (partIdx != null) {
        const direct = this.partToDirectDrawables.get(partIdx) ?? [];
        if (direct.length > 0 && direct.every((d) => this.maskDrawables.has(d))) {
          clipRoleLayerCount++;
        }
      }
      return true;
    });
    if (hiddenContainerCount > 0 || clipRoleLayerCount > 0) {
      console.info(
        `[Live2DAdapter] hidden ${hiddenContainerCount} container layers of ${layers.length}; ${clipRoleLayerCount} layers whose drawables also serve as clip masks (still exposed)`,
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

  /**
   * URL of the model3.json manifest currently driving this adapter.
   * Returns null before load() runs. Phase 8.2 (animation tab) reads
   * this to fetch + parse the manifest's motion / expression /
   * hit-area metadata for the editor sidebar.
   */
  getModelManifestUrl(): string | null {
    return this.model3Url;
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

  /**
   * One Variant per cdi3 Part Group. A group declares a *set of parts
   * that go together* (an outfit, an expression set) but says nothing
   * about which of the puppet's other parts should be visible — so we
   * give each group mutex-style semantics:
   *
   *   - the group's own parts → visible
   *   - parts in *other* groups → hidden
   *   - parts not mentioned in any group → left untouched
   *
   * That matches the most common cdi3 Group use case (outfit selection
   * where exactly one outfit should be on at a time) and degrades
   * sensibly for layered groups: the user can re-enable other groups'
   * parts manually after applying.
   *
   * Each declared cdi3 part id is fanned out to all matching layer
   * externalIds, including the `#p${pageIdx}` suffix variants that
   * multi-page parts get (otherwise leg meshes split across two atlas
   * pages would only flip half).
   */
  listNativeVariants(): NativeVariant[] {
    if (this.cdi3PartGroups.length === 0) return [];

    // Build cdi3-partId → all matching layer externalIds. Multi-page
    // parts have multiple entries; single-page parts have exactly one.
    const cdi3IdToExternalIds = new Map<string, string[]>();
    for (const layers of this.layersByPartIndex.values()) {
      for (const layer of layers) {
        const baseId = stripPageSuffix(layer.externalId);
        let arr = cdi3IdToExternalIds.get(baseId);
        if (!arr) {
          arr = [];
          cdi3IdToExternalIds.set(baseId, arr);
        }
        arr.push(layer.externalId);
      }
    }

    // Pre-compute the union of "every layer that belongs to *any*
    // group". When a specific group is applied, every layer in this
    // union *not* in the group's own expanded set is set to hidden.
    const allGroupedExternalIds = new Set<string>();
    for (const g of this.cdi3PartGroups) {
      for (const id of g.partIds) {
        const matches = cdi3IdToExternalIds.get(id);
        if (matches) for (const ext of matches) allGroupedExternalIds.add(ext);
      }
    }

    const out: NativeVariant[] = [];
    for (const g of this.cdi3PartGroups) {
      const ownExternalIds = new Set<string>();
      for (const id of g.partIds) {
        const matches = cdi3IdToExternalIds.get(id);
        if (matches) for (const ext of matches) ownExternalIds.add(ext);
      }
      if (ownExternalIds.size === 0) continue;

      const visibility: Record<string, boolean> = {};
      for (const ext of ownExternalIds) visibility[ext] = true;
      for (const ext of allGroupedExternalIds) {
        if (!ownExternalIds.has(ext)) visibility[ext] = false;
      }

      out.push({
        source: "live2d-group",
        externalId: g.name,
        name: g.name,
        applyData: {},
        visibility,
      });
    }
    return out;
  }

  applyVariantData(_data: VariantApplyData): void {
    // Cubism's preset semantics live entirely in the visibility map
    // attached to the variant — there's no runtime call equivalent to
    // Spine's setSkinByName. The data channel is reserved for future
    // additions (live2dExpression etc.) and ignored for now.
  }

  getActiveVariantData(): VariantApplyData {
    return {};
  }

  /**
   * Cubism part visibility cascades to descendants at runtime through
   * the `partToDescendantDrawables` map (a hidden parent multiplies
   * every descendant drawable's opacity by 0). Atlas erase has to
   * mirror that — otherwise a hidden parent leaves its child
   * drawables (UI text, accessory pieces, info plates) intact in the
   * exported atlas, which the user observed bleeding through behind
   * the body. This method walks the same cascade.
   *
   * Multi-page split layers all map back to the same `partIdx`; we
   * dedupe at part-index level so descendants aren't traversed twice.
   * One returned `LayerTriangles` entry per (drawable, atlas page),
   * keyed by `textureId` so the baker can group them per page.
   */
  listHiddenAtlasFootprints(hiddenLayerIds: ReadonlyArray<LayerId>): LayerTriangles[] {
    const cm = this.coreModel;
    if (!cm) return [];

    const hiddenPartIndices = new Set<number>();
    for (const layerId of hiddenLayerIds) {
      const partIdx = this.partIndexByLayerId.get(layerId);
      if (partIdx == null) continue;
      hiddenPartIndices.add(partIdx);
    }
    if (hiddenPartIndices.size === 0) return [];

    const out: LayerTriangles[] = [];
    for (const partIdx of hiddenPartIndices) {
      const drawables = this.partToDescendantDrawables.get(partIdx) ?? [];
      for (const d of drawables) {
        const pageIdx: number | undefined = cm.getDrawableTextureIndex?.(d);
        if (typeof pageIdx !== "number" || pageIdx < 0) continue;
        const textureId = this.textureIdByPageIndex.get(pageIdx);
        if (!textureId) continue;
        const uvs = cm.getDrawableVertexUvs?.(d) as Float32Array | undefined;
        const indices = cm.getDrawableVertexIndices?.(d) as Uint16Array | Uint32Array | undefined;
        if (!uvs || !indices || indices.length < 3) continue;
        // Cubism UVs are bottom-up; flip v to match the top-down
        // convention `getLayerTriangles` exposes (and that the baker
        // multiplies by pageHeight directly).
        const tris = new Float32Array(indices.length * 2);
        for (let i = 0; i < indices.length; i++) {
          const v = indices[i];
          tris[i * 2] = uvs[v * 2];
          tris[i * 2 + 1] = 1 - uvs[v * 2 + 1];
        }
        out.push({ textureId, uvs: tris });
      }
    }
    return out;
  }

  getTextureSource(textureId: TextureId): TextureSourceInfo | null {
    return this.textureSourcesById.get(textureId) ?? null;
  }

  getLayerTriangles(layerId: LayerId): LayerTriangles | null {
    const cm = this.coreModel;
    if (!cm) return null;
    const partIdx = this.partIndexByLayerId.get(layerId);
    if (partIdx == null) return null;
    const layer = this.findLayerByLayerId(layerId);
    if (!layer?.texture) return null;
    // Each Layer's texture references exactly one atlas page now (multi-
    // page parts have been split into per-page virtual layers), so this
    // page filter naturally restricts triangles to the layer's own page.
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
    for (const layers of this.layersByPartIndex.values()) {
      for (const layer of layers) {
        if (layer.id === layerId) return layer;
      }
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
    this.textureIdByPageIndex.clear();
    this.model?.destroy?.();
    this.model = null;
    this.coreModel = null;
    this.layersByPartIndex.clear();
    this.partIndexByLayerId.clear();
  }

  // ----- texture / region helpers -----

  /**
   * Compute a `TextureSlice` for a specific (part, page) pair: union the
   * UVs of `drawablesOnPage` and convert to a pixel rect on `pageIdx`'s
   * atlas. Caller is responsible for providing only the drawables that
   * actually live on this page — we no longer pick a "dominant page"
   * because that silently dropped multi-page parts' content.
   *
   * Cubism UV space has v=0 at the bottom; canvas pixel y is top-down,
   * so the v range is flipped when computing the rect.
   */
  private buildSliceForPage(
    // biome-ignore lint/suspicious/noExplicitAny: cubism core model
    coreModel: any,
    drawablesOnPage: number[],
    pageIdx: number,
    textureIdByPageIndex: Map<number, TextureId>,
  ): TextureSlice | null {
    if (drawablesOnPage.length === 0) return null;
    const textureId = textureIdByPageIndex.get(pageIdx);
    if (!textureId) return null;
    const srcInfo = this.textureSourcesById.get(textureId);
    if (!srcInfo) return null;

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
    return this.partIndexByLayerId.get(layerId) ?? null;
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
   * Read display info from the puppet's `.cdi3.json` (Cubism Display
   * Info) when the manifest references one. cdi3 is the only standard
   * Cubism file that:
   *   - maps engine ids (`PartArtMesh1`) to artist-authored display
   *     names (`頬`) — used to relabel `Layer.name`,
   *   - declares logical part *Groups* (e.g. `服装A`, `表情`) — surfaced
   *     by `listNativeVariants` so the user can import each as an
   *     outfit / expression Variant.
   *
   * Pure data lookup with a fully-defined source: no heuristic, no name
   * guessing. Returns empty maps / list (silently) when the puppet
   * ships without a DisplayInfo file or when the file is malformed —
   * callers fall back to engine ids and the panel just shows zero
   * native presets.
   */
  private async loadCdi3(manifestUrl: string): Promise<{
    partNames: Map<string, string>;
    partGroups: { name: string; partIds: string[] }[];
  }> {
    const partNames = new Map<string, string>();
    const partGroups: { name: string; partIds: string[] }[] = [];
    try {
      const manifestRes = await fetch(manifestUrl);
      const manifest = (await manifestRes.json()) as {
        FileReferences?: { DisplayInfo?: string };
      };
      const rel = manifest?.FileReferences?.DisplayInfo;
      if (typeof rel !== "string" || rel.length === 0) {
        console.info("[Live2DAdapter] no cdi3 DisplayInfo in manifest");
        return { partNames, partGroups };
      }
      const cdi3Url = resolveSiblingUrl(manifestUrl, rel);
      const cdi3Res = await fetch(cdi3Url);
      if (!cdi3Res.ok) {
        console.warn(`[Live2DAdapter] cdi3 fetch failed: ${cdi3Res.status} ${cdi3Url}`);
        return { partNames, partGroups };
      }
      const cdi3 = (await cdi3Res.json()) as {
        Parts?: { Id?: unknown; Name?: unknown }[];
        Groups?: { Target?: unknown; Name?: unknown; Ids?: unknown }[];
      };

      const parts = Array.isArray(cdi3?.Parts) ? cdi3.Parts : [];
      for (const p of parts) {
        if (typeof p?.Id === "string" && typeof p?.Name === "string" && p.Name.length > 0) {
          partNames.set(p.Id, p.Name);
        }
      }

      // Cubism cdi3's `Target` value for part groups is `"Part"` in
      // recent exports but historically also `"PartOpacity"`. Accept
      // both; ignore Parameter groups (they belong to the param graph
      // panel, not the variants panel).
      const groups = Array.isArray(cdi3?.Groups) ? cdi3.Groups : [];
      for (const g of groups) {
        const target = typeof g?.Target === "string" ? g.Target : "";
        if (target !== "Part" && target !== "PartOpacity") continue;
        const name = typeof g?.Name === "string" && g.Name.length > 0 ? g.Name : null;
        const ids = Array.isArray(g?.Ids)
          ? g.Ids.filter((x): x is string => typeof x === "string")
          : [];
        if (!name || ids.length === 0) continue;
        partGroups.push({ name, partIds: ids });
      }
      console.info(
        `[Live2DAdapter] cdi3 loaded · partNames=${partNames.size} partGroups=${partGroups.length}`,
      );
    } catch (e) {
      console.warn("[Live2DAdapter] cdi3 load failed (continuing with engine ids)", e);
    }
    return { partNames, partGroups };
  }

  /**
   * Read the puppet's pose3.json (if it has one) and collect the part
   * ids that the Cubism Framework will force to invisible every frame.
   *
   * Pose-group semantics: within each group the **first** entry is the
   * "anchor" (visible), every other entry is faded toward opacity 0.
   * That's exactly what our own Export Model writes when the user
   * hides a part — so re-importing a previously-exported puppet leaves
   * those parts permanently hidden no matter what the editor's
   * visibility toggles say. The UI uses this set to render a `baked`
   * badge on the affected rows + explain why the toggle is inert.
   */
  private async loadPose3HiddenParts(manifestUrl: string): Promise<Set<string>> {
    const out = new Set<string>();
    try {
      const manifestRes = await fetch(manifestUrl);
      const manifest = (await manifestRes.json()) as {
        FileReferences?: { Pose?: string };
      };
      const rel = manifest?.FileReferences?.Pose;
      if (typeof rel !== "string" || rel.length === 0) {
        return out;
      }
      const poseUrl = resolveSiblingUrl(manifestUrl, rel);
      const poseRes = await fetch(poseUrl);
      if (!poseRes.ok) {
        console.warn(`[Live2DAdapter] pose3 fetch failed: ${poseRes.status} ${poseUrl}`);
        return out;
      }
      const pose = (await poseRes.json()) as {
        Groups?: { Id?: unknown }[][];
      };
      const groups = Array.isArray(pose?.Groups) ? pose.Groups : [];
      for (const group of groups) {
        if (!Array.isArray(group)) continue;
        // First entry is the anchor (visible). Every other entry in the
        // group is forced to opacity 0 by `CubismPose.doFade`.
        for (let i = 1; i < group.length; i++) {
          const id = group[i]?.Id;
          if (typeof id === "string" && id.length > 0) out.add(id);
        }
      }
      if (out.size > 0) {
        console.info(`[Live2DAdapter] pose3 baked-hidden parts: ${out.size}`);
      }
    } catch (e) {
      console.warn("[Live2DAdapter] pose3 parse failed (continuing without baked-hidden hints)", e);
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
 * Resolve a path relative to a manifest URL. `model3.json`'s file
 * references are siblings (e.g. "Hiyori.cdi3.json" lives next to
 * "Hiyori.model3.json"). For static / built-in puppets the
 * `relPath` is a relative filename and we strip the manifest's
 * filename + append.
 *
 * Uploaded puppets go through `rewriteLive2DManifest`, which
 * replaces every internal reference with a `blob:` URL that's
 * already absolute. Concatenating it onto the manifest's directory
 * would produce garbage like `blob:http://.../blob:http://.../`, so
 * detect absolute URLs (`blob:`, `http(s):`, `data:`) and pass them
 * through unchanged.
 */
function resolveSiblingUrl(manifestUrl: string, relPath: string): string {
  if (/^(blob:|https?:|data:)/i.test(relPath)) return relPath;
  const slashIdx = manifestUrl.lastIndexOf("/");
  const base = slashIdx >= 0 ? manifestUrl.substring(0, slashIdx + 1) : "";
  return base + relPath;
}

/**
 * Strip the `#p${pageIdx}` suffix that multi-page parts append to
 * `Layer.externalId`, so we can match a Cubism cdi3 part id (which
 * has no suffix) back to all of its per-page layers.
 */
function stripPageSuffix(externalId: string): string {
  const hashIdx = externalId.lastIndexOf("#p");
  if (hashIdx < 0) return externalId;
  return externalId.substring(0, hashIdx);
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
 * Cubism Core's `getPartId` / `getParameterId` return `CubismIdHandle`
 * objects. We coerce to a plain JS string at the boundary so React can
 * render the layer name without throwing — and so that downstream IDB
 * keys / pose3.json `Id` fields contain the **actual moc3 part id**
 * rather than a fallback. Earlier this function fell through to
 * `fallback = "part_<idx>"` for every layer because:
 *
 *   - `CubismId.getString()` returns a `csmString` *object*, not a
 *     plain JS string. `typeof csmString` is `"object"`, so the
 *     `typeof s === "string"` guard rejected it.
 *   - `CubismId._id` is also a `csmString`, so the next guard
 *     (`typeof v._id === "string"`) also rejected it.
 *
 * The fallback then produced names like `"part_0"` / `"part_3"` that
 * happen to be plausible-looking but **don't match the real part ids
 * in the moc3 binary**. That broke any feature that needs the engine
 * to look the id back up — most visibly the `pose3.json` hide patch
 * we generate during Export Model: the engine called
 * `getPartIndex("part_0")`, the moc3 had no part with that id, the
 * lookup returned `-1`, and pose silently did nothing.
 *
 * Now we explicitly unwrap `csmString` (its `.s` property holds the
 * real JS string) at every point where the wrapper might appear.
 */
function coerceCubismId(value: unknown, fallback: string): string {
  if (typeof value === "string") return value;
  if (value == null || typeof value !== "object") return fallback;
  // biome-ignore lint/suspicious/noExplicitAny: probing handle shape
  const v = value as any;
  if (typeof v.getString === "function") {
    const s = v.getString();
    if (typeof s === "string") return s;
    // `s` is csmString; its `.s` is the actual JS string the moc3 stored.
    if (s && typeof s === "object" && typeof s.s === "string") return s.s;
  }
  if (v._id != null) {
    if (typeof v._id === "string") return v._id;
    if (typeof v._id === "object" && typeof v._id.s === "string") return v._id.s;
  }
  if (typeof v.id === "string") return v.id;
  return fallback;
}
