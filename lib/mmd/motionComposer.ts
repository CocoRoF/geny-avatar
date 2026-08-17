/**
 * Motion composer — the engine behind the Motion Studio's 모션 제작 tab.
 *
 * Users author POSES (semantic parameters per joint group) and place
 * them as KEYFRAMES on a timeline; this module interpolates the poses
 * with easing and bakes a standard VMD (bones @15fps keys + face
 * morphs @30fps), which then rides the exact same pipeline as every
 * other motion (preview, persist, export, Geny idle loop).
 *
 * The pose parameter space builds IN the hard-won probe laws so users
 * cannot produce the classic failure poses:
 *   - arms hang at roll ±1.0 (rest) and raise toward −1.1 (validated
 *     diagonal); axial yaw −0.9·raise and pitch −0.1·raise are COUPLED
 *     to the raise so the arm stays in/ahead of the body plane from the
 *     side (the "팔이 뒤로 꺾임" law).
 *   - elbow range depends on arm position: folded FORWARD (negative)
 *     at hang (validated clasp −0.6), and 0..0.95 when raised
 *     (validated wave 0.9) — the backward-fold zone is unreachable.
 *   - センター y only dips (legs bend via IK; raising just straightens).
 *
 * All angles are FILE-SPACE (raw VMD quat channels) — identical
 * conventions to scripts/generate-motion-presets.mjs.
 */

import { encodeVmd, type ParsedVmd } from "./vmdTransform";

// ── Shift-JIS name bytes (padded to 15B at encode) ─────────────────
const SJIS: Record<string, number[]> = {
  センター: [131, 90, 131, 147, 131, 94, 129, 91],
  下半身: [137, 186, 148, 188, 144, 103],
  上半身: [143, 227, 148, 188, 144, 103],
  上半身2: [143, 227, 148, 188, 144, 103, 50],
  首: [142, 241],
  頭: [147, 170],
  両目: [151, 188, 150, 218],
  右肩: [137, 69, 140, 168],
  左肩: [141, 182, 140, 168],
  右腕: [137, 69, 152, 114],
  左腕: [141, 182, 152, 114],
  右ひじ: [137, 69, 130, 208, 130, 182],
  左ひじ: [141, 182, 130, 208, 130, 182],
};
const MORPH_SJIS: Record<string, number[]> = {
  笑い: [143, 206, 130, 162],
  にこり: [130, 201, 130, 177, 130, 232],
  まばたき: [130, 220, 130, 206, 130, 189, 130, 171],
  困る: [141, 162, 130, 233],
  あ: [130, 160],
};
const INTERP = new Uint8Array([
  20, 20, 0, 0, 20, 20, 20, 20, 107, 107, 107, 107, 107, 107, 107, 107, 20, 20, 20, 20, 20, 20, 20,
  107, 107, 107, 107, 107, 107, 107, 107, 0, 20, 20, 20, 20, 20, 20, 107, 107, 107, 107, 107, 107,
  107, 107, 0, 0, 20, 20, 20, 20, 20, 107, 107, 107, 107, 107, 107, 107, 107, 0, 0, 0,
]);

function pad15(bytes: number[]): Uint8Array {
  const out = new Uint8Array(15);
  out.set(bytes.slice(0, 15));
  return out;
}

function quatYPR(yaw: number, pitch: number, roll: number): [number, number, number, number] {
  const cy = Math.cos(yaw / 2),
    sy = Math.sin(yaw / 2);
  const cp = Math.cos(pitch / 2),
    sp = Math.sin(pitch / 2);
  const cr = Math.cos(roll / 2),
    sr = Math.sin(roll / 2);
  return [
    cy * sp * cr + sy * cp * sr,
    sy * cp * cr - cy * sp * sr,
    cy * cp * sr - sy * sp * cr,
    cy * cp * cr + sy * sp * sr,
  ];
}

// ── pose parameter space ───────────────────────────────────────────

