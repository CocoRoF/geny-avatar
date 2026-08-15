"use client";

/**
 * MmdStage — the babylon-mmd side of the MMD adapter.
 *
 * Everything that touches @babylonjs/core or babylon-mmd lives here, and
 * `MmdAdapter` pulls this module in with a dynamic `import()` at load
 * time. That keeps the ~4MB 3D runtime out of every editor page's
 * first-paint chunk: 2D puppets never pay for it (the same pattern as
 * LayersPanel's dynamic DecomposeStudio import, just one level lower).
 *
 * Rendering model: the stage owns a dedicated <canvas> + Babylon Engine.
 * It is NOT part of the Pixi display tree — `AdapterCapabilities.
 * selfHostedView` tells the host to mount our canvas instead of building
 * a Pixi Application. Camera interaction (orbit / wheel dolly / pan) is
 * Babylon's ArcRotateCamera, not the editor's viewport store.
 *
 * Loading model files: PMX texture references are directory-relative
 * paths (often with backslashes, any case). babylon-mmd resolves them
 * against `referenceFiles` by each File's webkitRelativePath — so we
 * wrap every bundle blob in a File and define webkitRelativePath to its
 * bundle path. `rootUrl` is the .pmx's directory; the loader then joins
 * rootUrl + relative texture path and matches case-insensitively
 * (validated against a real 78k-vertex PMX 2.0 model).
 *
 * Physics: single-threaded bullet WASM (MmdWasmInstanceTypeSPR — the
 * multi-threaded builds need SharedArrayBuffer i.e. COOP/COEP headers we
 * can't guarantee under /avatar-editor or the Geny overlay). Physics
 * failure degrades gracefully to a rigid model instead of blocking load.
 */

// side effects: register the PMX/PMD loader plugin + MMD edge (outline)
// renderer + TGA texture support (MMD bundles commonly ship .tga).
import "babylon-mmd/esm/Loader/pmxLoader";
import "babylon-mmd/esm/Loader/pmdLoader";
import "babylon-mmd/esm/Loader/mmdOutlineRenderer";
import "@babylonjs/core/Materials/Textures/Loaders/tgaTextureLoader";
// SdefMesh shadow-less depth renderer components used by MmdStandardMaterial
import "@babylonjs/core/Rendering/depthRendererSceneComponent";

import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Engine } from "@babylonjs/core/Engines/engine";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import type { Material } from "@babylonjs/core/Materials/material";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Observer } from "@babylonjs/core/Misc/observable";
import { Scene } from "@babylonjs/core/scene";
import { MmdStandardMaterialBuilder } from "babylon-mmd/esm/Loader/mmdStandardMaterialBuilder";
import { SdefInjector } from "babylon-mmd/esm/Loader/sdefInjector";
import { VmdLoader } from "babylon-mmd/esm/Loader/vmdLoader";
import type { MmdMesh } from "babylon-mmd/esm/Runtime/mmdMesh";
import type { MmdModel } from "babylon-mmd/esm/Runtime/mmdModel";
import { MmdRuntime } from "babylon-mmd/esm/Runtime/mmdRuntime";
// side effect: registers the runtime-animation binding on MmdModel
import "babylon-mmd/esm/Runtime/Animation/mmdRuntimeModelAnimation";
import type { MorphCatalogEntry } from "../AvatarAdapter";

export type MmdCameraPose = {
  alpha: number;
  beta: number;
  radius: number;
  targetX: number;
  targetY: number;
  targetZ: number;
};

export type MmdStageEntry = { path: string; blob: Blob };

/** The slice of Babylon's Bone API the idle driver uses. Kept structural
 *  so we don't import the Bone class just for a type. */
type BoneLike = {
  name: string;
  /** getter returns a COPY; assignment goes through the real setter */
  rotationQuaternion: Quaternion;
};

export type MmdLoadResult = {
  modelNameJp: string;
  materials: { index: number; name: string }[];
  morphs: MorphCatalogEntry[];
  vmdNames: string[];
  physicsEnabled: boolean;
  boundsMin: [number, number, number];
  boundsMax: [number, number, number];
};

/** PMX morph panel byte → our catalog panel. 0 = "system/hidden" in the
 *  PMX spec; those still work via setMorphWeight, they just don't show
 *  in MMD's UI — group them under "other". */
