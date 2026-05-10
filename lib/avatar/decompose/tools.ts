/**
 * Tool catalog for the DecomposeStudio editor.
 *
 * Each entry describes a single Photoshop-style tool — its identifier,
 * the keyboard shortcut that activates it, an emoji-free icon hint
 * (rendered via lucide-react in the Toolbox component), and the
 * verbose tooltip text that surfaces in the UI. Centralized so new
 * tools can be added in one place without touching the dispatch
 * sites in DecomposeStudio.
 *
 * Brush / Eraser semantics intentionally differ between the two
 * studio modes:
 *
 *   trim mode   — mask = "hide these pixels"
 *                 brush  = add to mask    → hides under stroke
 *                 eraser = remove mask    → reveals under stroke
 *
 *   split mode  — mask = "include in this region"
 *                 brush  = add pixels     → includes under stroke
 *                 eraser = remove pixels  → excludes under stroke
 *
 * The tool ID stays the same across modes; the user-visible Mode
 * label inside the OptionsBar swaps to "Hide / Reveal" or
 * "Add / Remove" depending on `studioMode`.
 */

export type ToolId =
  | "move"
  | "brush"
  | "eraser"
  | "bucket"
  | "wand"
  | "eyedropper"
  | "zoom"
  | "hand"
  | "sam";

export interface ToolDef {
  id: ToolId;
  /** Short label shown beside the icon in the toolbox. */
  label: string;
  /** One-letter shortcut key (Photoshop convention). */
  shortcut: string;
  /** Hover tooltip; mode-aware copy is appended at render time. */
  tooltip: string;
  /** When true, this tool is available only in split mode (e.g. SAM). */
  splitOnly?: boolean;
  /** When true, this tool is available only in paint mode (e.g.
   *  Eyedropper has no meaning when painting masks). */
  paintOnly?: boolean;
}

export const TOOLS: readonly ToolDef[] = [
  {
    id: "move",
    label: "Move",
    shortcut: "V",
    tooltip: "캔버스 이동 / 줌만 가능 (편집 안 함)",
  },
  {
    id: "brush",
    label: "Brush",
    shortcut: "B",
    tooltip: "마스크 추가 (드래그)",
  },
  {
    id: "eraser",
    label: "Eraser",
    shortcut: "E",
    tooltip: "마스크 제거 (드래그)",
  },
  {
    id: "bucket",
    label: "Bucket",
    shortcut: "G",
    tooltip: "클릭한 픽셀과 연결된 영역 전체에 마스크 적용",
  },
  {
    id: "wand",
    label: "Wand",
    shortcut: "W",
    tooltip: "매직 셀렉터 — 비슷한 알파를 가진 영역을 선택",
  },
  {
    id: "eyedropper",
    label: "Eyedropper",
    shortcut: "I",
    tooltip: "픽셀 색을 추출해서 전경색으로 설정 (paint 모드)",
    paintOnly: true,
  },
  {
    id: "zoom",
    label: "Zoom",
    shortcut: "Z",
    tooltip: "클릭해서 확대 · Alt 클릭으로 축소",
  },
  {
    id: "hand",
    label: "Hand",
    shortcut: "H",
    tooltip: "캔버스 드래그로 패닝 (스페이스 누른 채 드래그도 가능)",
  },
  {
    id: "sam",
    label: "SAM",
    shortcut: "S",
    tooltip: "AI 자동 마스크 — 점 클릭으로 영역 추출 (split 모드 전용)",
    splitOnly: true,
  },
] as const;

/** Lookup helper — returns null when the key isn't bound to any tool. */
export function toolForShortcut(key: string): ToolId | null {
  const upper = key.toUpperCase();
  const found = TOOLS.find((t) => t.shortcut === upper);
  return found?.id ?? null;
}

/** Operation a brush-like tool performs on a mask canvas. */
export type BrushOp = "add" | "remove";

/** Studio mode the editor is currently in. Each mode has its own
 *  meaning for brush "add" / "remove" semantics — trim hides /
 *  reveals pixels via a single mask, split adds / removes pixels
 *  to / from named region masks, and paint actually paints colour
 *  pixels onto the layer texture (an eraser in paint mode wipes
 *  pixels to transparent rather than touching any mask). */
export type StudioMode = "trim" | "split" | "paint";

/** Returns the user-visible mode-aware label pair for the brush op
 *  selector — the OptionsBar shows this beside the active brush /
 *  eraser / bucket so the user knows what the stroke will do. */
export function brushOpLabels(studioMode: StudioMode): {
  add: string;
  remove: string;
} {
  if (studioMode === "trim") {
    // Trim mode masks hide pixels.
    return { add: "Hide", remove: "Reveal" };
  }
  if (studioMode === "paint") {
    // Paint mode writes / erases real texture pixels.
    return { add: "Paint", remove: "Erase" };
  }
  // Split mode masks define region membership.
  return { add: "Add", remove: "Remove" };
}

/** Selection op for the magic wand: how the new selection blends
 *  with whatever was previously selected. Same semantics as
 *  Photoshop's magic-wand option bar. */
export type SelectionOp = "replace" | "add" | "subtract" | "intersect";

export const SELECTION_OPS: { id: SelectionOp; label: string; tooltip: string }[] = [
  { id: "replace", label: "New", tooltip: "기존 선택 대체" },
  { id: "add", label: "Add", tooltip: "선택 추가 (Shift)" },
  { id: "subtract", label: "Sub", tooltip: "선택 제거 (Alt)" },
  { id: "intersect", label: "Int", tooltip: "교집합 (Shift+Alt)" },
];
