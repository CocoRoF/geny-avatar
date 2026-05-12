"use client";

import {
  type BrushOp,
  brushOpLabels,
  type StudioMode,
  type ToolId,
  type WandOptions as WandOptionsType,
  type WandSampleMode,
  type WandSampleSize,
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

  // Bucket tolerance (independent of wand)
  tolerance: number;
  onTolerance: (n: number) => void;

  // Wand: full options object — see WandOptionsType in tools.ts
  wand: WandOptionsType;
  onWand: (next: WandOptionsType) => void;

  // Pressure dynamics — pen tablet support
  pressureSize: boolean;
  pressureOpacity: boolean;
  onPressureSize: (v: boolean) => void;
  onPressureOpacity: (v: boolean) => void;

  // Edge quality — high stores the mask at 2x source for crisper
  // boundaries at deep zoom. Memory cost 4x.
  highDpiMask: boolean;
  onHighDpiMask: (v: boolean) => void;

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
    wand,
    onWand,
    pressureSize,
    pressureOpacity,
    onPressureSize,
    onPressureOpacity,
    highDpiMask,
    onHighDpiMask,
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
            studioMode={studioMode}
            brushSize={brushSize}
            onBrushSize={onBrushSize}
            brushHardness={brushHardness}
            onBrushHardness={onBrushHardness}
            pressureSize={pressureSize}
            pressureOpacity={pressureOpacity}
            onPressureSize={onPressureSize}
            onPressureOpacity={onPressureOpacity}
            highDpiMask={highDpiMask}
            onHighDpiMask={onHighDpiMask}
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
        {selectedTool === "wand" && <WandOptions wand={wand} onWand={onWand} />}
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

      {/* Mask threshold lives on the right since it applies all the
          time in mask mode regardless of the selected tool. */}
      {studioMode === "mask" && (
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
  studioMode,
  brushSize,
  onBrushSize,
  brushHardness,
  onBrushHardness,
  pressureSize,
  pressureOpacity,
  onPressureSize,
  onPressureOpacity,
  highDpiMask,
  onHighDpiMask,
}: {
  studioMode: StudioMode;
  brushSize: number;
  onBrushSize: (n: number) => void;
  brushHardness: number;
  onBrushHardness: (n: number) => void;
  pressureSize: boolean;
  pressureOpacity: boolean;
  onPressureSize: (v: boolean) => void;
  onPressureOpacity: (v: boolean) => void;
  highDpiMask: boolean;
  onHighDpiMask: (v: boolean) => void;
}) {
  // The brush + eraser tools intentionally don't expose a "Mode"
  // toggle anymore. Brush always adds, eraser always removes —
  // pressing X swaps between the two tools (the Photoshop B↔E
  // pattern, handled by the studio's keydown handler). The Bucket
  // keeps its toggle since there's no "eraser-flavoured bucket"
  // tool to flip to.
  return (
    <>
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
      {/* Pen pressure dynamics — only meaningful when a pen tablet is
          plugged in, but the toggle is harmless on a mouse (defaults
          to 0.5 pressure → no effect). */}
      <div className="flex items-center gap-1">
        <span className="text-[var(--color-fg-dim)]">Pen:</span>
        <Toggle
          on={pressureSize}
          onToggle={() => onPressureSize(!pressureSize)}
          title="펜 압력으로 브러시 크기 조절 (펜타블릿 사용 시)"
          label="Size"
        />
        <Toggle
          on={pressureOpacity}
          onToggle={() => onPressureOpacity(!pressureOpacity)}
          title="펜 압력으로 불투명도 조절"
          label="Opacity"
        />
      </div>
      {studioMode === "mask" && (
        <Toggle
          on={highDpiMask}
          onToggle={() => onHighDpiMask(!highDpiMask)}
          title="마스크를 2× 해상도로 저장 — 깊은 줌에서 가장자리가 또렷해짐. 메모리 4배."
          label="HD edge"
        />
      )}
    </>
  );
}

function Toggle({
  on,
  onToggle,
  title,
  label,
}: {
  on: boolean;
  onToggle: () => void;
  title: string;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={title}
      className={`rounded border px-1.5 py-0.5 text-[10px] ${
        on
          ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
          : "border-[var(--color-border)] text-[var(--color-fg-dim)]"
      }`}
    >
      {label}
    </button>
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
  wand,
  onWand,
}: {
  wand: WandOptionsType;
  onWand: (next: WandOptionsType) => void;
}) {
  const set = <K extends keyof WandOptionsType>(k: K, v: WandOptionsType[K]) =>
    onWand({ ...wand, [k]: v });

  return (
    <>
      {/* Tolerance — same slider as before, now part of a fuller bar. */}
      <div className="flex items-center gap-2">
        <span className="text-[var(--color-fg-dim)]">Tolerance:</span>
        <input
          type="range"
          min={0}
          max={128}
          value={wand.tolerance}
          onChange={(e) => set("tolerance", Number(e.target.value))}
          className="w-28"
          title="비슷한 픽셀까지 선택 — 0 = 정확히 일치, 32 = feathered edge 까지"
        />
        <span className="w-8 font-mono text-[var(--color-fg-dim)]">{wand.tolerance}</span>
      </div>

      {/* Sample mode — what the wand compares against the seed.
          alpha = footprint-based (default), luminance = brightness,
          rgb = colour. */}
      <Segmented
        label="Sample"
        value={wand.sampleMode}
        options={[
          { v: "alpha", label: "α", title: "Alpha — 가장 무난한 footprint 검출" },
          { v: "luminance", label: "L", title: "Luminance — 밝기 기준" },
          { v: "rgb", label: "RGB", title: "RGB — 색상 기준 (Max-channel 거리)" },
        ]}
        onChange={(v) => set("sampleMode", v as WandSampleMode)}
      />

      {/* Sample size — seed averaging window. */}
      <Segmented
        label="Size"
        value={String(wand.sampleSize)}
        options={[
          { v: "1", label: "1", title: "단일 픽셀 (정확)" },
          { v: "3", label: "3×3", title: "3×3 평균 (잡음 완화)" },
          { v: "5", label: "5×5", title: "5×5 평균" },
          { v: "11", label: "11×11", title: "11×11 평균 (덩어리 검출)" },
        ]}
        onChange={(v) => set("sampleSize", Number(v) as WandSampleSize)}
      />

      <Toggle
        on={wand.contiguous}
        onToggle={() => set("contiguous", !wand.contiguous)}
        title="Contiguous — 연결된 영역만 선택. 끄면 비슷한 알파의 모든 픽셀 선택."
        label="Contig."
      />
      <Toggle
        on={wand.antiAlias}
        onToggle={() => set("antiAlias", !wand.antiAlias)}
        title="Anti-alias — 선택 가장자리를 1픽셀 부드럽게"
        label="AA"
      />

      <span className="ml-1 hidden text-[10px] text-[var(--color-fg-dim)] lg:inline">
        Click=새 선택 · Shift+ 추가 · Alt+ 제거 · Shift+Alt= 교집합
      </span>
    </>
  );
}

function Segmented({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { v: string; label: string; title: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[var(--color-fg-dim)]">{label}:</span>
      <div className="flex overflow-hidden rounded border border-[var(--color-border)]">
        {options.map((o, i) => (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            title={o.title}
            className={`${i > 0 ? "border-l border-[var(--color-border)]" : ""} px-1.5 py-0.5 text-[10px] ${
              value === o.v
                ? "bg-[var(--color-accent)]/15 text-[var(--color-accent)]"
                : "text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
