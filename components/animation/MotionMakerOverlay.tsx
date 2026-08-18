"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MmdAdapter } from "@/lib/adapters/MmdAdapter";
import {
  bakeMotion,
  bakePoseHold,
  type Easing,
  type MotionKeyframe,
  normalizePose,
  POSE_LIBRARY,
  type PoseParams,
  poseAt,
  REST_POSE,
} from "@/lib/mmd/motionComposer";
import { addPuppetFiles, loadPuppet, type PuppetId } from "@/lib/persistence/db";

/**
 * 모션 메이커 — full-workspace keyframe editor.
 *
 * Layout: the edit page's 3D viewport stays big and live (pointer
 * events pass through the empty region — camera orbit keeps working
 * while posing); right inspector = key editor / pose tools / wide
 * sliders; bottom = a real timeline (second ruler, draggable keyframe
 * diamonds, scrub playhead previewing the INTERPOLATED pose).
 *
 * Editor guarantees:
 *  - full undo/redo (Ctrl+Z / Ctrl+Shift+Z·Ctrl+Y), slider drags
 *    grouped into one history step per gesture
 *  - projects persist as maker/<이름>.maker.json next to the baked VMD
 *    (they ride the same puppet storage), so a saved motion can be
 *    REOPENED and edited — the bake is no longer one-way
 *  - looping playback, Space to play/stop, Del to remove a key,
 *    ←/→ to nudge the playhead (Shift = coarse)
 *  - WYSIWYG: every preview goes through the same VMD pipeline the
 *    runtime uses; what you scrub is exactly what gets saved
 */

