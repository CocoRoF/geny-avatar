"use client";

/**
 * MmdAdapter — third first-class runtime: MikuMikuDance PMX/PMD models,
 * rendered in 3D via babylon-mmd.
 *
 * Everything heavy lives in `mmd/MmdStage.ts` behind a dynamic import;
 * this file stays cheap enough for the registry to import statically
 * (the same trick the AI provider registry uses). The docs recorded
 * "3D avatars" as a V1 non-goal — that scope decision is formally
 * reversed in docs/plan/10_mmd_3d_runtime.md.
 *
 * Domain mapping (2D concepts → MMD):
 *   - Layer      → material (visibility = per-material mesh toggle)
 *   - Parameter  → morph (weight 0..1) — powers the morph sliders
 *   - Animation  → bundled .vmd motion file (by file stem)
 *   - Atlas / triangles / native variants → none; the atlas-flavored
 *     interface methods return null/[] and the UI hides those tools
 *     (LayerRow already gates DecomposeStudio on `layer.texture`).
 *
 * The adapter renders into its own canvas (capabilities.selfHostedView):
 * PuppetCanvas/usePuppet skip the Pixi Application entirely and call
 * `mountView(host)` instead. Camera interaction is Babylon's — the
 * viewport store's pan/zoom does not apply.
 */

import type {
  Avatar,
  LayerId,
  NativeVariant,
  Parameter,
  RGBA,
  TextureId,
  VariantApplyData,
} from "../avatar/types";
import type {
  AdapterCapabilities,
  AdapterLoadInput,
  AvatarAdapter,
  FormatDetectionResult,
  LayerTriangles,
  MorphCatalogEntry,
  TextureSourceInfo,
} from "./AvatarAdapter";
import type { ApplyResult } from "./applyOverrides";
import type { MmdCameraPose, MmdLoadResult, MmdStage } from "./mmd/MmdStage";

const MAT_PREFIX = "mat:";
const MORPH_PREFIX = "morph:";

export class MmdAdapter implements AvatarAdapter {
  readonly runtime = "mmd" as const;
  readonly capabilities: AdapterCapabilities = {
    layerUnit: "material",
    canChangeMesh: false,
    canSwapTexture: false,
    tinting: "opacity-only",
    hasAnimationTimeline: true,
    hasParameterGraph: true,
    hasPhysics: true,
    selfHostedView: true,
  };

  private stage: MmdStage | null = null;
  private loaded: MmdLoadResult | null = null;
  private morphWeights = new Map<string, number>();

  static detect(filenames: ReadonlyArray<string>): FormatDetectionResult | null {
    const hasPmx = filenames.some((f) => /\.pmx$/i.test(f));
    const hasPmd = filenames.some((f) => /\.pmd$/i.test(f));
    if (!hasPmx && !hasPmd) return null;
    return { runtime: "mmd", version: hasPmx ? "PMX" : "PMD", confidence: "high" };
  }

  async load(input: AdapterLoadInput): Promise<Avatar> {
    if (input.kind !== "mmd") throw new Error(`MmdAdapter got input kind ${input.kind}`);
    const { MmdStage } = await import("./mmd/MmdStage");
    const stage = new MmdStage();
    this.stage = stage;
    const result = await stage.load(input.pmxPath, input.entries);
    this.loaded = result;

    const now = Date.now();
    return {
      id: "",
      name: result.modelNameJp || input.pmxPath.split("/").pop() || "MMD model",
      source: {
        runtime: "mmd",
        version: "PMX",
        pmxPath: input.pmxPath,
        texturePaths: input.entries
          .filter((e) => /\.(png|jpe?g|webp|bmp|tga|spa|sph|dds)$/i.test(e.path))
          .map((e) => e.path),
        vmdPaths: input.entries.filter((e) => /\.vmd$/i.test(e.path)).map((e) => e.path),
      },
      layers: result.materials.map((m) => ({
        id: `${MAT_PREFIX}${m.index}`,
        externalId: m.name,
        name: m.name,
        geometry: "mesh" as const,
        defaults: { visible: true, color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1 },
      })),
      groups: [],
      variants: [],
      textures: [],
      animations: result.vmdNames.map((name) => ({
        name,
        loop: true,
        source: "mmd-vmd" as const,
      })),
      parameters: result.morphs.map((m) => ({
        id: `${MORPH_PREFIX}${m.name}`,
        name: m.name,
        min: 0,
        max: 1,
        default: 0,
        source: "mmd-morph" as const,
      })),
      metadata: { createdAt: now, updatedAt: now, schemaVersion: 1 },
    };
  }

