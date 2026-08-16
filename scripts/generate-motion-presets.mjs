#!/usr/bin/env node
/**
 * First-party MMD motion presets — generated, not downloaded.
 *
 * Distributed VMD motions almost always carry usage terms that forbid
 * redistribution, so the editor can't bundle any of them. Instead this
 * script *authors* a small library of motions mathematically (eased
 * bone channels sampled to VMD keyframes) — 100% our own work, freely
 * shippable under the repo license.
 *
 * Output: public/motions/<id>.vmd + public/motions/manifest.json
 * Regenerate: `pnpm gen:motions` (deterministic — no RNG).
 *
 * ── Articulation rules (v2 — "관절을 제대로" feedback) ──────────────
 * A motion reads as natural only when whole JOINT CHAINS move:
 *   - arms: 肩(shoulder ~25%) → 腕(upper arm) → ひじ(elbow) together
 *   - head: 首(neck ~35%) → 頭 together, 上半身 leads underneath
 *   - torso: 下半身 counters 上半身 so hips stay believable
 *   - legs: センター DOWN/side motion works beautifully (leg IK bends
 *     the knees, feet stay planted). センター UP just straightens the
 *     legs, and 足ＩＫ POSITION tracks proved unreliable through this
 *     pipeline (constant-pose probes: feet never left the floor) — so
 *     ALL presets are grounded by design; no airborne phases.
 *
 * ── Coordinate conventions (validated on a real PMX) ───────────────
 *   - CHANNELS ARE FILE-SPACE (raw VMD quats). The VMD pipeline's axis
 *     semantics do NOT transfer 1:1 from direct Babylon bone probes and
 *     resist a single clean mirror rule (A/B matrix tested) — so the
 *     iron law is: EVERY new pose gets validated through the vmd-play
 *     probe (scratchpad rig), never through direct-bone probing alone.
 *   - probed file-space facts on a real PMX:
 *       腕 roll +0.6 lowers the RIGHT arm (−0.6 left) · torso/head
 *       pitch − = bow/nod forward · articulated raised wave =
 *       肩 roll −0.25 + 腕 {pitch +0.45, roll −1.15} + ひじ yaw +1.0
 *       (pitch −0.45 turns the same combo into a straight-arm pole)
 *   - センター y is negative-down, MMD units (≈0.08 m per unit)
 *   - every preset starts AND ends at the neutral arms-down stance so
 *     seamless looping never pops
 *   - VMD quats generated here behave sign-identical to Babylon bone
 *     quats (verified live)
 *
 * Bone names must be Shift-JIS in the container; Node has no Shift-JIS
 * encoder, so the byte sequences are precomputed constants.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "motions");

// ── Shift-JIS bone name bytes ──────────────────────────────────────
const BONE_SJIS = {
  センター: [131, 90, 131, 147, 131, 94, 129, 91],
  下半身: [137, 186, 148, 188, 144, 103],
  上半身: [143, 227, 148, 188, 144, 103],
  首: [142, 241],
  頭: [147, 170],
  両目: [151, 188, 150, 218],
  右肩: [137, 69, 140, 168],
  左肩: [141, 182, 140, 168],
  右腕: [137, 69, 152, 114],
  左腕: [141, 182, 152, 114],
  右ひじ: [137, 69, 130, 208, 130, 182],
  左ひじ: [141, 182, 130, 208, 130, 182],
  // leg IK targets — fullwidth ＩＫ, the standard MMD naming
  右足ＩＫ: [137, 69, 145, 171, 130, 104, 130, 106],
  左足ＩＫ: [141, 182, 145, 171, 130, 104, 130, 106],
};

// canonical MMD default interpolation block (64 bytes)
const INTERP = new Uint8Array([
  20, 20, 0, 0, 20, 20, 20, 20, 107, 107, 107, 107, 107, 107, 107, 107, 20, 20, 20, 20, 20, 20, 20,
  107, 107, 107, 107, 107, 107, 107, 107, 0, 20, 20, 20, 20, 20, 20, 107, 107, 107, 107, 107, 107,
  107, 107, 0, 0, 20, 20, 20, 20, 20, 107, 107, 107, 107, 107, 107, 107, 107, 0, 0, 0,
]);

// ── math helpers ───────────────────────────────────────────────────
const TAU = Math.PI * 2;
/** smoothstep 0..1 */
const ss = (x) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};
/** eased rise a→b, hold, eased fall c→d (a<b<=c<d) */
const window_ = (t, a, b, c, d) => {
  if (t <= a || t >= d) return 0;
  if (t < b) return ss((t - a) / (b - a));
  if (t <= c) return 1;
  return 1 - ss((t - c) / (d - c));
};

