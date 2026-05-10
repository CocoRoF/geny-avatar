"use client";

import {
  type BrushOp,
  brushOpLabels,
  type StudioMode,
  type ToolId,
} from "@/lib/avatar/decompose/tools";

/**
 * Top context-sensitive options bar — Photoshop-style.
 *
 * Renders different controls depending on which tool is currently
 * selected. The brush op label pair (Hide/Reveal vs Add/Remove)
 * comes from the tools module so the wording matches the studio
 * mode automatically.
 *
 * Kept presentational: state lives in the parent (DecomposeStudio),
 * this component just renders + emits change events.
 */
export interface OptionsBarProps {
  selectedTool: ToolId;
  studioMode: StudioMode;

  // Brush / Eraser / Bucket all share size + op
  brushSize: number;
  onBrushSize: (n: number) => void;
  brushOp: BrushOp;
  onBrushOp: (op: BrushOp) => void;
  brushHardness: number; // 0..100
  onBrushHardness: (n: number) => void;

  // Bucket + Wand share tolerance
  tolerance: number;
  onTolerance: (n: number) => void;

  // Threshold (trim only)
  threshold: number;
  onThreshold: (n: number) => void;

  // Zoom controls
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onActualSize: () => void;

  // Foreground colour for the Brush / Bucket / Wand-fill in paint
  // mode. Ignored in trim / split modes (where brush strokes are
  // always opaque white into the mask). Hex string e.g. "#ff0000".
  foregroundColor: string;
  onForegroundColor: (hex: string) => void;
}

export function OptionsBar(props: OptionsBarProps) {
  const {
    selectedTool,
    studioMode,
    brushSize,
    onBrushSize,
    brushOp,
    onBrushOp,
    brushHardness,
    onBrushHardness,
    tolerance,
    onTolerance,
    threshold,
    onThreshold,
    zoom,
    onZoomIn,
    onZoomOut,
    onFit,
    onActualSize,
    foregroundColor,
    onForegroundColor,
  } = props;

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-1.5 text-[11px]">
      {/* Foreground colour swatch — only meaningful in paint mode.
          Click to open the native colour picker. */}
      {studioMode === "paint" && (
        <div className="flex items-center gap-1.5">
          <span className="text-[var(--color-fg-dim)]">Colour:</span>
          <label
            className="block h-5 w-5 cursor-pointer rounded border border-[var(--color-border)]"
            style={{ background: foregroundColor }}
            title="전경색 — 클릭해서 변경 (paint 모드의 브러시 / 버킷 / 셀렉션 채우기 색)"
          >
            <input
              type="color"
              value={foregroundColor}
              onChange={(e) => onForegroundColor(e.target.value)}
              className="sr-only"
            />
          </label>
          <span className="font-mono text-[10px] text-[var(--color-fg-dim)]">
            {foregroundColor.toUpperCase()}
          </span>
        </div>
      )}
      {/* Tool-specific options */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {(selectedTool === "brush" || selectedTool === "eraser") && (
          <BrushOptions
            tool={selectedTool}
            studioMode={studioMode}
            brushSize={brushSize}
            onBrushSize={onBrushSize}
            brushOp={brushOp}
            onBrushOp={onBrushOp}
            brushHardness={brushHardness}
            onBrushHardness={onBrushHardness}
          />
        )}
        {selectedTool === "bucket" && (
          <BucketOptions
            studioMode={studioMode}
            tolerance={tolerance}
            onTolerance={onTolerance}
            brushOp={brushOp}
            onBrushOp={onBrushOp}
          />
        )}
        {selectedTool === "wand" && <WandOptions tolerance={tolerance} onTolerance={onTolerance} />}
        {selectedTool === "eyedropper" && (
          <span className="text-[var(--color-fg-dim)]">Click a pixel to set foreground color</span>
        )}
        {selectedTool === "move" && (
          <span className="text-[var(--color-fg-dim)]">
            Drag to pan · Wheel to zoom · Hold Space for Hand
          </span>
        )}
        {selectedTool === "hand" && (
          <span className="text-[var(--color-fg-dim)]">Drag canvas to pan</span>
        )}
        {selectedTool === "zoom" && (
          <span className="text-[var(--color-fg-dim)]">
            Click to zoom in · Alt+click to zoom out
          </span>
        )}
        {selectedTool === "sam" && (
          <span className="text-[var(--color-fg-dim)]">
            Left-click foreground · Right-click background · then Compute Mask in panel →
          </span>
        )}
      </div>

      {/* Trim threshold lives on the right since it applies all the
          time in trim mode regardless of the selected tool. */}
      {studioMode === "trim" && (
        <div className="flex items-center gap-2">
          <span className="text-[var(--color-fg-dim)]">Alpha:</span>
          <input
            type="range"
            min={0}
            max={255}
            value={threshold}
            onChange={(e) => onThreshold(Number(e.target.value))}
            className="w-32"
            title="Pixels with alpha below this value are masked. Raise to wipe out feathered edges."
          />
          <span className="w-10 font-mono text-[var(--color-fg-dim)]">{threshold}</span>
        </div>
      )}

      {/* Zoom controls — always visible */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onZoomOut}
          className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
          title="Zoom out (-)"
        >
          −
        </button>
        <span className="w-12 text-center font-mono text-[var(--color-fg-dim)]">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={onZoomIn}
          className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
          title="Zoom in (+)"
        >
          +
        </button>
        <button
          type="button"
          onClick={onFit}
          className="ml-1 rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
          title="Fit to screen (Ctrl+0)"
        >
          Fit
        </button>
        <button
          type="button"
          onClick={onActualSize}
          className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
          title="Actual size 100% (Ctrl+1)"
        >
          1:1
        </button>
      </div>
    </div>
  );
}