export type ArmPose = {
  /** 0 = arms-down rest · 1 = validated diagonal raise */
  raise: number;
  /** −1..1 extra side spread on top of the raise curve */
  spread: number;
  /** elbow bend −1..1: negative folds forward (hang), positive bends
   *  the raised arm (mapped into the probe-safe range per raise) */
  elbow: number;
};
export type PoseParams = {
  rightArm: ArmPose;
  leftArm: ArmPose;
  head: { yaw: number; pitch: number; roll: number }; // each −1..1
  torso: { yaw: number; pitch: number; roll: number }; // each −1..1
  center: { x: number; dip: number }; // x −1..1 (·0.9 units) · dip 0..1 (·1.3)
  /** face morph name → weight 0..1 (standard names or model morphs) */
  face: Record<string, number>;
};

export const REST_POSE: PoseParams = {
  rightArm: { raise: 0, spread: 0, elbow: 0 },
  leftArm: { raise: 0, spread: 0, elbow: 0 },
  head: { yaw: 0, pitch: 0, roll: 0 },
  torso: { yaw: 0, pitch: 0, roll: 0 },
  center: { x: 0, dip: 0 },
  face: {},
};

const ARM_REST = 1.0;
const ARM_RAISED = -1.1;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Right-arm semantic → file-space channels; left mirrors via sign. */
function armChannels(a: ArmPose, side: 1 | -1) {
  const raise = clamp(a.raise, 0, 1);
  const spread = clamp(a.spread, -1, 1);
  // roll travels rest→raised along the probed path; spread widens ±0.35
  const roll = ARM_REST + raise * (ARM_RAISED - ARM_REST) - spread * 0.35;
  // side-plane law: axial yaw and slight forward pitch are coupled to
  // the raise so the arm cannot drift behind the body plane
  const yaw = -0.9 * raise;
  const pitch = -0.1 * raise;
  // elbow: at hang the safe fold is FORWARD (negative, validated −0.6);
  // when raised the safe bend is 0..0.95 (validated 0.9)
  const e = clamp(a.elbow, -1, 1);
  const elbow = e >= 0 ? e * (0.15 + 0.8 * raise) : e * (0.85 - 0.6 * raise);
  const shoulder = -0.2 * raise;
  return {
    [side === 1 ? "右肩" : "左肩"]: { roll: side * shoulder },
    [side === 1 ? "右腕" : "左腕"]: {
      yaw: side * yaw,
      pitch,
      roll: side * roll,
    },
    [side === 1 ? "右ひじ" : "左ひじ"]: { yaw: side * (0.09 * (1 - Math.abs(e)) + elbow) },
  } as Record<string, { yaw?: number; pitch?: number; roll?: number }>;
}

type Channels = Record<string, { yaw?: number; pitch?: number; roll?: number; pos?: number[] }>;

export function poseToChannels(p: PoseParams): Channels {
  const head = {
    yaw: clamp(p.head.yaw, -1, 1) * 0.6,
    pitch: clamp(p.head.pitch, -1, 1) * 0.45,
    roll: clamp(p.head.roll, -1, 1) * 0.3,
  };
  const torso = {
    yaw: clamp(p.torso.yaw, -1, 1) * 0.45,
    pitch: clamp(p.torso.pitch, -1, 1) * 0.55,
    roll: clamp(p.torso.roll, -1, 1) * 0.25,
  };
  return {
    センター: { pos: [clamp(p.center.x, -1, 1) * 0.9, -clamp(p.center.dip, 0, 1) * 1.3, 0] },
    下半身: { yaw: -torso.yaw * 0.25, roll: -torso.roll * 0.3 },
    上半身: torso,
    上半身2: { yaw: torso.yaw * 0.3, pitch: torso.pitch * 0.3, roll: torso.roll * 0.3 },
    首: { yaw: head.yaw * 0.35, pitch: head.pitch * 0.35, roll: head.roll * 0.35 },
    頭: { yaw: head.yaw * 0.65, pitch: head.pitch * 0.65, roll: head.roll * 0.65 },
    ...armChannels(p.rightArm, 1),
    ...armChannels(p.leftArm, -1),
  };
}

