import { Spine } from "@esotericsoftware/spine-pixi-v8";
import { Assets, type Container, type Texture as PixiTexture } from "pixi.js";
import { ID_PREFIX, newId } from "../avatar/id";
import type {
  Avatar,
  AvatarSource,
  Texture as DomainTexture,
  Layer,
  LayerId,
  NativeVariant,
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
  layerUnit: "slot",
  canChangeMesh: true,
  canSwapTexture: true,
  tinting: "rgba",
  hasAnimationTimeline: true,
  hasParameterGraph: false,
  hasPhysics: true,
};

/**
 * Wraps `@esotericsoftware/spine-pixi-v8`. One instance per loaded puppet.
 * The PoC validated the API shape; everything here is the same calls,
 * just behind our domain layer.
 */
export class SpineAdapter implements AvatarAdapter {
  readonly runtime = "spine" as const;
  readonly capabilities = CAPABILITIES;

  private spine: Spine | null = null;
  private layerByExternalId = new Map<string, Layer>();
  private slotIndexByExternalId = new Map<string, number>();
  private textureSourcesById = new Map<TextureId, TextureSourceInfo>();
  /** Live Pixi Texture per page — its `.source.resource` is what we
   *  swap out when masks are applied so the GPU re-uploads. */
  private pixiTextureById = new Map<TextureId, PixiTexture>();

  /**
   * Heuristic detection from filenames in a bundle. Real magic-byte parsing
   * (Spine binary header) lands when drag-drop upload lands.
   */
  static detect(filenames: ReadonlyArray<string>): FormatDetectionResult | null {
    const lower = filenames.map((f) => f.toLowerCase());
    const hasAtlas = lower.some((f) => f.endsWith(".atlas"));
    const hasSkel = lower.some((f) => f.endsWith(".skel"));
    const hasJson = lower.some((f) => f.endsWith(".json") && !f.endsWith(".model3.json"));
    if (hasAtlas && (hasSkel || hasJson)) {
      return { runtime: "spine", confidence: "high" };
    }
    return null;
  }

  async load(input: AdapterLoadInput): Promise<Avatar> {
    if (input.kind !== "spine") {
      throw new Error(`SpineAdapter cannot load input kind ${input.kind}`);
    }
    const aliasPrefix = input.aliasPrefix ?? `spine-${newId(ID_PREFIX.adapter)}`;
    const skelAlias = `${aliasPrefix}-skel`;
    const atlasAlias = `${aliasPrefix}-atlas`;

    Assets.add({ alias: skelAlias, src: input.skeleton });
    Assets.add({ alias: atlasAlias, src: input.atlas });
    await Assets.load([skelAlias, atlasAlias]);

    const spine = Spine.from({ skeleton: skelAlias, atlas: atlasAlias });
    this.spine = spine;

    // Walk the parsed atlas pages once to build the texture catalog. The
    // atlas object lives in Pixi Assets cache after load; SpineTexture
    // wraps a Pixi Texture which we extract for the source bitmap.
    const atlas = Assets.get(atlasAlias) as SpineAtlasLike | undefined;
    const textures: DomainTexture[] = [];
    const textureIdByPageName = new Map<string, TextureId>();
    if (atlas?.pages) {
      atlas.pages.forEach((page, idx) => {
        const info = pageToSourceInfo(page);
        if (!info) return;
        const id = newId(ID_PREFIX.texture);
        textureIdByPageName.set(page.name, id);
        this.textureSourcesById.set(id, info);
        const pixiTex = page.texture?.texture as PixiTexture | undefined;
        if (pixiTex) this.pixiTextureById.set(id, pixiTex);
        textures.push({
          id,
          pageIndex: idx,
          origin: "original",
          pixelSize: { w: info.width, h: info.height },
          data: { kind: "url", url: input.atlas },
        });
      });
    }

    const layers: Layer[] = spine.skeleton.slots.map((slot, i) => {
      const id = newId(ID_PREFIX.layer);
      const externalId = slot.data.name;
      const attachment = slot.getAttachment();
      this.slotIndexByExternalId.set(externalId, i);
      const slice = sliceFromAttachment(attachment, textureIdByPageName);
      const layer: Layer = {
        id,
        externalId,
        name: slot.data.name,
        // Attachment shape determines geometry. spine-pixi attachments expose
        // .type via instanceof at runtime; we keep this loose for now.
        geometry: attachment ? "region" : "other",
        texture: slice ?? undefined,
        defaults: {
          visible: !!attachment,
          color: { r: 1, g: 1, b: 1, a: 1 },
          opacity: 1,
        },
      };
      this.layerByExternalId.set(externalId, layer);
      return layer;
    });

    const animations = spine.state.data.skeletonData.animations.map((a) => ({
      name: a.name,
      duration: a.duration,
      loop: true,
      source: "spine-track" as const,
    }));

    const source: AvatarSource = {
      runtime: "spine",
      skeleton: { kind: "url", url: input.skeleton },
      atlas: { kind: "url", url: input.atlas },
      pages: [], // atlas-referenced pages — derive when atlas IO lands
    };

    const now = Date.now();
    const avatar: Avatar = {
      id: newId(ID_PREFIX.avatar),
      name: this.deriveName(input.skeleton),
      source,
      layers,
      groups: [],
      variants: [],
      textures,
      animations,
      parameters: [],
      metadata: { createdAt: now, updatedAt: now, schemaVersion: 1 },
    };
    return avatar;
  }