const PANEL_BY_CATEGORY: Record<number, MorphCatalogEntry["panel"]> = {
  1: "brow",
  2: "eye",
  3: "mouth",
};

/** Idle blink candidates, in preference order (JP first — the de-facto
 *  standard names virtually every distributed model uses). */
const BLINK_MORPHS = ["まばたき", "瞬き", "まばたき両目", "blink"];

/** Idle micro-motion bones. Missing bones are skipped silently — bone
 *  names are standardized across MMD models but not guaranteed. */
const BREATH_BONE = "上半身";
const HEAD_BONE = "頭";

export class MmdStage {
  readonly canvas: HTMLCanvasElement;
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly camera: ArcRotateCamera;
  private mmdRuntime: MmdRuntime | null = null;
  private physicsRuntime: { dispose(): void } | null = null;
  private mmdModel: MmdModel | null = null;
  private rootMesh: MmdMesh | null = null;
  private materialMeshes: Mesh[] = [];
  private materials: Material[] = [];
  private morphCatalog: MorphCatalogEntry[] = [];
  private vmdFiles = new Map<string, File>();
  private animationHandles = new Map<string, unknown>();
  private playingAnimation: string | null = null;
  private idleObserver: Observer<Scene> | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private defaultCamera: MmdCameraPose | null = null;
  private blinkMorph: string | null = null;
  private skeletonBones: BoneLike[] = [];
  private disposed = false;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.display = "block";
    this.canvas.style.outline = "none";
    // Transparent clear + non-premultiplied alpha so the editor's own
    // background (and later, Geny's overlay desktop) shows through.
    this.engine = new Engine(this.canvas, true, {
      alpha: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true, // captureFrame reads the canvas back
      stencil: true,
    });
    SdefInjector.OverrideEngineCreateEffect(this.engine);

    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0, 0, 0, 0);
    // MMD materials mix ambient at 0.5 gray — the same constant the
    // babylon-mmd reference viewer uses; without it models render dark.
    this.scene.ambientColor = new Color3(0.5, 0.5, 0.5);

    this.camera = new ArcRotateCamera(
      "mmdCamera",
      -Math.PI / 2, // face the model (MMD models face -Z)
      Math.PI / 2,
      30,
      new Vector3(0, 12, 0),
      this.scene,
    );
    this.camera.minZ = 0.1;
    this.camera.maxZ = 500;
    this.camera.lowerRadiusLimit = 2;
    this.camera.upperRadiusLimit = 120;
    this.camera.wheelDeltaPercentage = 0.02;
    this.camera.panningSensibility = 60;

    const dir = new DirectionalLight("mmdDirLight", new Vector3(0.5, -1, 1), this.scene);
    dir.intensity = 0.8;
    const hemi = new HemisphericLight("mmdHemiLight", new Vector3(0, 1, 0), this.scene);
    hemi.intensity = 0.4;
  }

  /**
   * Load a PMX/PMD bundle. Call once per stage instance.
   *
   * Ordering note: the morph/material catalog MUST be captured from
   * `metadata` before `createMmdModel` — the runtime trims metadata to
   * free memory (trimMetadata default), and after that the arrays are
   * gone.
   */
  async load(pmxPath: string, entries: MmdStageEntry[]): Promise<MmdLoadResult> {
    const files = entries.map((e) => {
      const name = e.path.split("/").pop() ?? e.path;
      const file = new File([e.blob], name);
      // webkitRelativePath is a readonly accessor on File — redefine it
      // the way a <input webkitdirectory> pick would populate it. This
      // is what babylon-mmd's ReferenceFileResolver keys on.
      Object.defineProperty(file, "webkitRelativePath", { value: e.path });
      return { path: e.path, file };
    });

    const pmxFile = files.find((f) => f.path === pmxPath)?.file;
    if (!pmxFile) throw new Error(`bundle has no entry at ${pmxPath}`);
    const rootUrl = pmxPath.includes("/") ? pmxPath.slice(0, pmxPath.lastIndexOf("/") + 1) : "";

    const materialBuilder = new MmdStandardMaterialBuilder();
    // Editor context: we want the model visible even if a texture is
    // missing/corrupt — the builder logs and falls back per-material.
    const container = await LoadAssetContainerAsync(pmxFile, this.scene, {
      rootUrl,
      pluginOptions: {
        mmdmodel: {
          referenceFiles: files.map((f) => f.file),
          materialBuilder,
          loggingEnabled: false,
        },
      },
    });
    container.addAllToScene();

    const rootMesh = container.meshes[0] as MmdMesh;
    this.rootMesh = rootMesh;
    const metadata = rootMesh.metadata;
    this.materialMeshes = [...(metadata.meshes as Mesh[])];
    this.materials = [...(metadata.materials as Material[])];
    // Capture the skeleton reference before createMmdModel — metadata is
    // trimmed afterwards and the root mesh itself doesn't carry it.
    this.skeletonBones =
      (metadata as unknown as { skeleton?: { bones: BoneLike[] } }).skeleton?.bones ?? [];

    // Morph catalog — name + PMX panel byte. `morphs` metadata carries
    // the parser's PmxObject.Morph entries (name / category / …).
    const rawMorphs =
      (metadata as unknown as { morphs?: { name: string; category?: number }[] }).morphs ?? [];
    const seen = new Set<string>();
    this.morphCatalog = [];
    for (const m of rawMorphs) {
      if (!m?.name || seen.has(m.name)) continue; // same-name morphs act as one in MMD
      seen.add(m.name);
      this.morphCatalog.push({
        name: m.name,
        panel: PANEL_BY_CATEGORY[m.category ?? 0] ?? "other",
      });
    }

    // Physics — WASM bullet, single-threaded build. Failure (old
    // browser, blocked wasm fetch) is non-fatal: hair/skirt just stop
    // swaying. Dynamic import keeps the wasm-bindgen glue lazy too.
    let physicsEnabled = false;
    let physics: ConstructorParameters<typeof MmdRuntime>[1] = null;
    try {
      const [
        { GetMmdWasmInstance },
        { MmdWasmInstanceTypeSPR },
        { MultiPhysicsRuntime },
        { MmdBulletPhysics },
      ] = await Promise.all([
        import("babylon-mmd/esm/Runtime/Optimized/mmdWasmInstance"),
        import("babylon-mmd/esm/Runtime/Optimized/InstanceType/singlePhysicsRelease"),
        import("babylon-mmd/esm/Runtime/Optimized/Physics/Bind/Impl/multiPhysicsRuntime"),
        import("babylon-mmd/esm/Runtime/Optimized/Physics/mmdBulletPhysics"),
      ]);
      const wasmInstance = await GetMmdWasmInstance(new MmdWasmInstanceTypeSPR());
      const physicsRuntime = new MultiPhysicsRuntime(wasmInstance);
      physicsRuntime.setGravity(new Vector3(0, -98, 0));
      physicsRuntime.register(this.scene);
      this.physicsRuntime = physicsRuntime;
      physics = new MmdBulletPhysics(physicsRuntime);
      physicsEnabled = true;
    } catch (e) {
      console.warn("[MmdStage] physics unavailable — continuing without", e);
    }

    const mmdRuntime = new MmdRuntime(this.scene, physics);
    mmdRuntime.register(this.scene);
    this.mmdRuntime = mmdRuntime;
    this.mmdModel = mmdRuntime.createMmdModel(rootMesh as never, {
      buildPhysics: physicsEnabled,
    });

    // VMD motion files that shipped inside the bundle become playable
    // animations, keyed by file stem.
    for (const f of files) {
      if (!/\.vmd$/i.test(f.path)) continue;
      const stem = (f.path.split("/").pop() ?? f.path).replace(/\.vmd$/i, "");
      if (!this.vmdFiles.has(stem)) this.vmdFiles.set(stem, f.file);
    }

    // Default camera: frame the model from its bounds — portrait-ish,
    // target at ~65% height (face/chest), distance from model height.
    const bb = rootMesh.getHierarchyBoundingVectors();
    const height = Math.max(bb.max.y - Math.max(bb.min.y, 0), 1);
    const targetY = Math.max(bb.min.y, 0) + height * 0.65;
    this.defaultCamera = {
      alpha: -Math.PI / 2,
      beta: Math.PI / 2,
      radius: Math.min(Math.max(height * 1.15, 8), 110),
      targetX: 0,
      targetY,
      targetZ: 0,
    };
    this.applyCameraPose(this.defaultCamera);

    this.blinkMorph =
      this.morphCatalog.find((m) => BLINK_MORPHS.includes(m.name))?.name ??
      this.morphCatalog.find((m) => m.panel === "eye" && /まばたき|瞬き|blink/i.test(m.name))
        ?.name ??
      null;
    this.startIdleDriver();

    this.engine.runRenderLoop(this.renderFrame);

    return {
      modelNameJp:
        (metadata as unknown as { header?: { modelName?: string } }).header?.modelName ?? "",
      materials: this.materials.map((m, i) => ({ index: i, name: m.name })),
      morphs: [...this.morphCatalog],
      vmdNames: [...this.vmdFiles.keys()],
      physicsEnabled,
      boundsMin: [bb.min.x, bb.min.y, bb.min.z],
      boundsMax: [bb.max.x, bb.max.y, bb.max.z],
    };
  }

  private renderFrame = (): void => {
    if (this.disposed) return;
    this.scene.render();
    // Loop VMD playback — MmdRuntime plays through once and stops at
    // the last frame; a live avatar should cycle its motion.
    const rt = this.mmdRuntime;
    if (
      rt &&
      this.playingAnimation &&
      rt.animationFrameTimeDuration > 0 &&
      rt.currentFrameTime >= rt.animationFrameTimeDuration - 0.001
    ) {
      void rt.seekAnimation(0, true);
      void rt.playAnimation();
    }
  };

  // ----- view mounting -----

  mount(host: HTMLElement): void {
    host.appendChild(this.canvas);
    this.camera.attachControl(this.canvas, false);
    // Track host size — Babylon doesn't observe the canvas box.
    const dpr = window.devicePixelRatio || 1;
    this.engine.setHardwareScalingLevel(1 / dpr);
    this.engine.resize();
    this.resizeObserver = new ResizeObserver(() => this.engine.resize());
    this.resizeObserver.observe(host);
  }

  // ----- camera -----

  applyCameraPose(pose: MmdCameraPose): void {
    this.camera.alpha = pose.alpha;
    this.camera.beta = pose.beta;
    this.camera.radius = pose.radius;
    this.camera.setTarget(new Vector3(pose.targetX, pose.targetY, pose.targetZ));
  }

  getCameraPose(): MmdCameraPose {
    const t = this.camera.target;
    return {
      alpha: this.camera.alpha,
      beta: this.camera.beta,
      radius: this.camera.radius,
      targetX: t.x,
      targetY: t.y,
      targetZ: t.z,
    };
  }

  resetCamera(): void {
    if (this.defaultCamera) this.applyCameraPose(this.defaultCamera);
  }

  // ----- morphs / materials -----

  setMorphWeight(name: string, weight: number): void {
    try {
      this.mmdModel?.morph.setMorphWeight(name, weight);
    } catch {
      // unknown morph name — the UI lists only real ones; ignore races
    }
  }

  getMorphWeight(name: string): number {
    try {
      return this.mmdModel?.morph.getMorphWeight(name) ?? 0;
    } catch {
      return 0;
    }
  }

  getMorphCatalog(): MorphCatalogEntry[] {
    return [...this.morphCatalog];
  }

  setMaterialVisible(index: number, visible: boolean): void {
    // optimizeSubmeshes (loader default) splits the model into one mesh
    // per material, index-aligned with metadata.materials — validated on
    // a real PMX (45/45). If a future loader path merges meshes, fall
    // back to alpha-zeroing the material.
    const mesh = this.materialMeshes[index];
    if (mesh && this.materialMeshes.length === this.materials.length) {
      mesh.setEnabled(visible);
      return;
    }
    const mat = this.materials[index];
    if (mat) mat.alpha = visible ? 1 : 0;
  }

  setMaterialAlpha(index: number, alpha: number): void {
    const mat = this.materials[index];
    if (mat) mat.alpha = Math.max(0, Math.min(1, alpha));
  }

  // ----- animations -----

  /** Play a bundled VMD by stem name. Procedural idle pauses while a
   *  motion drives the model (double-driving morphs looks broken). */
  async playAnimation(name: string): Promise<void> {
    const model = this.mmdModel;
    const rt = this.mmdRuntime;
    const file = this.vmdFiles.get(name);
    if (!model || !rt || !file) return;
    let handle = this.animationHandles.get(name);
    if (handle === undefined) {
      const loader = new VmdLoader(this.scene);
      loader.loggingEnabled = false;
      const animation = await loader.loadAsync(name, file);
      handle = model.createRuntimeAnimation(animation);
      this.animationHandles.set(name, handle);
    }
    model.setRuntimeAnimation(handle as never);
    this.playingAnimation = name;
    await rt.seekAnimation(0, true);
    await rt.playAnimation();
  }

  stopAnimation(): void {
    const model = this.mmdModel;
    const rt = this.mmdRuntime;
    if (!model || !rt) return;
    rt.pauseAnimation();
    model.setRuntimeAnimation(null);
    this.playingAnimation = null;
  }

  // ----- procedural idle (blink + breath) -----

  /**
   * Subtle life for motion-less models: eased blinks every 2.5–6s and a
   * slow breathing sway on the upper-body/head bones. Runs only while no
   * VMD is playing. Bone writes happen in onBeforeRender — babylon-mmd
   * computes its world matrices from the linked skeleton bones' local
   * transforms, so setting rotationQuaternion here composes with
   * physics/IK the same way a VMD keyframe would.
   */
  private startIdleDriver(): void {
    let nextBlinkAt = performance.now() + 1800;
    let blinkPhase = -1; // -1 = idle, otherwise 0..1 progress
    const BLINK_MS = 180;

    // Babylon's Bone.rotationQuaternion GETTER returns a copy — mutating
    // it does nothing. Always go through the setter with a scratch quat.
    const breathBone = this.skeletonBones.find((b) => b.name === BREATH_BONE) ?? null;
    const headBone = this.skeletonBones.find((b) => b.name === HEAD_BONE) ?? null;
    const breathRest = breathBone ? breathBone.rotationQuaternion.clone() : null;
    const headRest = headBone ? headBone.rotationQuaternion.clone() : null;
    const tmp = new Quaternion();
    const outQ = new Quaternion();

    this.idleObserver = this.scene.onBeforeRenderObservable.add(() => {
      if (this.playingAnimation) return;
      const now = performance.now();

      // breath — 4s period, ±0.02 rad pitch on 上半身, ±0.01 on 頭
      const t = (now % 4000) / 4000;
      const s = Math.sin(t * Math.PI * 2);
      if (breathBone && breathRest) {
        Quaternion.RotationYawPitchRollToRef(0, s * 0.02, 0, tmp);
        breathRest.multiplyToRef(tmp, outQ);
        breathBone.rotationQuaternion = outQ;
      }
      if (headBone && headRest) {
        Quaternion.RotationYawPitchRollToRef(0, -s * 0.01, 0, tmp);
        headRest.multiplyToRef(tmp, outQ);
        headBone.rotationQuaternion = outQ;
      }

      // blink — triangular ease in/out over BLINK_MS
      if (!this.blinkMorph) return;
      if (blinkPhase < 0) {
        if (now >= nextBlinkAt) blinkPhase = 0;
        else return;
      }
      blinkPhase = Math.min(1, blinkPhase + this.engine.getDeltaTime() / BLINK_MS);
      const w = blinkPhase < 0.5 ? blinkPhase * 2 : (1 - blinkPhase) * 2;
      this.setMorphWeight(this.blinkMorph, w);
      if (blinkPhase >= 1) {
        blinkPhase = -1;
        nextBlinkAt = now + 2500 + Math.random() * 3500;
        this.setMorphWeight(this.blinkMorph, 0);
      }
    });
  }

  // ----- capture / teardown -----

  async captureFrame(sizePx = 256): Promise<Blob | null> {
    if (this.disposed) return null;
    this.scene.render(); // ensure a fresh frame in the (preserved) buffer
    const src = this.canvas;
    if (!src.width || !src.height) return null;
    const scale = Math.min(sizePx / src.width, sizePx / src.height, 1);
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(src.width * scale));
    out.height = Math.max(1, Math.round(src.height * scale));
    const ctx = out.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(src, 0, 0, out.width, out.height);
    return await new Promise<Blob | null>((resolve) => {
      out.toBlob((b) => resolve(b), "image/webp", 0.85);
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.engine.stopRenderLoop(this.renderFrame);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.idleObserver) {
      this.scene.onBeforeRenderObservable.remove(this.idleObserver);
      this.idleObserver = null;
    }
    try {
      if (this.mmdModel && this.mmdRuntime) this.mmdRuntime.destroyMmdModel(this.mmdModel);
    } catch {
      /* model already gone */
    }
    try {
      this.physicsRuntime?.dispose();
    } catch {
      /* physics teardown is best-effort */
    }
    this.scene.dispose();
    this.engine.dispose();
    this.canvas.remove();
  }
}