const PREVIEW_NAME = " maker-preview"; // thin-space prefix (never a user stem)
const UNSAFE_NAME = /[\\/#%?*:"<>|]|^\./;
const SNAP = 0.05;
const PROJECT_DIR = "maker/";
const PROJECT_SUFFIX = ".maker.json";

type Props = {
  adapter: MmdAdapter;
  puppetKey: string | null;
  motions: string[];
  presetIds: string[];
  onSaved: (stem: string) => void;
  onClose: () => void;
};

const clonePose = (p: PoseParams): PoseParams => JSON.parse(JSON.stringify(p));
let keyCounter = 1;
const newKeyId = () => `mk${keyCounter++}`;

type SliderRow = {
  label: string;
  min: number;
  max: number;
  hint?: string;
  get: (p: PoseParams) => number;
  set: (p: PoseParams, v: number) => PoseParams;
};

const GROUPS: { title: string; rows: SliderRow[] }[] = [
  {
    title: "오른팔",
    rows: [
      {
        label: "들기",
        min: 0,
        max: 1,
        get: (p) => p.rightArm.raise,
        set: (p, v) => ({ ...p, rightArm: { ...p.rightArm, raise: v } }),
      },
      {
        label: "벌리기",
        min: -1,
        max: 1,
        get: (p) => p.rightArm.spread,
        set: (p, v) => ({ ...p, rightArm: { ...p.rightArm, spread: v } }),
      },
      {
        label: "팔꿈치",
        min: -1,
        max: 1,
        hint: "+ 는 든 팔을 굽히고, − 는 내린 팔을 앞으로 접습니다 (손모음)",
        get: (p) => p.rightArm.elbow,
        set: (p, v) => ({ ...p, rightArm: { ...p.rightArm, elbow: v } }),
      },
    ],
  },
  {
    title: "왼팔",
    rows: [
      {
        label: "들기",
        min: 0,
        max: 1,
        get: (p) => p.leftArm.raise,
        set: (p, v) => ({ ...p, leftArm: { ...p.leftArm, raise: v } }),
      },
      {
        label: "벌리기",
        min: -1,
        max: 1,
        get: (p) => p.leftArm.spread,
        set: (p, v) => ({ ...p, leftArm: { ...p.leftArm, spread: v } }),
      },
      {
        label: "팔꿈치",
        min: -1,
        max: 1,
        hint: "+ 는 든 팔을 굽히고, − 는 내린 팔을 앞으로 접습니다 (손모음)",
        get: (p) => p.leftArm.elbow,
        set: (p, v) => ({ ...p, leftArm: { ...p.leftArm, elbow: v } }),
      },
    ],
  },
  {
    title: "머리",
    rows: [
      {
        label: "좌우 돌리기",
        min: -1,
        max: 1,
        get: (p) => p.head.yaw,
        set: (p, v) => ({ ...p, head: { ...p.head, yaw: v } }),
      },
      {
        label: "끄덕이기",
        min: -1,
        max: 1,
        get: (p) => -p.head.pitch,
        set: (p, v) => ({ ...p, head: { ...p.head, pitch: -v } }),
      },
      {
        label: "갸웃하기",
        min: -1,
        max: 1,
        get: (p) => p.head.roll,
        set: (p, v) => ({ ...p, head: { ...p.head, roll: v } }),
      },
    ],
  },
  {
    title: "시선",
    rows: [
      {
        label: "좌우",
        min: -1,
        max: 1,
        get: (p) => p.eyes.yaw,
        set: (p, v) => ({ ...p, eyes: { ...p.eyes, yaw: v } }),
      },
      {
        label: "위아래",
        min: -1,
        max: 1,
        get: (p) => p.eyes.pitch,
        set: (p, v) => ({ ...p, eyes: { ...p.eyes, pitch: v } }),
      },
    ],
  },
  {
    title: "몸통",
    rows: [
      {
        label: "돌리기",
        min: -1,
        max: 1,
        get: (p) => p.torso.yaw,
        set: (p, v) => ({ ...p, torso: { ...p.torso, yaw: v } }),
      },
      {
        label: "숙이기",
        min: -1,
        max: 1,
        get: (p) => -p.torso.pitch,
        set: (p, v) => ({ ...p, torso: { ...p.torso, pitch: -v } }),
      },
      {
        label: "기울이기",
        min: -1,
        max: 1,
        get: (p) => p.torso.roll,
        set: (p, v) => ({ ...p, torso: { ...p.torso, roll: v } }),
      },
    ],
  },
  {
    title: "몸 전체",
    rows: [
      {
        label: "좌우 이동",
        min: -1,
        max: 1,
        get: (p) => p.center.x,
        set: (p, v) => ({ ...p, center: { ...p.center, x: v } }),
      },
      {
        label: "무릎 굽히기",
        min: 0,
        max: 1,
        get: (p) => p.center.dip,
        set: (p, v) => ({ ...p, center: { ...p.center, dip: v } }),
      },
    ],
  },
  {
    title: "표정",
    rows: (
      [
        ["笑い", "웃는 눈"],
        ["にこり", "미소"],
        ["まばたき", "눈 감기"],
        ["困る", "곤란한 눈썹"],
        ["あ", "입 벌리기"],
      ] as const
    ).map(([name, label]) => ({
      label,
      min: 0,
      max: 1,
      get: (p: PoseParams) => p.face[name] ?? 0,
      set: (p: PoseParams, v: number) => ({ ...p, face: { ...p.face, [name]: v } }),
    })),
  },
];

// ── motion templates (seed sequences built from validated poses) ────
const LIB = (id: string): PoseParams =>
  clonePose(POSE_LIBRARY.find((p) => p.id === id)?.pose ?? REST_POSE);

const TEMPLATES: { id: string; label: string; build: () => MotionKeyframe[] }[] = [
  {
    id: "greet",
    label: "손인사 시퀀스",
    build: () => [
      { id: newKeyId(), t: 0, pose: clonePose(REST_POSE), easing: "smooth" },
      { id: newKeyId(), t: 0.9, pose: LIB("wave"), easing: "smooth" },
      {
        id: newKeyId(),
        t: 1.6,
        pose: (() => {
          const p = LIB("wave");
          p.rightArm.spread = 0.35;
          p.head.roll = -0.2;
          return p;
        })(),
        easing: "smooth",
      },
      { id: newKeyId(), t: 2.3, pose: LIB("wave"), easing: "smooth" },
    ],
  },
  {
    id: "polite",
    label: "정중한 인사",
    build: () => [
      { id: newKeyId(), t: 0, pose: clonePose(REST_POSE), easing: "smooth" },
      { id: newKeyId(), t: 0.9, pose: LIB("bow"), easing: "sharp-in" },
      { id: newKeyId(), t: 2.0, pose: LIB("bow"), easing: "linear" },
    ],
  },
  {
    id: "joy",
    label: "신나는 환영",
    build: () => [
      { id: newKeyId(), t: 0, pose: clonePose(REST_POSE), easing: "smooth" },
      {
        id: newKeyId(),
        t: 0.7,
        pose: (() => {
          const p = LIB("open");
          p.center.dip = 0.5;
          return p;
        })(),
        easing: "sharp-in",
      },
      { id: newKeyId(), t: 1.2, pose: LIB("open"), easing: "sharp-in" },
      {
        id: newKeyId(),
        t: 1.7,
        pose: (() => {
          const p = LIB("open");
          p.center.dip = 0.5;
          return p;
        })(),
        easing: "sharp-in",
      },
      { id: newKeyId(), t: 2.2, pose: LIB("open"), easing: "sharp-in" },
    ],
  },
  {
    id: "curious",
    label: "갸웃갸웃",
    build: () => [
      { id: newKeyId(), t: 0, pose: clonePose(REST_POSE), easing: "smooth" },
      { id: newKeyId(), t: 0.8, pose: LIB("think"), easing: "smooth" },
      {
        id: newKeyId(),
        t: 1.8,
        pose: (() => {
          const p = LIB("think");
          p.head.roll = -0.6;
          p.head.yaw = -0.35;
          p.eyes.yaw = -0.5;
          return p;
        })(),
        easing: "smooth",
      },
    ],
  },
];

type ProjectFile = { version: number; loopBack: boolean; keys: MotionKeyframe[] };
type Snapshot = { keys: MotionKeyframe[]; loopBack: boolean };

export function MotionMakerOverlay({
  adapter,
  puppetKey,
  motions,
  presetIds,
  onSaved,
  onClose,
}: Props) {
  const [keys, setKeys] = useState<MotionKeyframe[]>(() => [
    { id: newKeyId(), t: 0, pose: clonePose(REST_POSE), easing: "smooth" },
    { id: newKeyId(), t: 1.5, pose: LIB("wave"), easing: "smooth" },
  ]);
  const [selectedId, setSelectedId] = useState<string>(() => keys[0].id);
  const [loopBack, setLoopBack] = useState(true);
  const [saveName, setSaveName] = useState("내 모션");
  const [error, setError] = useState<string | null>(null);
  const [savedStem, setSavedStem] = useState<string | null>(null);
  const [overwriteArmed, setOverwriteArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [playheadT, setPlayheadT] = useState(0);
  const [clipboard, setClipboard] = useState<PoseParams | null>(null);
  const [projects, setProjects] = useState<string[]>([]);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);

  const previewTimer = useRef<number | null>(null);
  const aliveRef = useRef(true);
  const rulerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ keyId: string; moved: boolean; pushed: boolean } | null>(null);
  const scrubbingRef = useRef(false);
  const lastGestureRef = useRef<{ tag: string; at: number }>({ tag: "", at: 0 });

  const sorted = useMemo(() => [...keys].sort((a, b) => a.t - b.t), [keys]);
  const selected = keys.find((k) => k.id === selectedId) ?? sorted[0];
  const maxT = sorted[sorted.length - 1]?.t ?? 0;
  const timelineSpan = Math.max(3, maxT * 1.15 + (loopBack ? 0.8 : 0.3));

  // refs for keyboard handlers (avoid stale closures)
  const stateRef = useRef({ keys, loopBack, selectedId, playing, playheadT, maxT, sorted });
  stateRef.current = { keys, loopBack, selectedId, playing, playheadT, maxT, sorted };

  // ── history ──────────────────────────────────────────────────────
  const snapshot = useCallback((): Snapshot => {
    const s = stateRef.current;
    return { keys: JSON.parse(JSON.stringify(s.keys)), loopBack: s.loopBack };
  }, []);

  /** push an undo step; same-tag pushes within 700ms collapse (slider drags) */
  const pushHistory = useCallback(
    (tag: string) => {
      const now = performance.now();
      const g = lastGestureRef.current;
      if (tag && g.tag === tag && now - g.at < 700) {
        g.at = now;
        return;
      }
      lastGestureRef.current = { tag, at: now };
      setHistory((h) => [...h.slice(-59), snapshot()]);
      setFuture([]);
    },
    [snapshot],
  );

  const restore = useCallback((s: Snapshot) => {
    setKeys(s.keys);
    setLoopBack(s.loopBack);
    setSelectedId((cur) => (s.keys.some((k) => k.id === cur) ? cur : (s.keys[0]?.id ?? "")));
    setSavedStem(null);
    setOverwriteArmed(false);
  }, []);

  const undo = useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      setFuture((f) => [...f, snapshot()]);
      restore(prev);
      lastGestureRef.current = { tag: "", at: 0 };
      return h.slice(0, -1);
    });
  }, [snapshot, restore]);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const next = f[f.length - 1];
      setHistory((h) => [...h, snapshot()]);
      restore(next);
      return f.slice(0, -1);
    });
  }, [snapshot, restore]);

  // ── preview plumbing ─────────────────────────────────────────────
  const playBytes = useCallback(
    (bytes: Uint8Array) => {
      const buf = new ArrayBuffer(bytes.length);
      new Uint8Array(buf).set(bytes);
      const file = new File([buf], "maker-preview.vmd");
      adapter.addMotionFile(PREVIEW_NAME, file, { ephemeral: true });
      adapter.playAnimation(PREVIEW_NAME);
    },
    [adapter],
  );

  const schedulePoseHold = useCallback(
    (pose: PoseParams, delay = 160) => {
      if (previewTimer.current !== null) window.clearTimeout(previewTimer.current);
      previewTimer.current = window.setTimeout(() => {
        if (!aliveRef.current) return;
        try {
          playBytes(bakePoseHold(pose));
          setPlaying(false);
          setError(null);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }, delay);
    },
    [playBytes],
  );

  // playhead follows the transport; loops the preview seamlessly
  useEffect(() => {
    if (!playing) return;
    const iv = window.setInterval(() => {
      if (scrubbingRef.current) return;
      const st = adapter.getMotionState();
      if (st.name !== PREVIEW_NAME || st.duration <= 0) return;
      if (st.frame >= st.duration - 1) {
        adapter.seekMotion(0);
        adapter.resumeMotion();
        setPlayheadT(0);
      } else {
        setPlayheadT(st.frame / 30);
      }
    }, 80);
    return () => window.clearInterval(iv);
  }, [playing, adapter]);

  // ── projects (persisted keyframe sources) ────────────────────────
  const refreshProjects = useCallback(async () => {
    if (!puppetKey) return;
    try {
      const loaded = await loadPuppet(puppetKey as PuppetId);
      if (!loaded || !aliveRef.current) return;
      setProjects(
        loaded.entries
          .filter((e) => e.path.startsWith(PROJECT_DIR) && e.path.endsWith(PROJECT_SUFFIX))
          .map((e) => e.path.slice(PROJECT_DIR.length, -PROJECT_SUFFIX.length))
          .sort(),
      );
    } catch {
      /* project list is best-effort */
    }
  }, [puppetKey]);

  const openProject = useCallback(
    async (stem: string) => {
      if (!puppetKey) return;
      try {
        const loaded = await loadPuppet(puppetKey as PuppetId);
        const entry = loaded?.entries.find(
          (e) => e.path === `${PROJECT_DIR}${stem}${PROJECT_SUFFIX}`,
        );
        if (!entry) throw new Error("프로젝트 파일을 찾을 수 없습니다");
        const parsed = JSON.parse(await entry.blob.text()) as ProjectFile;
        if (!Array.isArray(parsed.keys) || parsed.keys.length === 0)
          throw new Error("프로젝트가 비어 있습니다");
        pushHistory("");
        const restored: MotionKeyframe[] = parsed.keys.map((k) => ({
          id: newKeyId(),
          t: Math.max(0, Number(k.t) || 0),
          easing: (["smooth", "linear", "sharp-in", "sharp-out"] as Easing[]).includes(k.easing)
            ? k.easing
            : "smooth",
          pose: normalizePose(k.pose),
        }));
        setKeys(restored);
        setLoopBack(parsed.loopBack !== false);
        setSelectedId(restored[0].id);
        setSaveName(stem);
        setSavedStem(null);
        setPlayheadT(restored[0].t);
        schedulePoseHold(restored[0].pose, 80);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [puppetKey, pushHistory, schedulePoseHold],
  );

  useEffect(() => {
    aliveRef.current = true;
    schedulePoseHold(stateRef.current.sorted[0]?.pose ?? REST_POSE, 60);
    void refreshProjects();
    return () => {
      aliveRef.current = false;
      if (previewTimer.current !== null) window.clearTimeout(previewTimer.current);
      const state = adapter.getMotionState();
      if (state.name === PREVIEW_NAME) adapter.stopAnimation();
    };
  }, [adapter, refreshProjects, schedulePoseHold]);

  // ── keyframe ops ─────────────────────────────────────────────────
  function markDirty() {
    setSavedStem(null);
    setOverwriteArmed(false);
  }

  function updateSelectedPose(next: PoseParams, gestureTag = "pose") {
    if (!selected) return;
    pushHistory(`${gestureTag}:${selected.id}`);
    setKeys((prev) => prev.map((k) => (k.id === selected.id ? { ...k, pose: next } : k)));
    markDirty();
    schedulePoseHold(next);
  }

  function updateSelected(patch: Partial<MotionKeyframe>, gestureTag = "meta") {
    if (!selected) return;
    pushHistory(`${gestureTag}:${selected.id}`);
    setKeys((prev) => prev.map((k) => (k.id === selected.id ? { ...k, ...patch } : k)));
    markDirty();
  }

  const selectKey = useCallback(
    (k: MotionKeyframe) => {
      setSelectedId(k.id);
      setPlayheadT(k.t);
      schedulePoseHold(k.pose, 80);
    },
    [schedulePoseHold],
  );

  function addKeyAt(t: number, pose?: PoseParams) {
    pushHistory("");
    const key: MotionKeyframe = {
      id: newKeyId(),
      t: Number(t.toFixed(2)),
      pose: clonePose(pose ?? poseAt(stateRef.current.sorted, t)),
      easing: "smooth",
    };
    setKeys((prev) => [...prev, key]);
    setSelectedId(key.id);
    setPlayheadT(key.t);
    markDirty();
  }

  function duplicateSelected() {
    if (!selected) return;
    addKeyAt(selected.t + 0.5, selected.pose);
  }

  const removeSelected = useCallback(() => {
    const s = stateRef.current;
    const sel = s.keys.find((k) => k.id === s.selectedId);
    if (!sel || s.keys.length <= 1) return;
    setHistory((h) => [
      ...h.slice(-59),
      { keys: JSON.parse(JSON.stringify(s.keys)), loopBack: s.loopBack },
    ]);
    setFuture([]);
    lastGestureRef.current = { tag: "", at: 0 };
    const rest = s.sorted.filter((k) => k.id !== sel.id);
    setKeys((prev) => prev.filter((k) => k.id !== sel.id));
    setSelectedId(rest[0]?.id ?? "");
    setSavedStem(null);
    setOverwriteArmed(false);
  }, []);

  function mirrorSelected() {
    if (!selected) return;
    const p = selected.pose;
    const mirrored: PoseParams = {
      ...clonePose(p),
      rightArm: { ...p.leftArm },
      leftArm: { ...p.rightArm },
      head: { yaw: -p.head.yaw, pitch: p.head.pitch, roll: -p.head.roll },
      torso: { yaw: -p.torso.yaw, pitch: p.torso.pitch, roll: -p.torso.roll },
      center: { x: -p.center.x, dip: p.center.dip },
      eyes: { yaw: -p.eyes.yaw, pitch: p.eyes.pitch },
    };
    updateSelectedPose(mirrored, "mirror");
  }

  function applyTemplate(id: string) {
    const tpl = TEMPLATES.find((t) => t.id === id);
    if (!tpl) return;
    pushHistory("");
    const built = tpl.build();
    setKeys(built);
    setSelectedId(built[0].id);
    setPlayheadT(0);
    setSaveName(tpl.label);
    markDirty();
    try {
      playBytes(bakeMotion(built, { loopBack: true }));
      setPlaying(true);
    } catch {
      /* preview best-effort */
    }
  }

  const togglePlay = useCallback(() => {
    if (stateRef.current.playing) {
      adapter.stopAnimation();
      setPlaying(false);
      return;
    }
    try {
      playBytes(bakeMotion(stateRef.current.sorted, { loopBack: stateRef.current.loopBack }));
      setPlaying(true);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [adapter, playBytes]);

  // ── keyboard shortcuts ───────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "SELECT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      )
        return;
      if (e.key === " ") {
        e.preventDefault();
        togglePlay();
      } else if ((e.key === "Delete" || e.key === "Backspace") && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        removeSelected();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && e.shiftKey) ||
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y")
      ) {
        e.preventDefault();
        redo();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const step = (e.shiftKey ? 0.25 : SNAP) * (e.key === "ArrowLeft" ? -1 : 1);
        const s = stateRef.current;
        const t2 = Math.max(0, Math.min(s.maxT, s.playheadT + step));
        setPlayheadT(t2);
        schedulePoseHold(poseAt(s.sorted, t2), 60);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, removeSelected, undo, redo, schedulePoseHold, onClose]);

  // ── timeline pointer logic ───────────────────────────────────────
  const tFromClientX = useCallback(
    (clientX: number): number => {
      const el = rulerRef.current;
      if (!el) return 0;
      const r = el.getBoundingClientRect();
      const frac = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      return Math.round((frac * timelineSpan) / SNAP) * SNAP;
    },
    [timelineSpan],
  );

  function onRulerPointerDown(e: React.PointerEvent) {
    if (dragRef.current) return;
    scrubbingRef.current = true;
    rulerRef.current?.setPointerCapture?.(e.pointerId);
    const t = tFromClientX(e.clientX);
    setPlayheadT(t);
    schedulePoseHold(poseAt(sorted, Math.min(t, maxT)), 60);
  }
  function onRulerPointerMove(e: React.PointerEvent) {
    if (dragRef.current) {
      if (!dragRef.current.pushed) {
        dragRef.current.pushed = true;
        pushHistory("");
      }
      const t = Math.max(0, tFromClientX(e.clientX));
      const id = dragRef.current.keyId;
      dragRef.current.moved = true;
      setKeys((prev) => prev.map((k) => (k.id === id ? { ...k, t } : k)));
      setPlayheadT(t);
      return;
    }
    if (!scrubbingRef.current) return;
    const t = tFromClientX(e.clientX);
    setPlayheadT(t);
    schedulePoseHold(poseAt(sorted, Math.min(t, maxT)), 90);
  }
  function onRulerPointerUp() {
    scrubbingRef.current = false;
    if (dragRef.current) {
      if (dragRef.current.moved) markDirty();
      dragRef.current = null;
    }
  }

  const canPersist = !!puppetKey && !puppetKey.startsWith("builtin:");

  async function save() {
    const stem = saveName.trim().replace(/\.vmd$/i, "");
    if (!stem) {
      setError("저장할 이름을 입력하세요");
      return;
    }
    if (UNSAFE_NAME.test(stem)) {
      setError('이름에 쓸 수 없는 문자가 있습니다 (\\ / # % ? * : " < > |)');
      return;
    }
    const exists = motions.includes(stem) || presetIds.includes(stem);
    if (exists && !overwriteArmed) {
      setOverwriteArmed(true);
      setError(`"${stem}" 이(가) 이미 있습니다 — 한 번 더 누르면 덮어씁니다`);
      return;
    }
    setOverwriteArmed(false);
    setBusy(true);
    setError(null);
    try {
      const bytes = bakeMotion(sorted, { loopBack });
      const buf = new ArrayBuffer(bytes.length);
      new Uint8Array(buf).set(bytes);
      const file = new File([buf], `${stem}.vmd`, { type: "application/octet-stream" });
      // the PROJECT rides along so the motion can be reopened and edited
      const project: ProjectFile = { version: 1, loopBack, keys: sorted };
      const projectBlob = new Blob([JSON.stringify(project)], { type: "application/json" });
      if (canPersist && puppetKey) {
        await addPuppetFiles(puppetKey as PuppetId, [
          { name: file.name, path: `motions/${file.name}`, size: file.size, blob: file },
          {
            name: `${stem}${PROJECT_SUFFIX}`,
            path: `${PROJECT_DIR}${stem}${PROJECT_SUFFIX}`,
            size: projectBlob.size,
            blob: projectBlob,
          },
        ]);
      }
      adapter.addMotionFile(stem, file);
      onSaved(stem);
      setSavedStem(stem);
      void refreshProjects();
    } catch (e) {
      if (aliveRef.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  }

  const marks = useMemo(() => {
    const out: number[] = [];
    for (let s = 0; s <= timelineSpan; s += 0.5) out.push(Number(s.toFixed(1)));
    return out;
  }, [timelineSpan]);

  const INSPECTOR_W = 400;
  const TIMELINE_H = 178;

  return (
    <div className="pointer-events-none fixed inset-0 z-40">
      {/* ── right inspector ─────────────────────────────────────── */}
      <div
        className="pointer-events-auto absolute right-0 top-0 flex flex-col gap-2 overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-bg)]/95 p-3 shadow-2xl backdrop-blur"
        style={{ width: INSPECTOR_W, bottom: TIMELINE_H }}
      >
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold tracking-wide">모션 메이커</h2>
          <span className="text-[10px] opacity-50">
            키 {keys.length}개 · {maxT.toFixed(1)}초
          </span>
          <button
            type="button"
            onClick={onClose}
            title="닫기 (Esc)"
            className="ml-auto rounded border border-[var(--color-border)] px-2 py-1 text-xs hover:bg-white/10"
          >
            ✕ 닫기
          </button>
        </div>

        {/* undo/redo + templates + projects */}
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={undo}
            disabled={history.length === 0}
            title="실행 취소 (Ctrl+Z)"
            className="rounded border border-[var(--color-border)] px-2 py-1 text-xs hover:bg-white/10 disabled:opacity-30"
          >
            ↩ 취소
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={future.length === 0}
            title="다시 실행 (Ctrl+Shift+Z / Ctrl+Y)"
            className="rounded border border-[var(--color-border)] px-2 py-1 text-xs hover:bg-white/10 disabled:opacity-30"
          >
            ↪ 재실행
          </button>
          <select
            value=""
            onChange={(e) => e.target.value && applyTemplate(e.target.value)}
            className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-1 text-xs"
            title="템플릿으로 타임라인을 시작합니다 (현재 키는 실행 취소로 복구 가능)"
          >
            <option value="">템플릿에서 시작…</option>
            {TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          {projects.length > 0 && (
            <select
              value=""
              onChange={(e) => e.target.value && void openProject(e.target.value)}
              className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-1 text-xs"
              title="저장했던 모션 프로젝트를 다시 열어 편집합니다"
            >
              <option value="">프로젝트 열기…</option>
              {projects.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* selected key */}
        {selected && (
          <div className="rounded border border-[var(--color-border)] p-2">
            <div className="mb-1 flex items-center gap-2 text-xs">
              <span className="rounded bg-[var(--color-accent)]/20 px-1.5 py-0.5 text-[var(--color-accent)]">
                키 {sorted.findIndex((k) => k.id === selected.id) + 1}
              </span>
              <label className="flex items-center gap-1">
                <span className="opacity-60">시간</span>
                <input
                  type="number"
                  step={0.1}
                  min={0}
                  value={selected.t}
                  onChange={(e) =>
                    updateSelected({ t: Math.max(0, Number(e.target.value)) }, "time")
                  }
                  className="w-16 rounded bg-black/30 px-1 py-0.5 tabular-nums"
                />
                <span className="opacity-40">초</span>
              </label>
              <label className="flex items-center gap-1">
                <span className="opacity-60">이징</span>
                <select
                  value={selected.easing}
                  onChange={(e) => updateSelected({ easing: e.target.value as Easing }, "easing")}
                  className="rounded bg-black/30 px-1 py-0.5"
                >
                  <option value="smooth">부드럽게</option>
                  <option value="linear">일정하게</option>
                  <option value="sharp-in">빠른 시작</option>
                  <option value="sharp-out">빠른 끝</option>
                </select>
              </label>
            </div>
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                onClick={duplicateSelected}
                className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[11px] hover:bg-white/10"
              >
                복제
              </button>
              <button
                type="button"
                onClick={() => setClipboard(clonePose(selected.pose))}
                className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[11px] hover:bg-white/10"
                title="이 키의 포즈를 복사합니다"
              >
                포즈 복사
              </button>
              <button
                type="button"
                onClick={() => clipboard && updateSelectedPose(clonePose(clipboard), "paste")}
                disabled={!clipboard}
                className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[11px] hover:bg-white/10 disabled:opacity-30"
                title="복사한 포즈를 이 키에 붙여넣습니다"
              >
                붙여넣기
              </button>
              <button
                type="button"
                onClick={mirrorSelected}
                className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[11px] hover:bg-white/10"
                title="좌우를 반전한 포즈로 바꿉니다 (팔 교차·회전 반전)"
              >
                좌우 반전
              </button>
              <button
                type="button"
                onClick={removeSelected}
                disabled={keys.length <= 1}
                title="키 삭제 (Del)"
                className="rounded border border-red-400/40 px-2 py-0.5 text-[11px] text-red-300 disabled:opacity-30"
              >
                삭제
              </button>
            </div>
          </div>
        )}

        {/* pose library */}
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-widest opacity-60">포즈 라이브러리</p>
          <div className="grid grid-cols-3 gap-1">
            {POSE_LIBRARY.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => updateSelectedPose(clonePose(p.pose), `lib:${p.id}`)}
                className="rounded border border-[var(--color-border)] px-1 py-1.5 text-[11px] text-[var(--color-fg-dim)] hover:border-[var(--color-accent)]/60 hover:text-[var(--color-accent)]"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* pose sliders */}
        {selected &&
          GROUPS.map((g) => (
            <div key={g.title}>
              <p className="mb-0.5 text-[10px] uppercase tracking-widest opacity-60">{g.title}</p>
              {g.rows.map((row) => (
                <label
                  key={row.label}
                  className="flex items-center gap-2 py-0.5 text-xs"
                  title={row.hint}
                >
                  <span className="w-20 shrink-0 opacity-75">{row.label}</span>
                  <input
                    type="range"
                    className="min-w-0 flex-1 accent-[var(--color-accent)]"
                    min={row.min}
                    max={row.max}
                    step={0.01}
                    value={row.get(selected.pose)}
                    onChange={(e) =>
                      updateSelectedPose(
                        row.set(selected.pose, Number(e.target.value)),
                        `sl:${g.title}:${row.label}`,
                      )
                    }
                  />
                  <span className="w-9 shrink-0 text-right text-[11px] tabular-nums opacity-70">
                    {Math.round(row.get(selected.pose) * 100)}
                  </span>
                </label>
              ))}
            </div>
          ))}
      </div>

      {/* ── bottom timeline ─────────────────────────────────────── */}
      <div
        className="pointer-events-auto absolute inset-x-0 bottom-0 flex flex-col gap-1 border-t border-[var(--color-border)] bg-[var(--color-bg)]/95 px-4 py-2 shadow-2xl backdrop-blur"
        style={{ height: TIMELINE_H }}
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={togglePlay}
            title="재생/정지 (Space) — 재생은 루프됩니다"
            className={`rounded border px-3 py-1 text-sm ${playing ? "border-[var(--color-border)] hover:bg-white/10" : "border-[var(--color-accent)]/60 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10"}`}
          >
            {playing ? "⏹ 정지" : "▶ 재생"}
          </button>
          <button
            type="button"
            onClick={() => addKeyAt(playheadT)}
            className="rounded border border-[var(--color-border)] px-2 py-1 text-xs hover:bg-white/10"
            title="플레이헤드 위치의 (보간된) 포즈로 키프레임 추가"
          >
            + 키프레임 ({playheadT.toFixed(2)}s)
          </button>
          <label className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={loopBack}
              onChange={(e) => {
                pushHistory("");
                setLoopBack(e.target.checked);
                markDirty();
              }}
            />
            <span title="마지막에 첫 포즈로 부드럽게 돌아가 루프가 끊기지 않게 합니다">
              루프 이어붙임
            </span>
          </label>
          <span className="text-xs tabular-nums opacity-60">
            {playheadT.toFixed(2)}s / {maxT.toFixed(2)}s
          </span>
          <span className="hidden text-[10px] opacity-40 lg:inline">
            Space 재생 · Del 키 삭제 · Ctrl+Z 취소 · ←/→ 이동 · Esc 닫기
          </span>
          <div className="ml-auto flex items-center gap-2">
            <input
              className="w-44 rounded bg-black/30 px-2 py-1 text-xs"
              value={saveName}
              onChange={(e) => {
                setSaveName(e.target.value);
                setOverwriteArmed(false);
              }}
              placeholder="저장할 모션 이름"
            />
            <button
              type="button"
              className="rounded border border-emerald-400/50 px-3 py-1 text-sm text-emerald-300 hover:bg-emerald-400/10 disabled:opacity-40"
              disabled={busy || !saveName.trim() || !canPersist}
              onClick={() => void save()}
              title={
                canPersist
                  ? "VMD + 편집 가능한 프로젝트를 함께 저장합니다"
                  : "이 퍼펫에는 저장할 수 없습니다"
              }
            >
              {busy ? "저장 중…" : "모션으로 저장"}
            </button>
          </div>
        </div>

        {(error || savedStem) && (
          <p className={`text-[11px] ${error ? "text-red-300" : "text-emerald-300/90"}`}>
            {error ??
              `"${savedStem}" 저장됨 — 모션 목록에서 재생·아이들 지정, "프로젝트 열기"로 재편집할 수 있습니다.`}
          </p>
        )}

        <div
          ref={rulerRef}
          role="presentation"
          className="relative min-h-0 flex-1 cursor-crosshair select-none rounded border border-[var(--color-border)] bg-black/30"
          onPointerDown={onRulerPointerDown}
          onPointerMove={onRulerPointerMove}
          onPointerUp={onRulerPointerUp}
          onPointerCancel={onRulerPointerUp}
        >
          {marks.map((s) => (
            <div
              key={s}
              className="absolute bottom-0 top-0"
              style={{ left: `${(s / timelineSpan) * 100}%` }}
            >
              <div className={`h-full w-px ${s % 1 === 0 ? "bg-white/15" : "bg-white/5"}`} />
              {s % 1 === 0 && (
                <span className="absolute left-1 top-0 text-[9px] tabular-nums opacity-40">
                  {s}s
                </span>
              )}
            </div>
          ))}
          {loopBack && maxT > 0 && (
            <div
              className="absolute bottom-0 top-0 bg-emerald-400/5"
              style={{
                left: `${(maxT / timelineSpan) * 100}%`,
                width: `${(0.6 / timelineSpan) * 100}%`,
              }}
              title="루프 이어붙임 구간 — 첫 포즈로 복귀"
            />
          )}
          <div
            className="pointer-events-none absolute bottom-0 top-0 w-px bg-[var(--color-accent)]"
            style={{ left: `${(Math.min(playheadT, timelineSpan) / timelineSpan) * 100}%` }}
          >
            <div className="-left-1 absolute top-0 h-2 w-2 rotate-45 bg-[var(--color-accent)]" />
          </div>
          {sorted.map((k, i) => (
            <button
              key={k.id}
              type="button"
              onPointerDown={(e) => {
                e.stopPropagation();
                dragRef.current = { keyId: k.id, moved: false, pushed: false };
                rulerRef.current?.setPointerCapture?.(e.pointerId);
                selectKey(k);
              }}
              className={`absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[3px] border transition-colors ${
                k.id === selected?.id
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)]"
                  : "border-white/50 bg-[var(--color-bg)] hover:bg-white/30"
              }`}
              style={{ left: `${(k.t / timelineSpan) * 100}%` }}
              title={`키 ${i + 1} · ${k.t.toFixed(2)}s — 클릭: 선택 / 드래그: 시간 이동`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