function BrushOptions({
  tool,
  studioMode,
  brushSize,
  onBrushSize,
  brushOp,
  onBrushOp,
  brushHardness,
  onBrushHardness,
}: {
  tool: "brush" | "eraser";
  studioMode: StudioMode;
  brushSize: number;
  onBrushSize: (n: number) => void;
  brushOp: BrushOp;
  onBrushOp: (op: BrushOp) => void;
  brushHardness: number;
  onBrushHardness: (n: number) => void;
}) {
  const labels = brushOpLabels(studioMode);
  // Brush is always "add", Eraser is always "remove" — but we still
  // expose the toggle so the user can swap a brush into reveal mode
  // without leaving the brush tool. Photoshop hides this for the
  // eraser since "erase eraser" is nonsense; we follow suit.
  return (
    <>
      {tool === "brush" && (
        <div className="flex items-center gap-1">
          <span className="text-[var(--color-fg-dim)]">Mode:</span>
          <button
            type="button"
            onClick={() => onBrushOp("add")}
            className={`rounded border px-2 py-0.5 ${
              brushOp === "add"
                ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                : "border-[var(--color-border)] text-[var(--color-fg-dim)]"
            }`}
            title={`${labels.add} — ${studioMode === "trim" ? "스트로크한 픽셀을 마스크로 숨김" : "선택된 영역에 픽셀 추가"}`}
          >
            {labels.add}
          </button>
          <button
            type="button"
            onClick={() => onBrushOp("remove")}
            className={`rounded border px-2 py-0.5 ${
              brushOp === "remove"
                ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                : "border-[var(--color-border)] text-[var(--color-fg-dim)]"
            }`}
            title={`${labels.remove} — X 키로 토글`}
          >
            {labels.remove}
          </button>
        </div>
      )}
      <div className="flex items-center gap-2">
        <span className="text-[var(--color-fg-dim)]">Size:</span>
        <input
          type="range"
          min={1}
          max={400}
          value={brushSize}
          onChange={(e) => onBrushSize(Number(e.target.value))}
          className="w-32"
          title="브러시 크기 — [ / ] 키로 ±5px"
        />
        <span className="w-10 font-mono text-[var(--color-fg-dim)]">{brushSize}px</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[var(--color-fg-dim)]">Hardness:</span>
        <input
          type="range"
          min={0}
          max={100}
          value={brushHardness}
          onChange={(e) => onBrushHardness(Number(e.target.value))}
          className="w-24"
          title="브러시 가장자리 부드러움 — 100% 가 가장 단단함"
        />
        <span className="w-10 font-mono text-[var(--color-fg-dim)]">{brushHardness}%</span>
      </div>
    </>
  );
}

function BucketOptions({
  studioMode,
  tolerance,
  onTolerance,
  brushOp,
  onBrushOp,
}: {
  studioMode: StudioMode;
  tolerance: number;
  onTolerance: (n: number) => void;
  brushOp: BrushOp;
  onBrushOp: (op: BrushOp) => void;
}) {
  const labels = brushOpLabels(studioMode);
  return (
    <>
      <div className="flex items-center gap-1">
        <span className="text-[var(--color-fg-dim)]">Mode:</span>
        <button
          type="button"
          onClick={() => onBrushOp("add")}
          className={`rounded border px-2 py-0.5 ${
            brushOp === "add"
              ? "border-[var(--color-accent)] text-[var(--color-accent)]"
              : "border-[var(--color-border)] text-[var(--color-fg-dim)]"
          }`}
        >
          {labels.add}
        </button>
        <button
          type="button"
          onClick={() => onBrushOp("remove")}
          className={`rounded border px-2 py-0.5 ${
            brushOp === "remove"
              ? "border-[var(--color-accent)] text-[var(--color-accent)]"
              : "border-[var(--color-border)] text-[var(--color-fg-dim)]"
          }`}
        >
          {labels.remove}
        </button>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[var(--color-fg-dim)]">Tolerance:</span>
        <input
          type="range"
          min={0}
          max={128}
          value={tolerance}
          onChange={(e) => onTolerance(Number(e.target.value))}
          className="w-32"
          title="알파 차이 허용치 — 클릭한 픽셀과의 알파 차이가 이 값 이하인 픽셀만 채움"
        />
        <span className="w-10 font-mono text-[var(--color-fg-dim)]">{tolerance}</span>
      </div>
    </>
  );
}

function WandOptions({
  tolerance,
  onTolerance,
}: {
  tolerance: number;
  onTolerance: (n: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[var(--color-fg-dim)]">Tolerance:</span>
      <input
        type="range"
        min={0}
        max={128}
        value={tolerance}
        onChange={(e) => onTolerance(Number(e.target.value))}
        className="w-32"
        title="비슷한 알파 픽셀까지 선택 — 0 = 정확히 일치, 32 = feathered edge 까지"
      />
      <span className="w-10 font-mono text-[var(--color-fg-dim)]">{tolerance}</span>
      <span className="ml-2 text-[var(--color-fg-dim)]">Shift+click 추가 · Alt+click 제거</span>
    </div>
  );
}
