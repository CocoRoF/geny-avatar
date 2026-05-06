import { Spine } from "@esotericsoftware/spine-pixi-v8";
import { Assets, type Container } from "pixi.js";
import { ID_PREFIX, newId } from "../avatar/id";
import type { Avatar, AvatarSource, Layer, LayerId, RGBA } from "../avatar/types";
import type {
  AdapterCapabilities,
  AdapterLoadInput,
  AvatarAdapter,
  FormatDetectionResult,
} from "./AvatarAdapter";

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

    const layers: Layer[] = spine.skeleton.slots.map((slot, i) => {
      const id = newId(ID_PREFIX.layer);
      const externalId = slot.data.name;
      const attachment = slot.getAttachment();
      this.slotIndexByExternalId.set(externalId, i);
      const layer: Layer = {
        id,
        externalId,
        name: slot.data.name,
        // Attachment shape determines geometry. spine-pixi attachments expose
        // .type via instanceof at runtime; we keep this loose for now.
        geometry: attachment ? "region" : "other",
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
      textures: [],
      animations,
      parameters: [],
      metadata: { createdAt: now, updatedAt: now, schemaVersion: 1 },
    };
    return avatar;
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
