/**
 * VMD transform engine — the core of the in-app Motion Studio.
 *
 * Parses a VMD container, applies parametric edits, re-encodes. Works
 * on ANY motion (our generated presets and user uploads alike) because
 * scaling is *relative to each track's first keyframe*: presets start
 * at the neutral stance by design, and community motions overwhelmingly
 * open on their base pose, so "amplitude" edits scale the DEVIATION
 * from that pose instead of the absolute rotation (which would drag
 * rest offsets like the arm-down angle along and deform the stance).
 *
 * Format notes (all little-endian):
 *   header   30B magic + 20B model name
 *   bones    u32 n · [15B Shift-JIS name · u32 frame · 3f pos · 4f quat · 64B interp]
 *   morphs   u32 n · [15B name · u32 frame · f32 weight]
 *   camera   u32 n · [u32 frame · f32 dist · 3f pos · 3f rot · 24B interp · u32 fov · u8 persp]
 *   light    u32 n · [u32 frame · 3f rgb · 3f dir]
 *   shadow   u32 n · [u32 frame · u8 mode · f32 dist]
 *   ik       u32 n · [u32 frame · u8 visible · u32 k · k×(20B name · u8 on)]
 * Sections after bones are optional (many files simply end early); we
 * preserve whatever is present, renumbering frames on retime so camera
 * cuts stay in sync with the motion.
 */

export type MotionEditParams = {
  /** playback rate: 2 = twice as fast (half the frames) */
  speed: number;
  /** whole-body amplitude scale (rotations + root translation) */
  overall: number;
  /** group scales — multiply on top of `overall` */
  arms: number;
  head: number;
  torso: number;
  /** morph-weight scale (facial intensity) */
  face: number;
};

export const NEUTRAL_EDIT: MotionEditParams = {
  speed: 1,
  overall: 1,
  arms: 1,
  head: 1,
  torso: 1,
  face: 1,
};

type BoneFrame = {
  name: Uint8Array; // 15B raw — NEVER re-encoded (Shift-JIS fidelity)
  frame: number;
  pos: [number, number, number];
  quat: [number, number, number, number];
  interp: Uint8Array; // 64B raw
};
type MorphFrame = { name: Uint8Array; frame: number; weight: number };
type CameraFrame = { frame: number; rest: Uint8Array }; // 57B after the frame no.
type LightFrame = { frame: number; rest: Uint8Array }; // 24B
type ShadowFrame = { frame: number; rest: Uint8Array }; // 5B
type IkFrame = { frame: number; rest: Uint8Array }; // variable

export type ParsedVmd = {
  header: Uint8Array; // 50B
  bones: BoneFrame[];
  morphs: MorphFrame[];
  cameras: CameraFrame[];
  lights: LightFrame[];
  shadows: ShadowFrame[];
  iks: IkFrame[];
  /** true when the file ended before the ik section (all-optional tail) */
  truncatedTail: boolean;
};