/** yaw(Y)→pitch(X)→roll(Z) quaternion — same composition Babylon's
 *  RotationYawPitchRoll uses, matching the runtime's idle driver. */
function quatYPR(yaw, pitch, roll) {
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

const ARM = 0.6; // rest-pose arm-down angle

// ── articulation helpers ───────────────────────────────────────────
// Arms as a chain: shoulder carries ~25% of the intent, elbow adds a
// soft bend so the arm never reads as a rigid rod.
const armChainR = (lower = 0, elbow = 0.06, shoulder = 0) => ({
  右肩: { roll: shoulder },
  右腕: { roll: ARM + lower },
  右ひじ: { yaw: elbow },
});
const armChainL = (lower = 0, elbow = 0.06, shoulder = 0) => ({
  左肩: { roll: -shoulder },
  左腕: { roll: -(ARM + lower) },
  左ひじ: { yaw: -elbow },
});
// Head as a chain: neck leads at ~35%.
const headChain = (yaw = 0, pitch = 0, roll = 0) => ({
  首: { yaw: yaw * 0.35, pitch: pitch * 0.35, roll: roll * 0.35 },
  頭: { yaw: yaw * 0.65, pitch: pitch * 0.65, roll: roll * 0.65 },
});

const PRESETS = [
  {
    id: "idle-breeze",
    label: "잔잔한 아이들",
    description: "호흡·체중 이동·어깨 결 — 기본 대기 모션",
    seconds: 8,
    channels(t) {
      const breath = Math.sin(TAU * 2 * t);
      const sway = Math.sin(TAU * t);
      return {
        センター: { pos: [0.1 * sway, -0.09 + 0.09 * Math.cos(TAU * 2 * t), 0] },
        下半身: { yaw: -0.01 * sway, roll: 0.008 * sway },
        上半身: { pitch: 0.032 * breath, yaw: 0.02 * sway },
        ...headChain(-0.02 * sway, -0.02 * breath, 0),
        ...armChainR(0.02 * breath, 0.07 + 0.02 * breath, -0.012 * breath),
        ...armChainL(0.02 * breath, 0.07 + 0.02 * breath, -0.012 * breath),
      };
    },
  },
  {
    id: "idle-groove",
    label: "리듬 아이들",
    description: "무릎으로 리듬 타는 대기 모션 (다리는 IK 로 자연 굽힘)",
    seconds: 4,
    channels(t) {
      const beat = TAU * 2 * t;
      const bob = (1 - Math.cos(beat)) / 2; // 0..1..0 twice
      const lean = Math.sin(beat / 2 + Math.PI / 4);
      return {
        センター: { pos: [0, -0.4 * bob, 0] },
        下半身: { roll: -0.025 * lean },
        上半身: { roll: 0.05 * lean, pitch: -0.03 * bob },
        ...headChain(0, 0.03 * bob, -0.035 * lean),
        ...armChainR(0.09 * bob, 0.1 + 0.08 * bob, -0.03 * bob),
        ...armChainL(0.09 * bob, 0.1 + 0.08 * bob, -0.03 * bob),
      };
    },
  },
  {
    id: "greeting-wave",
    label: "손 인사",
    description: "어깨-팔-팔꿈치가 함께 움직이는 손 인사",
    seconds: 5,
    channels(t) {
      // raise (0→0.2) · wave ×3 (0.2→0.76) · lower (0.76→0.98)
      const lift = window_(t, 0.0, 0.2, 0.76, 0.98);
      const wavePhase = Math.min(1, Math.max(0, (t - 0.2) / 0.56));
      const wave = Math.sin(TAU * 3 * wavePhase) * window_(t, 0.18, 0.26, 0.7, 0.78);
      return {
        センター: { pos: [0, -0.06 * lift, 0] },
        下半身: { roll: 0.02 * lift },
        上半身: { roll: -0.06 * lift },
        ...headChain(0.06 * lift, 0, 0.1 * lift),
        // probed articulated pose: shoulder −0.25 · arm {pitch −0.45,
        // roll −1.15} · elbow ~1.0, oscillating at the elbow + wrist arc
        右肩: { roll: -0.25 * lift },
        右腕: { pitch: 0.45 * lift, roll: ARM + lift * (-1.15 - ARM) + 0.05 * wave },
        右ひじ: { yaw: lift * (1.0 + 0.32 * wave) },
        ...armChainL(0.02 * lift, 0.08, -0.02 * lift),
      };
    },
  },
  {
    id: "bow",
    label: "정중한 인사",
    description: "목-허리-엉덩이가 순서대로 접히는 절",
    seconds: 5,
    channels(t) {
      // down (0.08→0.3) · hold (0.3→0.62) · up (0.62→0.9)
      const w = window_(t, 0.08, 0.3, 0.62, 0.9);
      // neck bows a beat earlier than the spine — reads as politeness
      const wHead = window_(t, 0.05, 0.26, 0.64, 0.92);
      return {
        センター: { pos: [0, -0.32 * w, 0] },
        下半身: { pitch: -0.1 * w },
        上半身: { pitch: -0.42 * w },
        ...headChain(0, -0.22 * wHead, 0),
        ...armChainR(0.12 * w, 0.1 + 0.06 * w, 0.03 * w),
        ...armChainL(0.12 * w, 0.1 + 0.06 * w, 0.03 * w),
      };
    },
  },
  {
    id: "nod",
    label: "끄덕끄덕",
    description: "목과 머리가 함께 끄덕임 (긍정)",
    seconds: 2.5,
    channels(t) {
      const g = window_(t, 0.05, 0.2, 0.8, 0.95);
      const nod = Math.max(0, Math.sin(TAU * 2 * t)) * g;
      return {
        上半身: { pitch: -0.03 * nod },
        ...headChain(0, -0.3 * nod, 0),
        ...armChainR(),
        ...armChainL(),
      };
    },
  },
  {
    id: "head-shake",
    label: "도리도리",
    description: "목-머리-시선이 함께 도는 부정 표현",
    seconds: 2.5,
    channels(t) {
      const g = window_(t, 0.05, 0.2, 0.8, 0.95);
      const shake = Math.sin(TAU * 2.5 * t) * g;
      return {
        上半身: { yaw: 0.03 * shake },
        ...headChain(0.3 * shake, 0, 0),
        両目: { yaw: 0.06 * shake },
        ...armChainR(),
        ...armChainL(),
      };
    },
  },
  {
    id: "happy-bounce",
    label: "신나는 바운스",
    description: "무릎으로 통통 튀는 기쁨 표현 (지면 바운스)",
    seconds: 4,
    channels(t) {
      // grounded design: deep knee dips + tiny leg-extension pops —
      // センター down bends the knees via IK (proven); real airborne
      // hops are impossible without reliable 足ＩＫ tracks (see header)
      const beat = TAU * 2 * t; // two bounces
      const dip = Math.max(0, Math.sin(beat)); // knee dips
      const popUp = Math.max(0, -Math.sin(beat)) * 0.35; // heel-pop rise
      const g = window_(t, 0.02, 0.1, 0.88, 0.98);
      const d = dip * g;
      const u = popUp * g;
      return {
        センター: { pos: [0, -0.6 * d + 0.22 * u, 0] },
        下半身: { pitch: -0.04 * d },
        上半身: { pitch: 0.07 * d - 0.04 * u, roll: 0.03 * Math.sin(TAU * t) * g },
        ...headChain(0, 0.12 * d - 0.06 * u, 0),
        // arms flare out on the pop, tuck slightly into the dip
        右肩: { roll: -0.1 * u },
        右腕: { roll: ARM - 0.5 * u + 0.12 * d },
        右ひじ: { yaw: 0.12 + 0.2 * u + 0.1 * d },
        左肩: { roll: 0.1 * u },
        左腕: { roll: -(ARM - 0.5 * u + 0.12 * d) },
        左ひじ: { yaw: -(0.12 + 0.2 * u + 0.1 * d) },
      };
    },
  },
  {
    id: "look-around",
    label: "두리번",
    description: "몸통-목-머리-눈이 순서대로 도는 시선 이동",
    seconds: 6,
    channels(t) {
      const L = window_(t, 0.06, 0.18, 0.3, 0.42);
      const R = window_(t, 0.46, 0.58, 0.7, 0.84);
      const dir = L - R;
      return {
        下半身: { yaw: -0.04 * dir },
        上半身: { yaw: 0.14 * dir },
        ...headChain(0.42 * dir, 0.02 * (L + R), 0),
        両目: { yaw: 0.12 * dir },
        ...armChainR(0.01 * (L + R), 0.07, 0),
        ...armChainL(0.01 * (L + R), 0.07, 0),
      };
    },
  },
  {
    id: "sway-dance",
    label: "리듬 스윙",
    description: "체중 이동에 발뒤꿈치가 따라오는 좌우 스윙",
    seconds: 8,
    channels(t) {
      const beat = TAU * 2 * t; // two full L-R cycles
      const side = Math.sin(beat);
      const bob = Math.abs(Math.cos(beat));
      const g = window_(t, 0.02, 0.1, 0.9, 0.98);
      const s = side * g;
      return {
        センター: { pos: [0.45 * s, -0.22 * (1 - bob) * g, 0] },
        下半身: { roll: -0.05 * s },
        上半身: { roll: 0.08 * s, yaw: 0.05 * Math.sin(beat / 2) * g },
        ...headChain(0, 0, -0.06 * s),
        右肩: { roll: -0.04 * Math.max(0, -s) },
        右腕: { roll: ARM + 0.18 * s },
        右ひじ: { yaw: 0.1 + 0.06 * Math.max(0, s) },
        左肩: { roll: 0.04 * Math.max(0, s) },
        左腕: { roll: -(ARM - 0.18 * s) },
        左ひじ: { yaw: -(0.1 + 0.06 * Math.max(0, -s)) },
      };
    },
  },
];

// ── VMD encoder ────────────────────────────────────────────────────
function encodeVmd(boneFrames) {
  const HEADER = 30 + 20;
  const size = HEADER + 4 + boneFrames.length * 111 + 4 * 5;
  const buf = new ArrayBuffer(size);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let off = 0;

  const writeAscii = (text, len) => {
    for (let i = 0; i < text.length && i < len; i++) bytes[off + i] = text.charCodeAt(i);
    off += len;
  };
  writeAscii("Vocaloid Motion Data 0002", 30);
  writeAscii("geny preset", 20);

  view.setUint32(off, boneFrames.length, true);
  off += 4;
  for (const f of boneFrames) {
    bytes.set(f.nameSjis, off); // zero-padded to 15 by buffer init
    off += 15;
    view.setUint32(off, f.frame, true);
    off += 4;
    for (const v of f.pos) {
      view.setFloat32(off, v, true);
      off += 4;
    }
    for (const v of f.quat) {
      view.setFloat32(off, v, true);
      off += 4;
    }
    bytes.set(INTERP, off);
    off += 64;
  }
  // morph / camera / light / self-shadow / ik-display sections: empty
  for (let i = 0; i < 5; i++) {
    view.setUint32(off, 0, true);
    off += 4;
  }
  return bytes;
}

// ── sample presets → files ─────────────────────────────────────────
mkdirSync(OUT_DIR, { recursive: true });
const manifest = [];
for (const preset of PRESETS) {
  const totalFrames = Math.round(preset.seconds * 30);
  const SAMPLE_EVERY = 2; // dense keys — VMD lerp stays imperceptible
  const frames = [];
  for (let frame = 0; frame <= totalFrames; frame += SAMPLE_EVERY) {
    const t = frame / totalFrames;
    const channels = preset.channels(t);
    for (const [bone, ch] of Object.entries(channels)) {
      const nameSjis = BONE_SJIS[bone];
      if (!nameSjis) throw new Error(`no Shift-JIS bytes for bone ${bone}`);
      frames.push({
        nameSjis,
        frame,
        pos: ch.pos ?? [0, 0, 0],
        quat: quatYPR(ch.yaw ?? 0, ch.pitch ?? 0, ch.roll ?? 0),
      });
    }
  }
  const bytes = encodeVmd(frames);
  writeFileSync(join(OUT_DIR, `${preset.id}.vmd`), bytes);
  manifest.push({
    id: preset.id,
    file: `${preset.id}.vmd`,
    label: preset.label,
    description: preset.description,
    seconds: preset.seconds,
  });
  console.log(`  ${preset.id}.vmd — ${frames.length} keys, ${bytes.length} bytes`);
}
writeFileSync(join(OUT_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${PRESETS.length} presets + manifest → public/motions/`);