  getDisplayObject(): null {
    return null; // self-hosted view — there is no Pixi display object
  }

  mountView(host: HTMLElement): void {
    this.stage?.mount(host);
  }

  resetCamera(): void {
    this.stage?.resetCamera();
  }

  async captureFrame(sizePx = 256): Promise<Blob | null> {
    return (await this.stage?.captureFrame(sizePx)) ?? null;
  }

  getMorphCatalog(): MorphCatalogEntry[] {
    return this.stage?.getMorphCatalog() ?? [];
  }

  getCameraPose(): MmdCameraPose | null {
    return this.stage?.getCameraPose() ?? null;
  }

  applyCameraPose(pose: MmdCameraPose): void {
    this.stage?.applyCameraPose(pose);
  }

  setLayerVisibility(layerId: LayerId, visible: boolean): void {
    const index = materialIndex(layerId);
    if (index !== null) this.stage?.setMaterialVisible(index, visible);
  }

  setLayerColor(layerId: LayerId, color: RGBA): void {
    // opacity-only tinting (see capabilities)
    const index = materialIndex(layerId);
    if (index !== null) this.stage?.setMaterialAlpha(index, color.a);
  }

  playAnimation(name: string): void {
    void this.stage?.playAnimation(name).catch((e) => {
      console.warn(`[MmdAdapter] failed to play VMD "${name}"`, e);
    });
  }

  stopAnimation(): void {
    this.stage?.stopAnimation();
  }

  pauseMotion(): void {
    this.stage?.pauseAnimation();
  }

  resumeMotion(): void {
    this.stage?.resumeAnimation();
  }

  /** Jump the playing motion to an MMD frame (30fps units). */
  seekMotion(frame: number): void {
    this.stage?.seekAnimation(frame);
  }

  /** Register an extra VMD uploaded after load (Animation tab). */
  addMotionFile(name: string, file: File): void {
    this.stage?.addVmdFile(name, file);
  }

  getMotionNames(): string[] {
    return this.stage?.getMotionNames() ?? [];
  }

  getMotionState(): { name: string | null; paused: boolean; frame: number; duration: number } {
    return this.stage?.getMotionState() ?? { name: null, paused: false, frame: 0, duration: 0 };
  }

  setParameter(paramId: string, value: number): void {
    if (!paramId.startsWith(MORPH_PREFIX)) return;
    const name = paramId.slice(MORPH_PREFIX.length);
    this.morphWeights.set(name, value);
    this.stage?.setMorphWeight(name, value);
  }

  getParameters(): Parameter[] {
    if (!this.loaded) return [];
    return this.loaded.morphs.map((m) => ({
      id: `${MORPH_PREFIX}${m.name}`,
      name: m.name,
      min: 0,
      max: 1,
      default: this.morphWeights.get(m.name) ?? 0,
      source: "mmd-morph" as const,
    }));
  }

  // ----- atlas-flavored surface: MMD has no packed atlas -----

  getTextureSource(_textureId: TextureId): TextureSourceInfo | null {
    return null;
  }

  getLayerTriangles(_layerId: LayerId): LayerTriangles | null {
    return null;
  }

  async setLayerOverrides(): Promise<ApplyResult> {
    return { failedLayerIds: [] };
  }

  listNativeVariants(): NativeVariant[] {
    return [];
  }

  applyVariantData(_data: VariantApplyData): void {
    // MMD has no runtime-preset concept (visibility rides the layer channel)
  }

  getActiveVariantData(): VariantApplyData {
    return {};
  }

  listHiddenAtlasFootprints(): LayerTriangles[] {
    return [];
  }

  destroy(): void {
    this.stage?.dispose();
    this.stage = null;
    this.loaded = null;
  }
}

function materialIndex(layerId: LayerId): number | null {
  if (!layerId.startsWith(MAT_PREFIX)) return null;
  const n = Number(layerId.slice(MAT_PREFIX.length));
  return Number.isInteger(n) && n >= 0 ? n : null;
}
