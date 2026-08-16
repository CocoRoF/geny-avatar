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
 * Conventions (validated on a real PMX in babylon-mmd):
 *   - 腕 Z +0.6rad lowers the RIGHT arm, −0.6 the LEFT (T→A pose)
 *   - ひじ +Y bends the forearm inward (flexion)
 *   - センター y is negative-down, in MMD units (≈0.08m per unit)
 *   - every preset starts AND ends at the neutral arms-down stance so
 *     the runtime's seamless looping never pops
 *   - pitch sign (validated visually): the model faces −Z in Babylon's
 *     left-handed space, so **positive pitch = lean back / look up,
 *     negative pitch = bow / nod forward**
 *   - VMD quats generated here behave sign-identical to Babylon bone
 *     quats (verified live: the arms-down keyframes render arms down)
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
  上半身: [143, 227, 148, 188, 144, 103],
  頭: [147, 170],
  両目: [151, 188, 150, 218],
  右肩: [137, 69, 140, 168],
  左肩: [141, 182, 140, 168],
  右腕: [137, 69, 152, 114],
  左腕: [141, 182, 152, 114],
  右ひじ: [137, 69, 130, 208, 130, 182],
  左ひじ: [141, 182, 130, 208, 130, 182],
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
/** eased rise a→b then fall c→d, flat 1 in between (a<b<=c<d) */
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

// ── preset channel definitions ─────────────────────────────────────
// Each returns {boneName: {pos?:[x,y,z], yaw?, pitch?, roll?}} at t∈[0,1].
// Arms must be spelled out — a VMD owns its bones completely.

const armsDown = (driftR = 0, driftL = 0) => ({
  右腕: { roll: ARM + driftR },
  左腕: { roll: -(ARM + driftL) },
});

