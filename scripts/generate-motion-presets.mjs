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
 * ── Face rules (v4 — expression pass) ──────────────────────────────
 * Bones alone read as robotic no matter how good the easing is; the
 * face has to join the gesture. Every preset therefore also authors
 * MORPH tracks using the de-facto standard Japanese morph names
 * (笑い/にこり/まばたき/困る/あ). Models missing a name simply skip that
 * track (babylon-mmd binds by name), so this degrades gracefully.
 * Blinks are AUTHORED IN THE VMD, timed to the motion's beats — the
 * runtimes already yield procedural blinking to VMDs that carry morph
 * tracks, so the file must bring its own.
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
 *       pitch − = bow/nod forward
 *   - RAISED-ARM PLANE (side-probe matrix, v5): with the arm raised via
 *       roll, 腕 pitch + and ひじ yaw ≳0.6 both push the hand BEHIND the
 *       body plane — invisible from the front, ugly from the side (the
 *       "팔이 뒤로 꺾임" bug). Validated raised wave hold:
 *       肩 roll −0.25 + 腕 {yaw −0.3, pitch −0.1, roll −1.3} + ひじ 0.35,
 *       hand lands above the head IN the body plane. Keep ひじ ≤0.6 and
 *       腕 pitch ≤0 while the arm is up; wave by oscillating 腕 roll
 *       (side-to-side), not ひじ yaw (fore-aft when raised).
 *   - EVERY pose must be validated from BOTH cameras (front + side=1) —
 *       a frontal-only check cannot see fore/aft tilt at all.
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
  // leg IK targets — fullwidth ＩＫ, the standard MMD naming
  右足ＩＫ: [137, 69, 145, 171, 130, 104, 130, 106],
  左足ＩＫ: [141, 182, 145, 171, 130, 104, 130, 106],
};