// ── pose library (probe-validated) ─────────────────────────────────
export const POSE_LIBRARY: { id: string; label: string; pose: PoseParams }[] = [
  { id: "rest", label: "기본자세", pose: REST_POSE },
  {
    id: "clasp",
    label: "손모음",
    pose: {
      ...REST_POSE,
      rightArm: { raise: 0.04, spread: -0.1, elbow: -0.72 },
      leftArm: { raise: 0.04, spread: -0.1, elbow: -0.72 },
      face: { にこり: 0.2 },
    },
  },
  {
    id: "wave",
    label: "한손 인사",
    pose: {
      ...REST_POSE,
      rightArm: { raise: 1, spread: 0, elbow: 0.95 },
      leftArm: { raise: 0, spread: 0, elbow: 0 },
      head: { yaw: 0.15, pitch: 0, roll: 0.2 },
      torso: { yaw: 0.1, pitch: 0, roll: -0.15 },
      center: { x: -0.3, dip: 0.08 },
      face: { 笑い: 1, にこり: 0.5 },
    },
  },
  {
    id: "open",
    label: "양팔 벌리기",
    pose: {
      ...REST_POSE,
      rightArm: { raise: 0.55, spread: 0.7, elbow: 0.3 },
      leftArm: { raise: 0.55, spread: 0.7, elbow: 0.3 },
      head: { yaw: 0, pitch: 0.12, roll: 0 },
      face: { 笑い: 1, あ: 0.25 },
    },
  },
  {
    id: "bow",
    label: "인사(절)",
    pose: {
      ...REST_POSE,
      torso: { yaw: 0, pitch: -0.95, roll: 0 },
      head: { yaw: 0, pitch: -0.65, roll: 0 },
      center: { x: 0, dip: 0.42 },
      face: { まばたき: 0.9, にこり: 0.2 },
    },
  },
  {
    id: "think",
    label: "갸웃",
    pose: {
      ...REST_POSE,
      head: { yaw: 0.35, pitch: 0.1, roll: 0.6 },
      torso: { yaw: 0.15, pitch: 0, roll: 0.1 },
      face: { 困る: 0.5 },
    },
  },
];

// ── keyframes → VMD ────────────────────────────────────────────────

export type Easing = "smooth" | "linear" | "sharp-in" | "sharp-out";
export type MotionKeyframe = {
  id: string;
  /** seconds from motion start */
  t: number;
  pose: PoseParams;
  /** easing INTO this keyframe from the previous one */
  easing: Easing;
};

const ease = (kind: Easing, x: number): number => {
  const t = clamp(x, 0, 1);
  switch (kind) {
    case "linear":
      return t;
    case "sharp-in": // fast attack, slow settle (gravity)
      return 1 - (1 - t) ** 2.2;
    case "sharp-out": // slow build, snappy end
      return t ** 2.2;
    default:
      return t * t * (3 - 2 * t); // smoothstep
  }
};

function lerpPose(a: PoseParams, b: PoseParams, x: number): PoseParams {
  const l = (p: number, q: number) => p + (q - p) * x;
  const arm = (p: ArmPose, q: ArmPose): ArmPose => ({
    raise: l(p.raise, q.raise),
    spread: l(p.spread, q.spread),
    elbow: l(p.elbow, q.elbow),
  });
  const face: Record<string, number> = {};
  for (const k of new Set([...Object.keys(a.face), ...Object.keys(b.face)]))
    face[k] = l(a.face[k] ?? 0, b.face[k] ?? 0);
  return {
    rightArm: arm(a.rightArm, b.rightArm),
    leftArm: arm(a.leftArm, b.leftArm),
    head: {
      yaw: l(a.head.yaw, b.head.yaw),
      pitch: l(a.head.pitch, b.head.pitch),
      roll: l(a.head.roll, b.head.roll),
    },
    torso: {
      yaw: l(a.torso.yaw, b.torso.yaw),
      pitch: l(a.torso.pitch, b.torso.pitch),
      roll: l(a.torso.roll, b.torso.roll),
    },
    center: { x: l(a.center.x, b.center.x), dip: l(a.center.dip, b.center.dip) },
    face,
  };
}