export function parseVmd(bytes: Uint8Array): ParsedVmd {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 54) throw new Error("VMD 파일이 너무 짧습니다");
  let off = 50;
  const u32 = () => {
    const v = view.getUint32(off, true);
    off += 4;
    return v;
  };
  const f32 = () => {
    const v = view.getFloat32(off, true);
    off += 4;
    return v;
  };
  const raw = (n: number) => {
    const v = bytes.subarray(off, off + n);
    off += n;
    return v;
  };
  const eof = () => off >= bytes.length;

  const bones: BoneFrame[] = [];
  for (let i = 0, n = u32(); i < n; i++) {
    const name = raw(15);
    const frame = u32();
    const pos: [number, number, number] = [f32(), f32(), f32()];
    const quat: [number, number, number, number] = [f32(), f32(), f32(), f32()];
    bones.push({ name, frame, pos, quat, interp: raw(64) });
  }
  const morphs: MorphFrame[] = [];
  if (!eof())
    for (let i = 0, n = u32(); i < n; i++) {
      const name = raw(15);
      const frame = u32();
      morphs.push({ name, frame, weight: f32() });
    }
  const cameras: CameraFrame[] = [];
  if (!eof()) for (let i = 0, n = u32(); i < n; i++) cameras.push({ frame: u32(), rest: raw(57) });
  const lights: LightFrame[] = [];
  if (!eof()) for (let i = 0, n = u32(); i < n; i++) lights.push({ frame: u32(), rest: raw(24) });
  const shadows: ShadowFrame[] = [];
  if (!eof()) for (let i = 0, n = u32(); i < n; i++) shadows.push({ frame: u32(), rest: raw(5) });
  const iks: IkFrame[] = [];
  const truncatedTail = eof();
  if (!eof())
    for (let i = 0, n = u32(); i < n; i++) {
      const frame = u32();
      const start = off;
      off += 1; // visible
      const k = view.getUint32(off, true);
      off += 4 + k * 21;
      iks.push({ frame, rest: bytes.subarray(start, off) });
    }
  return {
    header: bytes.subarray(0, 50),
    bones,
    morphs,
    cameras,
    lights,
    shadows,
    iks,
    truncatedTail,
  };
}

export function encodeVmd(v: ParsedVmd): Uint8Array {
  let size = 50 + 4 + v.bones.length * 111 + 4 + v.morphs.length * 23;
  size += 4 + v.cameras.length * 61 + 4 + v.lights.length * 28 + 4 + v.shadows.length * 9;
  size += 4;
  for (const ik of v.iks) size += 4 + ik.rest.length;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let off = 0;
  const put = (b: Uint8Array) => {
    out.set(b, off);
    off += b.length;
  };
  const u32 = (n: number) => {
    view.setUint32(off, n, true);
    off += 4;
  };
  const f32 = (n: number) => {
    view.setFloat32(off, n, true);
    off += 4;
  };
  put(v.header);
  u32(v.bones.length);
  for (const b of v.bones) {
    put(b.name);
    u32(b.frame);
    for (const x of b.pos) f32(x);
    for (const x of b.quat) f32(x);
    put(b.interp);
  }
  u32(v.morphs.length);
  for (const m of v.morphs) {
    put(m.name);
    u32(m.frame);
    f32(m.weight);
  }
  u32(v.cameras.length);
  for (const c of v.cameras) {
    u32(c.frame);
    put(c.rest);
  }
  u32(v.lights.length);
  for (const l of v.lights) {
    u32(l.frame);
    put(l.rest);
  }
  u32(v.shadows.length);
  for (const s of v.shadows) {
    u32(s.frame);
    put(s.rest);
  }
  u32(v.iks.length);
  for (const ik of v.iks) {
    u32(ik.frame);
    put(ik.rest);
  }
  return out;
}

// ── bone grouping (Shift-JIS decode just for matching) ─────────────
let sjisDecoder: TextDecoder | null | undefined;
function decodeName(raw: Uint8Array): string {
  if (sjisDecoder === undefined) {
    try {
      sjisDecoder = new TextDecoder("shift_jis");
    } catch {
      sjisDecoder = null; // exotic runtime — group scales fall back to overall
    }
  }
  if (!sjisDecoder) return "";
  let end = raw.indexOf(0);
  if (end < 0) end = raw.length;
  try {
    return sjisDecoder.decode(raw.subarray(0, end));
  } catch {
    return "";
  }
}

type Group = "arms" | "head" | "torso" | "other";
function groupOf(name: string): Group {
  if (/肩|腕|ひじ|手/.test(name)) return "arms";
  if (/首|頭|目/.test(name)) return "head";
  if (/半身|腰/.test(name)) return "torso";
  return "other";
}