  getTextureSource(textureId: TextureId): TextureSourceInfo | null {
    return this.textureSourcesById.get(textureId) ?? null;
  }

  getLayerTriangles(layerId: LayerId): LayerTriangles | null {
    const spine = this.spine;
    if (!spine) return null;
    const layer = this.findLayerById(layerId);
    if (!layer?.texture) return null;
    const slotIndex = this.slotIndexByExternalId.get(layer.externalId);
    if (slotIndex == null) return null;
    const slot = spine.skeleton.slots[slotIndex];
    const attachment = slot.getAttachment() as SpineAttachmentLike | null;
    if (!attachment) return null;
    const region = attachment.region;
    if (!region?.page) return null;

    const pageW = region.page.width;
    const pageH = region.page.height;
    if (!pageW || !pageH) return null;

    // MeshAttachment carries its own UV array + triangle indices; we use
    // those verbatim. RegionAttachment is just the on-page rect, so we
    // fabricate a quad (2 triangles).
    const meshUVs = attachment.regionUVs;
    const meshTris = attachment.triangles;
    if (meshUVs && meshTris && meshUVs.length >= 6 && meshTris.length >= 3) {
      const out = new Float32Array(meshTris.length * 2);
      for (let i = 0; i < meshTris.length; i++) {
        const v = meshTris[i];
        out[i * 2] = meshUVs[v * 2];
        out[i * 2 + 1] = meshUVs[v * 2 + 1];
      }
      return { textureId: layer.texture.textureId, uvs: out };
    }

    // RegionAttachment fallback — quad covering the on-page rect.
    const u1 = region.x / pageW;
    const v1 = region.y / pageH;
    const u2 = (region.x + region.width) / pageW;
    const v2 = (region.y + region.height) / pageH;
    return {
      textureId: layer.texture.textureId,
      // prettier-ignore
      uvs: new Float32Array([u1, v1, u2, v1, u2, v2, u1, v1, u2, v2, u1, v2]),
    };
  }

  async setLayerOverrides(opts: {
    masks: Readonly<Record<LayerId, Blob>>;
    textures: Readonly<Record<LayerId, Blob>>;
  }): Promise<void> {
    await applyLayerOverrides(opts, {
      findLayer: (id) => this.findLayerById(id) ?? null,
      getTriangles: (id) => this.getLayerTriangles(id),
      textureSources: this.textureSourcesById,
      pixiTextures: this.pixiTextureById,
    });
  }

  getDisplayObject(): Container | null {
    return this.spine;
  }

  setLayerVisibility(layerId: LayerId, visible: boolean): void {
    const spine = this.spine;
    if (!spine) return;
    const layer = this.findLayerById(layerId);
    if (!layer) return;
    const slotIndex = this.slotIndexByExternalId.get(layer.externalId);
    if (slotIndex == null) return;
    const slot = spine.skeleton.slots[slotIndex];
    if (visible) {
      const name = slot.data.attachmentName;
      slot.setAttachment(name ? spine.skeleton.getAttachment(slotIndex, name) : null);
    } else {
      slot.setAttachment(null);
    }
  }

  setLayerColor(layerId: LayerId, color: RGBA): void {
    const spine = this.spine;
    if (!spine) return;
    const layer = this.findLayerById(layerId);
    if (!layer) return;
    const slotIndex = this.slotIndexByExternalId.get(layer.externalId);
    if (slotIndex == null) return;
    const slot = spine.skeleton.slots[slotIndex];
    slot.color.r = color.r;
    slot.color.g = color.g;
    slot.color.b = color.b;
    slot.color.a = color.a;
  }

  playAnimation(name: string): void {
    const spine = this.spine;
    if (!spine) return;
    spine.state.setAnimation(0, name, true);
  }

  /**
   * One Variant per Spine Skin in the puppet's skeleton data. The
   * synthetic "default" skin (always present, holds the setup-pose
   * attachments) is included so the user can revert after trying
   * other skins. Skin names are unique within a skeleton.
   */
  listNativeVariants(): NativeVariant[] {
    const spine = this.spine;
    if (!spine) return [];
    const skins = spine.skeleton.data.skins ?? [];
    return skins.map((skin) => ({
      source: "spine-skin" as const,
      externalId: skin.name,
      name: skin.name,
      applyData: { spineSkin: skin.name },
    }));
  }