export type BakeOptions = {
  /** append an eased return to the first pose so the loop is seamless */
  loopBack?: boolean;
  /** seconds for the loop-back segment (default 0.6) */
  loopBackSeconds?: number;
};

/** Evaluate the keyframe track at an absolute time (seconds). */
export function poseAt(keys: MotionKeyframe[], tSec: number): PoseParams {
  if (keys.length === 0) return REST_POSE;
  const sorted = [...keys].sort((a, b) => a.t - b.t);
  if (tSec <= sorted[0].t) return sorted[0].pose;
  for (let i = 1; i < sorted.length; i++) {
    if (tSec <= sorted[i].t) {
      const span = sorted[i].t - sorted[i - 1].t;
      const x = span <= 0 ? 1 : (tSec - sorted[i - 1].t) / span;
      return lerpPose(sorted[i - 1].pose, sorted[i].pose, ease(sorted[i].easing, x));
    }
  }
  return sorted[sorted.length - 1].pose;
}

/** Bake a keyframe sequence into VMD bytes. */
export function bakeMotion(keys: MotionKeyframe[], opts: BakeOptions = {}): Uint8Array {
  if (keys.length === 0) throw new Error("키프레임이 없습니다");
  const sorted = [...keys].sort((a, b) => a.t - b.t);
  let track = sorted;
  if (opts.loopBack && sorted.length > 1) {
    const back = Math.max(0.2, opts.loopBackSeconds ?? 0.6);
    track = [
      ...sorted,
      {
        id: "__loopback",
        t: sorted[sorted.length - 1].t + back,
        pose: sorted[0].pose,
        easing: "smooth",
      },
    ];
  }
  const durSec = track[track.length - 1].t;
  const totalFrames = Math.max(2, Math.round(durSec * 30));

  const bones: ParsedVmd["bones"] = [];
  const BONE_EVERY = 2;
  const frames: number[] = [];
  for (let f = 0; f <= totalFrames; f += BONE_EVERY) frames.push(f);
  if (frames[frames.length - 1] !== totalFrames) frames.push(totalFrames);
  for (const frame of frames) {
    const pose = poseAt(track, (frame / totalFrames) * durSec);
    const channels = poseToChannels(pose);
    for (const [name, ch] of Object.entries(channels)) {
      const sjis = SJIS[name];
      if (!sjis) continue;
      bones.push({
        name: pad15(sjis),
        frame,
        pos: (ch.pos ?? [0, 0, 0]) as [number, number, number],
        quat: quatYPR(ch.yaw ?? 0, ch.pitch ?? 0, ch.roll ?? 0),
        interp: INTERP,
      });
    }
  }

  const morphs: ParsedVmd["morphs"] = [];
  const morphNames = new Set<string>();
  for (const k of track) for (const n of Object.keys(k.pose.face)) morphNames.add(n);
  for (let frame = 0; frame <= totalFrames; frame++) {
    const pose = poseAt(track, (frame / totalFrames) * durSec);
    for (const name of morphNames) {
      const sjis = MORPH_SJIS[name];
      if (!sjis) continue; // model-specific morphs unsupported in v1 bake
      morphs.push({
        name: pad15(sjis),
        frame,
        weight: clamp(pose.face[name] ?? 0, 0, 1),
      });
    }
  }

  const header = new Uint8Array(50);
  const magic = "Vocaloid Motion Data 0002";
  for (let i = 0; i < magic.length; i++) header[i] = magic.charCodeAt(i);
  const modelName = "geny motion maker";
  for (let i = 0; i < modelName.length; i++) header[30 + i] = modelName.charCodeAt(i);

  return encodeVmd({
    header,
    bones,
    morphs,
    cameras: [],
    lights: [],
    shadows: [],
    iks: [],
    truncatedTail: false,
  });
}

/** A one-second static hold of a single pose — live pose preview. */
export function bakePoseHold(pose: PoseParams): Uint8Array {
  return bakeMotion(
    [
      { id: "a", t: 0, pose, easing: "linear" },
      { id: "b", t: 1, pose, easing: "linear" },
    ],
    {},
  );
}