// ── quaternion power (slerp from identity) ─────────────────────────
function quatPow(q: [number, number, number, number], s: number): [number, number, number, number] {
  let [x, y, z, w] = q;
  // shortest arc
  if (w < 0) {
    x = -x;
    y = -y;
    z = -z;
    w = -w;
  }
  const len = Math.hypot(x, y, z);
  if (len < 1e-9) return [0, 0, 0, 1];
  const angle = 2 * Math.atan2(len, w) * s;
  const sin = Math.sin(angle / 2);
  return [(x / len) * sin, (y / len) * sin, (z / len) * sin, Math.cos(angle / 2)];
}
function quatMul(
  a: [number, number, number, number],
  b: [number, number, number, number],
): [number, number, number, number] {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}
function quatConj(q: [number, number, number, number]): [number, number, number, number] {
  return [-q[0], -q[1], -q[2], q[3]];
}

/** frame → frame under a speed change, collision-safe ordering left to
 *  the caller (later keys win in MMD runtimes on equal frames). */
const retime = (frame: number, speed: number) => Math.max(0, Math.round(frame / speed));

/** Apply parametric edits to a VMD. Returns fresh bytes. */
export function transformVmd(bytes: Uint8Array, params: MotionEditParams): Uint8Array {
  const v = parseVmd(bytes);
  const speed = Math.min(4, Math.max(0.25, params.speed || 1));

  // per-track first keyframe = the pose deviations are measured from
  const refByName = new Map<string, BoneFrame>();
  for (const b of v.bones) {
    const key = decodeName(b.name) || String(b.name.join(","));
    const ref = refByName.get(key);
    if (!ref || b.frame < ref.frame) refByName.set(key, b);
  }

  const bones: BoneFrame[] = v.bones.map((b) => {
    const name = decodeName(b.name);
    const key = name || String(b.name.join(","));
    const group = groupOf(name);
    const gScale =
      group === "arms"
        ? params.arms
        : group === "head"
          ? params.head
          : group === "torso"
            ? params.torso
            : 1;
    const s = Math.max(0, params.overall * gScale);
    const ref = refByName.get(key);
    let pos = b.pos;
    let quat = b.quat;
    if (ref && s !== 1) {
      pos = [
        ref.pos[0] + (b.pos[0] - ref.pos[0]) * s,
        ref.pos[1] + (b.pos[1] - ref.pos[1]) * s,
        ref.pos[2] + (b.pos[2] - ref.pos[2]) * s,
      ];
      // q' = q0 ⊗ (q0⁻¹ ⊗ q)^s — scale the deviation, keep the stance
      const delta = quatMul(quatConj(ref.quat), b.quat);
      quat = quatMul(ref.quat, quatPow(delta, s));
    }
    return { ...b, frame: retime(b.frame, speed), pos, quat };
  });

  const morphs: MorphFrame[] = v.morphs.map((m) => ({
    ...m,
    frame: retime(m.frame, speed),
    weight: Math.min(1, Math.max(0, m.weight * Math.max(0, params.face))),
  }));

  return encodeVmd({
    ...v,
    bones,
    morphs,
    cameras: v.cameras.map((c) => ({ ...c, frame: retime(c.frame, speed) })),
    lights: v.lights.map((l) => ({ ...l, frame: retime(l.frame, speed) })),
    shadows: v.shadows.map((s) => ({ ...s, frame: retime(s.frame, speed) })),
    iks: v.iks.map((ik) => ({ ...ik, frame: retime(ik.frame, speed) })),
  });
}

/** Quick metadata for the studio UI. */
export function vmdInfo(bytes: Uint8Array): {
  boneKeys: number;
  morphKeys: number;
  frames: number;
} {
  const v = parseVmd(bytes);
  let frames = 0;
  for (const b of v.bones) frames = Math.max(frames, b.frame);
  for (const m of v.morphs) frames = Math.max(frames, m.frame);
  return { boneKeys: v.bones.length, morphKeys: v.morphs.length, frames };
}