const PRESETS = [
  {
    id: "idle-breeze",
    label: "잔잔한 아이들",
    description: "호흡과 느린 체중 이동 — 기본 대기 모션",
    seconds: 8,
    channels(t) {
      const breath = Math.sin(TAU * 2 * t);
      const sway = Math.sin(TAU * t);
      return {
        センター: { pos: [0.1 * sway, -0.09 + 0.09 * Math.cos(TAU * 2 * t), 0] },
        上半身: { pitch: 0.032 * breath, yaw: 0.02 * sway },
        頭: { pitch: -0.016 * breath, yaw: -0.014 * sway },
        ...armsDown(0.018 * breath, 0.018 * breath),
      };
    },
  },
  {
    id: "idle-groove",
    label: "리듬 아이들",
    description: "가볍게 리듬 타는 대기 모션",
    seconds: 4,
    channels(t) {
      const beat = TAU * 2 * t; // two grooves per loop
      const bob = (1 - Math.cos(beat)) / 2; // 0..1..0 twice
      return {
        センター: { pos: [0, -0.35 * bob, 0] },
        上半身: { roll: 0.045 * Math.sin(beat / 2 + Math.PI / 4), pitch: -0.025 * bob },
        頭: { roll: -0.03 * Math.sin(beat / 2 + Math.PI / 4), pitch: 0.02 * bob },
        ...armsDown(0.07 * bob, 0.07 * bob),
      };
    },
  },
  {
    id: "greeting-wave",
    label: "손 인사",
    description: "오른손을 들어 흔드는 인사",
    seconds: 5,
    channels(t) {
      // raise (0→0.18) · wave ×3 (0.18→0.78) · lower (0.78→1)
      //
      // Idol-style whole-arm wave: the elbow's fold plane at a raised
      // arm points down-forward (probed), so a folded-forearm wave
      // reads as "limp hand" — waving the whole raised arm instead is
      // unambiguous from any distance.
      const lift = window_(t, 0.0, 0.18, 0.78, 0.98);
      const wavePhase = Math.min(1, Math.max(0, (t - 0.18) / 0.6));
      const wave = Math.sin(TAU * 3 * wavePhase) * window_(t, 0.16, 0.24, 0.72, 0.8);
      return {
        センター: { pos: [0, -0.06 * lift, 0] },
        上半身: { roll: -0.06 * lift },
        頭: { roll: 0.09 * lift, yaw: 0.05 * lift },
        // ARM(down) → −1.35 (raised high) + whole-arm wag
        右腕: { roll: ARM + lift * (-1.35 - ARM) + 0.16 * wave },
        // slight natural elbow give, breathing with the wag
        右ひじ: { yaw: lift * (0.25 + 0.1 * wave) },
        左腕: { roll: -ARM },
      };
    },
  },
  {
    id: "bow",
    label: "정중한 인사",
    description: "허리 숙여 인사 (절)",
    seconds: 5,
    channels(t) {
      // down (0.08→0.3) · hold (0.3→0.62) · up (0.62→0.9)
      const w = window_(t, 0.08, 0.3, 0.62, 0.9);
      return {
        センター: { pos: [0, -0.3 * w, 0] },
        上半身: { pitch: -0.5 * w },
        頭: { pitch: -0.14 * w },
        ...armsDown(0.1 * w, 0.1 * w),
      };
    },
  },
  {
    id: "nod",
    label: "끄덕끄덕",
    description: "고개를 두 번 끄덕임 (긍정)",
    seconds: 2.5,
    channels(t) {
      const g = window_(t, 0.05, 0.2, 0.8, 0.95);
      const nod = Math.max(0, Math.sin(TAU * 2 * t)) * g;
      return {
        頭: { pitch: -0.24 * nod },
        上半身: { pitch: -0.03 * nod },
        ...armsDown(),
      };
    },
  },
  {
    id: "head-shake",
    label: "도리도리",
    description: "고개를 좌우로 흔듦 (부정)",
    seconds: 2.5,
    channels(t) {
      const g = window_(t, 0.05, 0.2, 0.8, 0.95);
      return {
        頭: { yaw: 0.24 * Math.sin(TAU * 2.5 * t) * g },
        両目: { yaw: 0.05 * Math.sin(TAU * 2.5 * t) * g },
        ...armsDown(),
      };
    },
  },
  {
    id: "happy-bounce",
    label: "신나는 점프",
    description: "기쁨 표현 — 통통 뛰기",
    seconds: 4,
    channels(t) {
      const hop = Math.abs(Math.sin(TAU * 2 * t)); // two hops
      const squash = Math.max(0, -Math.sin(TAU * 4 * t)) * 0.4;
      const g = window_(t, 0.02, 0.12, 0.88, 0.98);
      return {
        センター: { pos: [0, (0.45 * hop * hop - 0.18 * squash) * g, 0] },
        上半身: { pitch: 0.04 * hop * g, roll: 0.03 * Math.sin(TAU * t) * g },
        頭: { pitch: 0.07 * hop * g },
        // arms flare outward on the hops
        右腕: { roll: ARM - 0.28 * hop * g },
        左腕: { roll: -(ARM - 0.28 * hop * g) },
      };
    },
  },
  {
    id: "look-around",
    label: "두리번",
    description: "좌우를 둘러보는 시선 이동",
    seconds: 6,
    channels(t) {
      // left (0.06→0.2 hold →0.38) · right (0.46→0.6 hold →0.82)
      const L = window_(t, 0.06, 0.18, 0.3, 0.42);
      const R = window_(t, 0.46, 0.58, 0.7, 0.84);
      const yaw = 0.42 * L - 0.42 * R;
      return {
        頭: { yaw, pitch: 0.02 * (L + R) },
        両目: { yaw: 0.1 * L - 0.1 * R },
        上半身: { yaw: 0.12 * L - 0.12 * R },
        ...armsDown(),
      };
    },
  },
  {
    id: "sway-dance",
    label: "리듬 스윙",
    description: "좌우로 스텝 밟는 가벼운 춤",
    seconds: 8,
    channels(t) {
      const beat = TAU * 2 * t; // two full L-R cycles
      const side = Math.sin(beat);
      const bob = Math.abs(Math.cos(beat));
      const g = window_(t, 0.02, 0.1, 0.9, 0.98);
      return {
        センター: { pos: [0.5 * side * g, -0.25 * (1 - bob) * g, 0] },
        上半身: { roll: 0.07 * side * g, yaw: 0.06 * Math.sin(beat / 2) * g },
        頭: { roll: -0.05 * side * g },
        右腕: { roll: ARM + 0.16 * side * g },
        左腕: { roll: -(ARM - 0.16 * side * g) },
      };
    },
  },
];

// ── VMD encoder ────────────────────────────────────────────────────
function encodeVmd(modelName, boneFrames) {
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
  writeAscii(modelName, 20);

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
  const SAMPLE_EVERY = 3;
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
  const bytes = encodeVmd("geny preset", frames);
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
