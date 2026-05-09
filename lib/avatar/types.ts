/**
 * Core domain types — runtime-agnostic. Both Spine and Cubism puppets are
 * normalized into this shape so the editor UI / store / persistence layer
 * never branches on the source runtime; only the adapter does.
 *
 * Reference: docs/plan/04_data_model.md
 */

// ----- IDs -----

export type AvatarId = string;
export type LayerId = string;
export type LayerGroupId = string;
export type TextureId = string;
export type VariantId = string;

// ----- Color / geometry primitives -----

export type RGBA = { r: number; g: number; b: number; a: number };

export type Rect = { x: number; y: number; w: number; h: number };

export type Polygon = { points: { x: number; y: number }[] };

export type UVIsland = { points: { u: number; v: number }[] };

// ----- Source / runtime metadata -----

export type AvatarSourceRuntime = "spine" | "live2d";

export type AssetRef =
  | { kind: "url"; url: string }
  | { kind: "idb"; key: string }
  | { kind: "inline"; bytes: Uint8Array };

export type AvatarSource =
  | {
      runtime: "spine";
      version?: string;
      skeleton: AssetRef;
      atlas: AssetRef;
      pages: AssetRef[];
    }
  | {
      runtime: "live2d";
      version?: string;
      model3: AssetRef;
      moc3: AssetRef;
      textures: AssetRef[];
      physics?: AssetRef;
      cdi?: AssetRef;
      pose?: AssetRef;
      userData?: AssetRef;
      motions?: { group: string; files: AssetRef[] }[];
    };

export type AssetOriginNote = {
  source:
    | "live2d-official"
    | "spine-official"
    | "inochi2d-official"
    | "community"
    | "self-made"
    | "unknown";
  url?: string;
  notes?: string;
};

// ----- Layers -----

export type LayerGeometry = "region" | "mesh" | "clipping" | "path" | "other";

export type Layer = {
  id: LayerId;
  /** runtime-native identifier (Spine slot name / Cubism part id / drawable index as string) */
  externalId: string;
  groupId?: LayerGroupId;
  name: string;
  geometry: LayerGeometry;
  texture?: TextureSlice;
  /** mesh outline used as ControlNet input for AI texture regeneration */
  silhouette?: Polygon;
  defaults: {
    visible: boolean;
    color: RGBA;
    opacity: number;
  };
  /**
   * Set when the puppet's own model files force this part hidden every
   * frame regardless of motion / parameter input — i.e. a previous
   * "Export Model" round-trip baked it into pose3.json. The visibility
   * toggle in the panel is effectively inert for these rows; the value
   * exists so the UI can mark them "baked-hidden" and tell the user
   * why their toggle does nothing.
   */
  bakedHidden?: boolean;
};

export type LayerGroup = {
  id: LayerGroupId;
  name: string;
  parentId?: LayerGroupId;
  layerIds: LayerId[];
  defaultVisible: boolean;
};

// ----- Textures -----

export type Texture = {
  id: TextureId;
  pageIndex: number;
  origin: "original" | "override";
  pixelSize: { w: number; h: number };
  data: AssetRef;
  generatedBy?: GenerationRecord;
};

export type TextureSlice = {
  textureId: TextureId;
  rect: Rect;
  rotated?: boolean;
  uvIslands?: UVIsland[];
};

export type GenerationRecord = {
  prompt: string;
  negativePrompt?: string;
  seed: number;
  baseModel: string;
  loras: { name: string; weight: number }[];
  controlnets: { name: string; weight: number }[];
  refImages?: AssetRef[];
  generatedAt: number;
};

// ----- Variants (skin / part-visibility presets) -----

export type Variant = {
  id: VariantId;
  name: string;
  description?: string;
  overrides: Record<
    LayerId,
    {
      visible?: boolean;
      color?: RGBA;
      opacity?: number;
      attachmentName?: string;
      textureId?: TextureId;
    }
  >;
  thumbnail?: AssetRef;
};

/**
 * Runtime-aware preset bundle that can be applied alongside layer
 * visibility. Spine has the most natural concept here — a "skin" swaps
 * a whole set of attachments at once. We thread these through the
 * adapter so the panel can apply them without knowing runtime details.
 *
 * The map is intentionally open-ended: future additions (e.g.
 * `live2dExpression`, `live2dPose`) drop in as new optional keys
 * without changing the call sites that don't care.
 */
export type VariantApplyData = {
  /** Spine skin name to set via `skeleton.setSkinByName(...)`. Absent
   *  means "leave the active skin alone". */
  spineSkin?: string;
};

/**
 * A preset that already exists inside the puppet bundle (a Spine Skin,
 * a Cubism part-group). The Variants panel surfaces these as "import
 * from puppet" so the user can save them as IDB variants and combine
 * with their own visibility tweaks.
 */
export type NativeVariantSource = "spine-skin" | "live2d-group";

export type NativeVariant = {
  source: NativeVariantSource;
  /** Stable runtime-native id — Spine skin name, Cubism group name. */
  externalId: string;
  /** Display name for the panel; usually equal to externalId. */
  name: string;
  description?: string;
  /** What `applyVariantData` should be called with to activate this.
   *  Empty `{}` is valid for runtimes (Cubism) where the preset is
   *  expressed entirely as a visibility map. */
  applyData: VariantApplyData;
  /** Optional visibility map keyed by `Layer.externalId`. Populated for
   *  runtimes whose native preset is "these parts visible, those parts
   *  hidden" rather than a single runtime call (e.g. Cubism cdi3 Part
   *  groups). Imported into `VariantRow.visibility` as-is. */
  visibility?: Record<string, boolean>;
};

// ----- Animations / parameters -----

export type AnimationRef = {
  name: string;
  duration?: number;
  loop: boolean;
  source: "spine-track" | "live2d-motion";
  /** for Live2D: motion group name (e.g. "Idle", "TapBody") */
  group?: string;
};

export type Parameter = {
  id: string;
  name: string;
  min: number;
  max: number;
  default: number;
  source: "live2d-param" | "spine-virtual";
};

// ----- Avatar root -----

export type Avatar = {
  id: AvatarId;
  name: string;
  source: AvatarSource;
  origin?: AssetOriginNote;
  layers: Layer[];
  groups: LayerGroup[];
  variants: Variant[];
  textures: Texture[];
  animations: AnimationRef[];
  parameters: Parameter[];
  metadata: {
    createdAt: number;
    updatedAt: number;
    schemaVersion: 1;
  };
};
