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
