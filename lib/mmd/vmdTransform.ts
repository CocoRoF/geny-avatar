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
      // k comes from the file — bound it or a crafted count leaps past
      // EOF and we'd emit an ik record whose embedded k contradicts its
      // actual bytes (silent structural corruption on re-encode)
      if (off + 4 > bytes.length) throw new Error("VMD ik 섹션이 손상되었습니다");
      const k = view.getUint32(off, true);
      if (off + 4 + k * 21 > bytes.length) throw new Error("VMD ik 섹션이 손상되었습니다");
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

/** frame → frame under a speed change. Many-to-one for speed>1 — the
 *  caller MUST dedupe per track afterwards (see dedupeRetimed). */
const retime = (frame: number, speed: number) => Math.max(0, Math.round(frame / speed));

const fin = (x: number, fallback = 0) => (Number.isFinite(x) ? x : fallback);
const IDENTITY_Q: [number, number, number, number] = [0, 0, 0, 1];
function saneQuat(q: [number, number, number, number]): [number, number, number, number] {
  return q.every(Number.isFinite) ? q : IDENTITY_Q;
}

/** After a retime, several source keys can land on the same output
 *  frame. Keep the TEMPORALLY LAST source key per (track, frame) —
 *  otherwise the winner depends on record order in the file and a
 *  collision can freeze on a stale pose — and emit each track sorted
 *  by frame so downstream parsers see a canonical ordering. */
function dedupeRetimed<T extends { frame: number }>(
  items: T[],
  trackKey: (item: T) => string,
  origFrame: (item: T) => number,
): T[] {
  const tracks = new Map<string, Map<number, { item: T; orig: number }>>();
  const trackOrder: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const key = trackKey(item);
    let track = tracks.get(key);
    if (!track) {
      track = new Map();
      tracks.set(key, track);
      trackOrder.push(key);
    }
    const prev = track.get(item.frame);
    const orig = origFrame(item);
    if (!prev || orig >= prev.orig) track.set(item.frame, { item, orig });
  }
  const out: T[] = [];
  for (const key of trackOrder) {
    const entries = [...(tracks.get(key) as Map<number, { item: T; orig: number }>).values()];
    entries.sort((a, b) => a.item.frame - b.item.frame);
    for (const e of entries) out.push(e.item);
  }
  return out;
}

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

  const origFrames = new Map<object, number>();
  let bones: BoneFrame[] = v.bones.map((b) => {
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
    // corrupt floats (NaN/Inf) must not poison the math or the output —
    // sanitize to rest values before any arithmetic
    let pos: [number, number, number] = [fin(b.pos[0]), fin(b.pos[1]), fin(b.pos[2])];
    let quat = saneQuat(b.quat);
    if (ref && s !== 1) {
      const rp: [number, number, number] = [fin(ref.pos[0]), fin(ref.pos[1]), fin(ref.pos[2])];
      const rq = saneQuat(ref.quat);
      pos = [
        rp[0] + (pos[0] - rp[0]) * s,
        rp[1] + (pos[1] - rp[1]) * s,
        rp[2] + (pos[2] - rp[2]) * s,
      ];
      // q' = q0 ⊗ (q0⁻¹ ⊗ q)^s — scale the deviation, keep the stance
      const delta = quatMul(quatConj(rq), quat);
      quat = quatMul(rq, quatPow(delta, s));
    }
    const next = { ...b, frame: retime(b.frame, speed), pos, quat };
    origFrames.set(next, b.frame);
    return next;
  });
  // retime is injective for speed ≤ 1 (gaps ≥ 1/speed > 1 frame), so
  // dedupe only when collisions are possible — keeping the source's
  // record order otherwise preserves byte-identity for no-op edits
  if (speed > 1)
    bones = dedupeRetimed(
      bones,
      (b) => decodeName(b.name) || String(b.name.join(",")),
      (b) => origFrames.get(b) ?? b.frame,
    );

  // face === 1 must be a true identity (bones already skip on s === 1):
  // community VMDs legitimately carry out-of-range corrective weights
  // that a silent clamp would rewrite behind the user's back
  const faceScale = Math.max(0, params.face);
  let morphs: MorphFrame[] = v.morphs.map((m) => {
    const next = {
      ...m,
      frame: retime(m.frame, speed),
      weight: faceScale === 1 ? fin(m.weight) : Math.min(1, Math.max(0, fin(m.weight) * faceScale)),
    };
    origFrames.set(next, m.frame);
    return next;
  });
  if (speed > 1)
    morphs = dedupeRetimed(
      morphs,
      (m) => decodeName(m.name) || String(m.name.join(",")),
      (m) => origFrames.get(m) ?? m.frame,
    );

  const retimeSection = <T extends { frame: number }>(items: T[]): T[] => {
    const mapped = items.map((x) => {
      const next = { ...x, frame: retime(x.frame, speed) };
      origFrames.set(next, x.frame);
      return next;
    });
    if (speed <= 1) return mapped;
    return dedupeRetimed(
      mapped,
      () => "",
      (x) => origFrames.get(x) ?? x.frame,
    );
  };

  return encodeVmd({
    ...v,
    bones,
    morphs,
    cameras: retimeSection(v.cameras),
    lights: retimeSection(v.lights),
    shadows: retimeSection(v.shadows),
    iks: retimeSection(v.iks),
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