  /**
   * Activate a Spine skin. After `setSkinByName` the skeleton holds a
   * different attachment per slot, but the live `Slot.attachment` field
   * still points at whatever the previous skin / animation set — we
   * call `setSlotsToSetupPose` so each slot picks up the new skin's
   * attachment immediately. Visibility overrides applied right after
   * still win because they go through `setLayerVisibility` (which calls
   * `slot.setAttachment(null)` for hide) on the same skeleton.
   */
  applyVariantData(data: VariantApplyData): void {
    const spine = this.spine;
    if (!spine) return;
    if (data.spineSkin === undefined) return;
    spine.skeleton.setSkinByName(data.spineSkin);
    spine.skeleton.setSlotsToSetupPose();
  }

  getActiveVariantData(): VariantApplyData {
    const spine = this.spine;
    if (!spine) return {};
    const name = spine.skeleton.skin?.name;
    return name ? { spineSkin: name } : {};
  }

  setParameter(_paramId: string, _value: number): void {
    // Spine has no parameter graph; capability flag should have prevented this.
  }

  getParameters() {
    return [];
  }

  destroy(): void {
    this.spine?.destroy();
    this.spine = null;
    this.layerByExternalId.clear();
    this.slotIndexByExternalId.clear();
    this.textureSourcesById.clear();
    this.pixiTextureById.clear();
  }

  // ----- helpers -----

  private findLayerById(layerId: LayerId): Layer | undefined {
    for (const layer of this.layerByExternalId.values()) {
      if (layer.id === layerId) return layer;
    }
    return undefined;
  }

  private deriveName(url: string): string {
    const file = url.split("/").pop() ?? url;
    return file.replace(/\.(skel|json)$/, "");
  }
}

// ----- duck-typed atlas helpers -----

/**
 * Subset of `TextureAtlas` (from `@esotericsoftware/spine-core`) that we
 * touch. Inlined to avoid pulling spine-core into this file's import
 * surface — spine-pixi-v8 already loads it transitively.
 */
type SpineAtlasLike = {
  pages: SpineAtlasPageLike[];
  regions: SpineAtlasRegionLike[];
};

type SpineAtlasPageLike = {
  name: string;
  width: number;
  height: number;
  /** SpineTexture at runtime — `.texture` is a Pixi `Texture`. */
  texture: { texture: { source?: { resource?: unknown; width?: number; height?: number } } } | null;
};

type SpineAtlasRegionLike = {
  name: string;
  page: SpineAtlasPageLike;
  /** top-left in atlas pixels, even when `degrees != 0` */
  x: number;
  y: number;
  /** on-page (post-rotation) dimensions */
  width: number;
  height: number;
  /** pre-rotation dimensions; used when we want to display upright */
  originalWidth: number;
  originalHeight: number;
  /** 0 or 90 in v4 atlases */
  degrees: number;
};

/**
 * Subset of `RegionAttachment` / `MeshAttachment` that we read for
 * triangle extraction. Mesh attachments expose `regionUVs` (per-vertex
 * UVs into the atlas page) and `triangles` (vertex indices). Region
 * attachments lack those — we synthesize a quad from the atlas region
 * itself.
 */
type SpineAttachmentLike = {
  region?: SpineAtlasRegionLike | null;
  /** Mesh: per-vertex UVs interleaved as `[u0, v0, u1, v1, ...]`. */
  regionUVs?: ArrayLike<number> | null;
  /** Mesh: triangle vertex indices, 3 per triangle. */
  triangles?: ArrayLike<number> | null;
};

function pageToSourceInfo(page: SpineAtlasPageLike): TextureSourceInfo | null {
  const pixiSource = page.texture?.texture?.source;
  const resource = pixiSource?.resource;
  if (!isCanvasImageSource(resource)) return null;
  const width = pixiSource?.width ?? page.width;
  const height = pixiSource?.height ?? page.height;
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
 * Pull the atlas region off an attachment (Region or Mesh) and translate
 * it into our domain `TextureSlice`. We use post-rotation `width/height`
 * for the atlas rect (matches the actual pixels on the page) and flip
 * `rotated: true` when the region is stored sideways so renderers can
 * un-rotate when displaying upright.
 */
function sliceFromAttachment(
  attachment: unknown,
  textureIdByPageName: Map<string, TextureId>,
): TextureSlice | null {
  const a = attachment as { region?: SpineAtlasRegionLike } | null;
  const region = a?.region;
  if (!region?.page) return null;
  const textureId = textureIdByPageName.get(region.page.name);
  if (!textureId) return null;
  return {
    textureId,
    rect: { x: region.x, y: region.y, w: region.width, h: region.height },
    rotated: region.degrees !== 0,
  };
}