// ── Shift-JIS morph name bytes (de-facto standard facial morphs) ───
const MORPH_SJIS = {
  笑い: [143, 206, 130, 162], // smiling eyes
  にこり: [130, 201, 130, 177, 130, 232], // soft smile (mouth)
  まばたき: [130, 220, 130, 206, 130, 189, 130, 171], // blink / eyes closed
  困る: [141, 162, 130, 233], // troubled brows
  あ: [130, 160], // open mouth "a"
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

/** asymmetric shaping: p<1 = fast attack / slow release (gravity feel),
 *  p>1 = slow build / snappy end. Applied to a 0..1 signal. */
const sharp = (x, p) => Math.sign(x) * Math.abs(x) ** p;
/** decaying envelope over t∈[0,1] — gestures lose energy naturally */
const decay = (t, k = 1.6) => Math.exp(-k * t);

/** natural blink at `atSec`: fast close (~70ms) · micro-hold · slower
 *  open (~130ms). `tSec` is absolute seconds into the motion. */
const blink = (tSec, atSec) => {
  const dt = tSec - atSec;
  if (dt < 0 || dt > 0.22) return 0;
  if (dt < 0.07) return ss(dt / 0.07);
  if (dt < 0.1) return 1;
  return 1 - ss((dt - 0.1) / 0.12);
};

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
// Torso as a chain: 上半身 keeps the full validated intent (models with
// only one spine bone look exactly as strip-verified); 上半身2 — present
// on virtually every modern model — adds a gentle extra segment so the
// back CURVES instead of hinging at one joint. Missing bones are
// skipped by name, so this is a pure upgrade.
const torsoChain = (yaw = 0, pitch = 0, roll = 0) => ({
  上半身: { yaw, pitch, roll },
  上半身2: { yaw: yaw * 0.3, pitch: pitch * 0.3, roll: roll * 0.3 },
});

const PRESETS = [
  {
    id: "idle-breeze",
    label: "잔잔한 아이들",
    description: "호흡·불규칙 체중 이동 — 기본 대기 모션",
    seconds: 8,
    channels(t) {
      // two incommensurate-feeling cycles so it never reads as a metronome
      const breath = Math.sin(TAU * 2 * t);
      const sway = 0.7 * Math.sin(TAU * t) + 0.3 * Math.sin(TAU * 2 * t + 1.1);
      const armPhL = Math.sin(TAU * 2 * t + 0.5); // left arm lags — breaks mirror symmetry
      return {
        センター: { pos: [0.32 * sway, -0.16 + 0.14 * Math.cos(TAU * 2 * t), 0] },
        下半身: { yaw: -0.02 * sway, roll: 0.03 * sway },
        ...torsoChain(0.035 * sway, 0.05 * breath, -0.02 * sway),
        ...headChain(-0.05 * sway, -0.035 * breath, 0.02 * sway),
        右肩: { roll: -0.02 * breath },
        右腕: { roll: ARM + 0.035 * breath },
        右ひじ: { yaw: 0.09 + 0.03 * breath },
        左肩: { roll: 0.02 * armPhL },
        左腕: { roll: -(ARM + 0.035 * armPhL) },
        左ひじ: { yaw: -(0.09 + 0.03 * armPhL) },
      };
    },
    face(t, S) {
      // resting warmth + irregular blinks (single, then a double)
      const s = t * S;
      return {
        にこり: 0.12,
        まばたき: blink(s, 2.6) + blink(s, 5.4) + blink(s, 5.78),
      };
    },
  },
  {
    id: "idle-groove",
    label: "리듬 아이들",
    description: "무릎으로 리듬 타는 대기 — 빠르게 눌렀다 천천히 올라오기",
    seconds: 4,
    channels(t) {
      const beat = TAU * 2 * t;
      // gravity: fast drop, slow recover
      const bob = sharp((1 - Math.cos(beat)) / 2, 0.65);
      const lean = Math.sin(beat / 2 + Math.PI / 4);
      const armSw = Math.sin(beat + 0.6);
      return {
        センター: { pos: [0.1 * lean, -0.95 * bob, 0] },
        下半身: { roll: -0.05 * lean, pitch: -0.03 * bob },
        ...torsoChain(0, -0.06 * bob, 0.09 * lean),
        ...headChain(0.04 * lean, 0.07 * bob, -0.06 * lean),
        右肩: { roll: -0.05 * bob },
        右腕: { roll: ARM + 0.14 * bob + 0.05 * armSw },
        右ひじ: { yaw: 0.12 + 0.14 * bob },
        左肩: { roll: 0.05 * bob },
        左腕: { roll: -(ARM + 0.14 * bob - 0.05 * armSw) },
        左ひじ: { yaw: -(0.12 + 0.14 * bob) },
      };
    },
    face(t, S) {
      return { にこり: 0.32, まばたき: blink(t * S, 1.8) };
    },
  },
  {
    id: "greeting-wave",
    label: "손 인사",
    description: "손이 앞으로 이끌며 올라가 크게 흔드는 인사",
    seconds: 5,
    channels(t) {
      // snappy raise (0→0.16) · wave ×3 (0.16→0.78) · settle (0.78→0.97)
      const lift = window_(t, 0.0, 0.16, 0.78, 0.97);
      const wavePhase = Math.min(1, Math.max(0, (t - 0.16) / 0.62));
      const wave = Math.sin(TAU * 3 * wavePhase) * window_(t, 0.14, 0.22, 0.72, 0.8);
      const nodBeat = Math.max(0, Math.sin(TAU * 3 * wavePhase)) * window_(t, 0.16, 0.3, 0.7, 0.8);
      return {
        // weight shifts off the waving side; body joins the greeting
        センター: { pos: [-0.35 * lift, -0.12 * lift, 0] },
        下半身: { roll: 0.05 * lift },
        ...torsoChain(0.05 * lift, 0, -0.13 * lift),
        ...headChain(0.12 * lift, -0.05 * nodBeat, 0.16 * lift),
        右肩: { roll: -0.25 * lift },
        // side-probed hold: hand above the head IN the body plane; the
        // wave itself is the whole arm swinging side-to-side (roll) with
        // the elbow breathing in its side-safe range (0.10..0.60)
        右腕: {
          yaw: -0.3 * lift,
          pitch: -0.1 * lift,
          roll: ARM + lift * (-1.3 - ARM) + 0.16 * wave,
        },
        右ひじ: { yaw: 0.09 + lift * (0.35 - 0.09) + 0.25 * wave * lift },
        左肩: { roll: 0.03 * lift },
        左腕: { roll: -(ARM + 0.06 * lift) },
        左ひじ: { yaw: -(0.09 + 0.05 * lift) },
      };
    },
    face(t, S) {
      // 笑い at PARTIAL weight reads as droopy/sleepy eyes (half-lidded),
      // not a smile — so ramp fast and hold at FULL closed-smile arcs,
      // with a real mouth smile underneath
      const smile = window_(t, 0.04, 0.16, 0.8, 0.95);
      return { 笑い: smile, にこり: 0.55 * smile, まばたき: blink(t * S, 0.12) };
    },
  },
  {
    id: "bow",
    label: "정중한 인사",
    description: "목이 먼저, 허리가 따라 깊게 숙이는 절",
    seconds: 5,
    channels(t) {
      // brisk down (0.08→0.28) · hold (→0.58) · slow rise (→0.9) + settle
      const w = window_(t, 0.08, 0.28, 0.58, 0.9);
      const wHead = window_(t, 0.05, 0.24, 0.6, 0.93);
      const settle = Math.sin(TAU * Math.min(1, Math.max(0, (t - 0.88) / 0.12))) * 0.04;
      return {
        センター: { pos: [0, -0.55 * w, 0] },
        下半身: { pitch: -0.14 * w },
        ...torsoChain(0, -0.52 * w + settle, 0),
        ...headChain(0, -0.3 * wHead + settle, 0),
        右肩: { roll: 0.05 * w },
        右腕: { roll: ARM + 0.16 * w, pitch: 0.1 * w },
        右ひじ: { yaw: 0.1 + 0.1 * w },
        左肩: { roll: -0.05 * w },
        左腕: { roll: -(ARM + 0.16 * w), pitch: 0.1 * w },
        左ひじ: { yaw: -(0.1 + 0.1 * w) },
      };
    },
    face(t) {
      // eyes close gently through the bow — classic polite MMD bow
      const w = window_(t, 0.08, 0.28, 0.58, 0.9);
      return { まばたき: 0.9 * w, にこり: 0.22 * w };
    },
  },
  {
    id: "nod",
    label: "끄덕끄덕",
    description: "또렷한 두 번 끄덕임 (긍정)",
    seconds: 2.5,
    channels(t) {
      const g = window_(t, 0.04, 0.16, 0.82, 0.96);
      // crisp attack per nod
      const nod = sharp(Math.max(0, Math.sin(TAU * 2 * t)), 0.7) * g;
      return {
        センター: { pos: [0, -0.06 * nod, 0] },
        ...torsoChain(0, -0.06 * nod, 0),
        ...headChain(0, -0.42 * nod, 0),
        ...armChainR(0.02 * nod, 0.09),
        ...armChainL(0.02 * nod, 0.09),
      };
    },
    face(t, S) {
      const g = window_(t, 0.04, 0.16, 0.82, 0.96);
      return { にこり: 0.4 * g, まばたき: blink(t * S, 1.55) };
    },
  },
  {
    id: "head-shake",
    label: "도리도리",
    description: "점점 잦아드는 좌우 고개 흔들기 (부정)",
    seconds: 2.5,
    channels(t) {
      const g = window_(t, 0.04, 0.14, 0.8, 0.96);
      const env = decay(Math.max(0, t - 0.14) / 0.86, 1.1); // swings die down
      const shake = Math.sin(TAU * 2.6 * t) * g * env;
      return {
        ...torsoChain(0.06 * shake, 0, 0),
        ...headChain(0.42 * shake, 0, -0.04 * shake),
        両目: { yaw: 0.1 * shake },
        ...armChainR(0, 0.09),
        ...armChainL(0, 0.09),
      };
    },
    face(t, S) {
      // troubled brows sell the "no" — released with a closing blink
      const g = window_(t, 0.04, 0.14, 0.78, 0.94);
      return { 困る: 0.65 * g, まばたき: blink(t * S, 2.12) };
    },
  },
  {
    id: "happy-bounce",
    label: "신나는 바운스",
    description: "무릎을 깊게 튕기며 팔을 활짝 벌리는 기쁨 표현",
    seconds: 4,
    channels(t) {
      const beat = TAU * 2 * t;
      const g = window_(t, 0.02, 0.1, 0.88, 0.98);
      // deep, gravity-shaped dips; pops read as heel lifts
      const dip = sharp(Math.max(0, Math.sin(beat)), 0.6) * g;
      const pop = sharp(Math.max(0, -Math.sin(beat)), 0.8) * g;
      return {
        センター: { pos: [0, -1.35 * dip + 0.3 * pop, 0] },
        下半身: { pitch: -0.06 * dip },
        ...torsoChain(0, -0.1 * dip + 0.09 * pop, 0.05 * Math.sin(TAU * t) * g),
        ...headChain(0, 0.16 * dip - 0.12 * pop, 0.04 * Math.sin(TAU * t) * g),
        右肩: { roll: -0.16 * pop },
        右腕: { roll: ARM + 0.2 * dip - 0.62 * pop },
        右ひじ: { yaw: 0.14 + 0.18 * dip + 0.3 * pop },
        左肩: { roll: 0.16 * pop },
        左腕: { roll: -(ARM + 0.2 * dip - 0.62 * pop) },
        左ひじ: { yaw: -(0.14 + 0.18 * dip + 0.3 * pop) },
      };
    },
    face(t, S) {
      // full joy: beaming eyes, mouth pops open on each hop
      const beat = TAU * 2 * t;
      const g = window_(t, 0.02, 0.1, 0.88, 0.98);
      const pop = sharp(Math.max(0, -Math.sin(beat)), 0.8) * g;
      // full-weight 笑い — partial weights read as sleepy, not joyful
      return { 笑い: g, あ: 0.3 * pop, まばたき: blink(t * S, 0.28) };
    },
  },
  {
    id: "look-around",
    label: "두리번",
    description: "눈이 먼저, 몸이 따라 도는 시선 이동",
    seconds: 6,
    channels(t) {
      const L = window_(t, 0.08, 0.2, 0.32, 0.44);
      const R = window_(t, 0.48, 0.6, 0.72, 0.84);
      // anticipation: tiny counter-turn right before each look
      const antiL = window_(t, 0.04, 0.08, 0.08, 0.14);
      const antiR = window_(t, 0.44, 0.48, 0.48, 0.54);
      const dir = L - R - 0.12 * antiL + 0.12 * antiR;
      // eyes lead the head by an earlier window
      const eyeDir = window_(t, 0.05, 0.14, 0.34, 0.46) - window_(t, 0.45, 0.54, 0.74, 0.86);
      return {
        センター: { pos: [0.2 * dir, 0, 0] },
        下半身: { yaw: -0.06 * dir },
        ...torsoChain(0.2 * dir, 0, -0.03 * dir),
        ...headChain(0.52 * dir, 0.03 * (L + R), 0),
        両目: { yaw: 0.16 * eyeDir },
        ...armChainR(0.02 * (L + R), 0.09),
        ...armChainL(0.02 * (L + R), 0.09),
      };
    },
    face(t, S) {
      // blink exactly at each gaze hand-off — how real eyes re-target
      const s = t * S;
      return { まばたき: blink(s, 2.7) + blink(s, 5.3) };
    },
  },
  {
    id: "sway-dance",
    label: "리듬 스윙",
    description: "실제 스텝 폭으로 체중을 옮기는 좌우 스윙",
    seconds: 8,
    channels(t) {
      const beat = TAU * 2 * t;
      const g = window_(t, 0.02, 0.08, 0.9, 0.98);
      const side = Math.sin(beat) * g;
      const dipB = sharp(Math.abs(Math.cos(beat)), 0.7); // dip at each crossing
      const armSw = Math.sin(beat + 0.45) * g; // arms trail the hips
      return {
        センター: { pos: [1.15 * side, -0.55 * (1 - dipB) * g, 0] },
        下半身: { roll: -0.09 * side, yaw: 0.05 * Math.sin(beat / 2) * g },
        ...torsoChain(-0.06 * Math.sin(beat / 2) * g, 0, 0.14 * side),
        ...headChain(0.08 * side, 0, -0.1 * side),
        右肩: { roll: -0.06 * Math.max(0, -armSw) },
        右腕: { roll: ARM + 0.3 * armSw },
        右ひじ: { yaw: 0.14 + 0.16 * Math.max(0, armSw) },
        左肩: { roll: 0.06 * Math.max(0, armSw) },
        左腕: { roll: -(ARM - 0.3 * armSw) },
        左ひじ: { yaw: -(0.14 + 0.16 * Math.max(0, -armSw)) },
      };
    },
    face(t, S) {
      const g = window_(t, 0.02, 0.08, 0.9, 0.98);
      const s = t * S;
      return { にこり: 0.45 * g, まばたき: blink(s, 2.3) + blink(s, 5.9) };
    },
  },
];

// ── VMD encoder ────────────────────────────────────────────────────
function encodeVmd(boneFrames, morphFrames = []) {
  const HEADER = 30 + 20;
  const size = HEADER + 4 + boneFrames.length * 111 + 4 + morphFrames.length * 23 + 4 * 4;
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
  // morph section: 15B Shift-JIS name + u32 frame + f32 weight
  view.setUint32(off, morphFrames.length, true);
  off += 4;
  for (const f of morphFrames) {
    bytes.set(f.nameSjis, off);
    off += 15;
    view.setUint32(off, f.frame, true);
    off += 4;
    view.setFloat32(off, f.weight, true);
    off += 4;
  }
  // camera / light / self-shadow / ik-display sections: empty
  for (let i = 0; i < 4; i++) {
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
  // face tracks: every frame (blinks are ~7 frames total and need the
  // full 30fps density; 23B/key keeps files tiny anyway)
  const morphFrames = [];
  if (preset.face) {
    for (let frame = 0; frame <= totalFrames; frame += 1) {
      const weights = preset.face(frame / totalFrames, preset.seconds);
      for (const [name, weight] of Object.entries(weights)) {
        const nameSjis = MORPH_SJIS[name];
        if (!nameSjis) throw new Error(`no Shift-JIS bytes for morph ${name}`);
        morphFrames.push({ nameSjis, frame, weight: Math.min(1, Math.max(0, weight)) });
      }
    }
  }
  const bytes = encodeVmd(frames, morphFrames);
  writeFileSync(join(OUT_DIR, `${preset.id}.vmd`), bytes);
  manifest.push({
    id: preset.id,
    file: `${preset.id}.vmd`,
    label: preset.label,
    description: preset.description,
    seconds: preset.seconds,
  });
  console.log(
    `  ${preset.id}.vmd — ${frames.length} bone keys + ${morphFrames.length} morph keys, ${bytes.length} bytes`,
  );
}
writeFileSync(join(OUT_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${PRESETS.length} presets + manifest → public/motions/`);
