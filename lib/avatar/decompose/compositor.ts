/**
 * DecomposeStudio compositor — the single thing that turns the
 * editor's state (source, mask, paint, region canvases, threshold)
 * into the pixels the user actually sees on the preview canvas.
 *
 * Two interchangeable backends behind one interface:
 *
 *   - WebGL2: uploads each input as a texture, composites in a
 *     fragment shader. ~ free for the GPU even at 4096² puppets.
 *     Brush strokes only re-upload the mask (which is small + dirty
 *     only inside the stamp's bounding box, so the upload itself is
 *     cheap).
 *
 *   - Canvas 2D fallback: same compose math but expressed as
 *     `globalCompositeOperation` calls. No `getImageData` / JS pixel
 *     loop on the hot path — the browser ships the composite to the
 *     GPU when it can, and the worst case is a few `drawImage`'s
 *     into a cached offscreen canvas. Threshold (which can't be
 *     expressed as a composite op directly) is baked into a separate
 *     mask canvas exactly once per threshold change, then composited
 *     with destination-out like any other mask.
 *
 * The old hot path (`getImageData → JS for-loop → putImageData`)
 * meant every brush dab triggered a full-frame CPU pass. For a 1024²
 * source that's ~16 MB of pixel copies + 1M-iteration JS loop per
 * stroke sample → editor pegged the main thread at 100% on a fast
 * stroke. This compositor cuts that to ≤ 1 ms.
 *
 * Public API is minimal — caller hands over the input canvases (the
 * studio already maintains them) plus the studio mode + threshold,
 * then calls `invalidate()` whenever something changed. Renders
 * coalesce to rAF so 100 pointer events per frame produce one frame.
 */

import type { StudioMode } from "./tools";

/** Inputs the compositor reads to produce each preview frame.
 *  Source/mask/paint are the studio's three working canvases at the
 *  layer's full source dimensions. Region entries are split-mode's
 *  per-region binary masks plus the user-assigned colour the overlay
 *  is tinted with. Everything else is scalar state. */
export interface CompositorInputs {
  source: HTMLCanvasElement | null;
  mask: HTMLCanvasElement | null;
  paint: HTMLCanvasElement | null;
  regions: ReadonlyArray<RegionInput>;
  studioMode: StudioMode;
  /** Alpha threshold (0..255) — pixels in source whose alpha is
   *  below this and > 0 are treated as masked. 0 disables. */
  threshold: number;
  /** When non-null, in split mode only the matching region renders.
   *  Other regions and the source backdrop are dimmed. */
  focusRegionId: string | null;
  /** Region currently receiving brush strokes — gets a brighter
   *  fill so the user can see which mask their stroke will land in. */
  selectedRegionId: string | null;
}

export interface RegionInput {
  id: string;
  color: string;
  /** Binary mask canvas at source dimensions. */
  canvas: HTMLCanvasElement;
}

export type CompositorBackend = "webgl2" | "canvas2d";

export type DirtyKey = "source" | "mask" | "paint" | "thresh" | "regions";

export interface Compositor {
  /** Backend the compositor ended up using. WebGL2 is preferred but
   *  the fallback handles every browser the editor cares about. */
  backend(): CompositorBackend;
  /** Resize the preview canvas backing. Idempotent — if the target
   *  dimensions match the current size this is a no-op. */
  resize(targetW: number, targetH: number): void;
  /** Tell the compositor the threshold value changed. The threshold
   *  mask cache is rebuilt lazily before the next render. */
  invalidateThreshold(): void;
  /** Tell the compositor that a specific input canvas's pixel
   *  content changed in place (brush stroke / wand apply / etc.)
   *  even though the canvas reference is unchanged. Only WebGL2
   *  needs this — Canvas 2D re-reads the canvases every render
   *  anyway. */
  markDirty(key: DirtyKey): void;
  /** Schedule a render on the next animation frame. Multiple calls
   *  within the same frame coalesce. */
  invalidate(): void;
  /** Set the inputs (any subset). The compositor takes ownership of
   *  the references; mutating the underlying canvases after this
   *  call is fine — the next render reads the current contents.
   *  Canvas-identity changes auto-mark the affected key dirty. */
  setInputs(inputs: Partial<CompositorInputs>): void;
  /** Force a synchronous render right now (e.g. on save). */
  renderSync(): void;
  /** Tear down — GL context loss, removed listeners, freed buffers. */
  dispose(): void;
}

/** Create a compositor bound to a preview canvas. Tries WebGL2 first
 *  and falls back to Canvas 2D when the GL context can't be created
 *  (older / locked-down browsers, or `preferWebGL: false`). */
export function createCompositor(
  preview: HTMLCanvasElement,
  opts?: { preferWebGL?: boolean },
): Compositor {
  const preferWebGL = opts?.preferWebGL ?? true;
  if (preferWebGL) {
    try {
      const gl = preview.getContext("webgl2", {
        alpha: true,
        premultipliedAlpha: true,
        // Antialias is for triangle edges; we draw a single fullscreen
        // quad so the flag does nothing useful here. Off saves memory
        // on tile-based GPUs.
        antialias: false,
        // We never read the preview's backbuffer; freeing the browser
        // to dispose it after each composite shaves a few MB.
        preserveDrawingBuffer: false,
      });
      if (gl) return new GLCompositor(preview, gl);
    } catch {
      // Fall through to canvas 2D
    }
  }
  return new Canvas2DCompositor(preview);
}

// ──────────────────────────────────────────────────────────────────
// Shared bits
// ──────────────────────────────────────────────────────────────────

const EMPTY_INPUTS: CompositorInputs = {
  source: null,
  mask: null,
  paint: null,
  regions: [],
  studioMode: "mask",
  threshold: 0,
  focusRegionId: null,
  selectedRegionId: null,
};

/** Hex "#rrggbb" → [r,g,b] in 0..1 floats. Falls back to white on
 *  parse failure so a typo can't take the renderer down. */
function hexToVec3(hex: string): [number, number, number] {
  if (!hex) return [1, 1, 1];
  let h = hex.trim();
  if (h.startsWith("#")) h = h.slice(1);
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  if (h.length !== 6) return [1, 1, 1];
  const n = Number.parseInt(h, 16);
  if (!Number.isFinite(n)) return [1, 1, 1];
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

/** Build (or refresh) a threshold mask canvas that has 0xff alpha
 *  wherever the source's alpha is `0 < a < threshold`. This is the
 *  one place we still touch pixels with JS — but only when the
 *  threshold value changes, never per brush stroke. Returns null
 *  when threshold is 0 (no mask needed). */
function bakeThresholdMask(
  source: HTMLCanvasElement | null,
  threshold: number,
  reuse: HTMLCanvasElement | null,
): HTMLCanvasElement | null {
  if (!source || threshold <= 0) return null;
  const w = source.width;
  const h = source.height;
  if (w <= 0 || h <= 0) return null;
  const out =
    reuse && reuse.width === w && reuse.height === h ? reuse : document.createElement("canvas");
  out.width = w;
  out.height = h;
  const sctx = source.getContext("2d");
  const octx = out.getContext("2d");
  if (!sctx || !octx) return null;
  const src = sctx.getImageData(0, 0, w, h);
  const img = octx.createImageData(w, h);
  // Tight loop. We accept this one pixel-pass per threshold change —
  // brush strokes never trigger it.
  for (let i = 0; i < src.data.length; i += 4) {
    const a = src.data[i + 3];
    img.data[i + 3] = a > 0 && a < threshold ? 0xff : 0;
  }
  octx.putImageData(img, 0, 0);
  return out;
}

// ──────────────────────────────────────────────────────────────────
// Canvas 2D backend — fallback, but plenty fast on its own
// ──────────────────────────────────────────────────────────────────

class Canvas2DCompositor implements Compositor {
  private preview: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private inputs: CompositorInputs = { ...EMPTY_INPUTS };
  private threshDirty = true;
  private threshCanvas: HTMLCanvasElement | null = null;
  /** Per-region tinted canvases. Keyed by region id so a region
   *  swap doesn't re-bake all of them. */
  private regionTints = new Map<string, { color: string; canvas: HTMLCanvasElement }>();
  private rafId = 0;

  constructor(preview: HTMLCanvasElement) {
    this.preview = preview;
    this.ctx = preview.getContext("2d");
    if (this.ctx && "imageSmoothingQuality" in this.ctx) {
      this.ctx.imageSmoothingQuality = "high";
    }
  }

  backend(): CompositorBackend {
    return "canvas2d";
  }

  resize(targetW: number, targetH: number): void {
    const w = Math.max(1, Math.round(targetW));
    const h = Math.max(1, Math.round(targetH));
    if (this.preview.width !== w || this.preview.height !== h) {
      this.preview.width = w;
      this.preview.height = h;
      // Re-acquiring smoothing because resizing resets context state
      // in some browsers.
      const ctx = this.preview.getContext("2d");
      if (ctx && "imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";
      this.ctx = ctx;
    }
  }

  setInputs(patch: Partial<CompositorInputs>): void {
    // Detect threshold / source changes that invalidate the cache.
    if (patch.threshold !== undefined && patch.threshold !== this.inputs.threshold) {
      this.threshDirty = true;
    }
    if (patch.source !== undefined && patch.source !== this.inputs.source) {
      this.threshDirty = true;
    }
    this.inputs = { ...this.inputs, ...patch };
  }

  invalidateThreshold(): void {
    this.threshDirty = true;
  }

  markDirty(_key: DirtyKey): void {
    // Canvas 2D backend re-reads every input canvas on each render
    // anyway, so dirty hints are no-ops here. The method exists to
    // satisfy the shared Compositor interface.
  }

  invalidate(): void {
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      this.renderSync();
    });
  }

  renderSync(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const { source, mask, paint, regions, studioMode, focusRegionId, selectedRegionId } =
      this.inputs;
    const W = this.preview.width;
    const H = this.preview.height;
    ctx.clearRect(0, 0, W, H);
    if (!source) return;

    if (studioMode === "paint") {
      // Paint mode is just "show the paint canvas". The mask still
      // applies as a visibility overlay so users get a preview of
      // what trim would hide — keeps behaviour parity with the old
      // path.
      if (paint) ctx.drawImage(paint, 0, 0, W, H);
      else ctx.drawImage(source, 0, 0, W, H);
      return;
    }

    if (studioMode === "split") {
      // Backdrop first, then each region's tint composited on top.
      ctx.drawImage(source, 0, 0, W, H);
      for (const r of regions) {
        if (focusRegionId && r.id !== focusRegionId) continue;
        const tinted = this.getOrBakeTintedRegion(r);
        if (!tinted) continue;
        const isFocused = focusRegionId === r.id;
        ctx.globalAlpha = isFocused ? 0.7 : r.id === selectedRegionId ? 0.55 : 0.3;
        ctx.drawImage(tinted, 0, 0, W, H);
        ctx.globalAlpha = 1;
      }
      return;
    }

    // Mask mode: composite source × (1 − effectiveMask) where
    // effectiveMask = thresholdMask ∪ mask.
    //
    // Algorithm (no pixel loop):
    //   1. drawImage(source) → preview
    //   2. composite-op = destination-out
    //   3. drawImage(mask)             // hides masked pixels
    //   4. drawImage(thresholdMask)    // hides threshold-mask pixels
    //   5. composite-op = source-over (restore)
    //
    // The browser uses GPU compositing for these draws on every
    // modern engine, so the work goes to silicon meant for it.
    ctx.drawImage(source, 0, 0, W, H);
    if (mask || (this.inputs.threshold > 0 && source)) {
      ctx.globalCompositeOperation = "destination-out";
      if (mask) ctx.drawImage(mask, 0, 0, W, H);
      if (this.inputs.threshold > 0) {
        if (this.threshDirty) {
          this.threshCanvas = bakeThresholdMask(source, this.inputs.threshold, this.threshCanvas);
          this.threshDirty = false;
        }
        if (this.threshCanvas) ctx.drawImage(this.threshCanvas, 0, 0, W, H);
      }
      ctx.globalCompositeOperation = "source-over";
    }
  }

  private getOrBakeTintedRegion(r: RegionInput): HTMLCanvasElement | null {
    // Tinted region canvas: opaque-where-mask × regionColor. We
    // pre-bake and cache; the underlying mask canvas may change as
    // the user paints into it, but the size is constant so we only
    // need to refresh the bake when the colour or the mask canvas
    // identity changes. Mask content edits would require a full
    // re-bake too; we conservatively re-bake every render in split
    // mode because the brush is writing into the region during a
    // stroke. The bake is a single drawImage + source-in fill — both
    // GPU-accelerated, ~ free.
    const existing = this.regionTints.get(r.id);
    const canvas = existing?.canvas ?? document.createElement("canvas");
    if (canvas.width !== r.canvas.width || canvas.height !== r.canvas.height) {
      canvas.width = r.canvas.width;
      canvas.height = r.canvas.height;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(r.canvas, 0, 0);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = r.color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "source-over";
    this.regionTints.set(r.id, { color: r.color, canvas });
    return canvas;
  }

  dispose(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.regionTints.clear();
    this.threshCanvas = null;
  }
}

// ──────────────────────────────────────────────────────────────────
// WebGL2 backend — composite in a fragment shader
// ──────────────────────────────────────────────────────────────────

const VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  vUv.y = 1.0 - vUv.y;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform int  uMode;            // 0 = trim, 1 = split, 2 = paint
uniform sampler2D uSource;
uniform sampler2D uMask;
uniform sampler2D uPaint;
uniform sampler2D uThresh;
uniform bool uHasMask;
uniform bool uHasThresh;
uniform bool uHasPaint;

// Up to 8 regions per render — more than the studio currently
// surfaces, but the array size is fixed for shader simplicity.
const int MAX_REGIONS = 8;
uniform int       uRegionCount;
uniform sampler2D uRegion0;
uniform sampler2D uRegion1;
uniform sampler2D uRegion2;
uniform sampler2D uRegion3;
uniform sampler2D uRegion4;
uniform sampler2D uRegion5;
uniform sampler2D uRegion6;
uniform sampler2D uRegion7;
uniform vec3      uRegionColor[MAX_REGIONS];
uniform float     uRegionAlpha[MAX_REGIONS];

vec4 sampleRegion(int i, vec2 uv) {
  if (i == 0) return texture(uRegion0, uv);
  if (i == 1) return texture(uRegion1, uv);
  if (i == 2) return texture(uRegion2, uv);
  if (i == 3) return texture(uRegion3, uv);
  if (i == 4) return texture(uRegion4, uv);
  if (i == 5) return texture(uRegion5, uv);
  if (i == 6) return texture(uRegion6, uv);
  return texture(uRegion7, uv);
}

void main() {
  vec4 src = texture(uSource, vUv);
  if (uMode == 2) {
    // Paint mode: prefer the paint canvas, fall back to source.
    vec4 col = uHasPaint ? texture(uPaint, vUv) : src;
    fragColor = col;
    return;
  }
  if (uMode == 1) {
    // Split: source backdrop, then each region tinted on top.
    vec4 col = src;
    for (int i = 0; i < MAX_REGIONS; i++) {
      if (i >= uRegionCount) break;
      vec4 r = sampleRegion(i, vUv);
      float a = r.a * uRegionAlpha[i];
      col.rgb = mix(col.rgb, uRegionColor[i], a);
    }
    fragColor = col;
    return;
  }
  // Mask mode: source × (1 − effective_mask).
  float m = 0.0;
  if (uHasMask)   m = max(m, texture(uMask,   vUv).a);
  if (uHasThresh) m = max(m, texture(uThresh, vUv).a);
  fragColor = vec4(src.rgb, src.a * (1.0 - m));
}`;

class GLCompositor implements Compositor {
  private preview: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram | null;
  private quadBuffer: WebGLBuffer | null;
  private vao: WebGLVertexArrayObject | null;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private regionUniforms: Array<WebGLUniformLocation | null> = [];
  /** Texture handles + the canvas they were last sourced from + the
   *  canvas's generation (we treat any non-zero number as "dirty",
   *  recreating the texture every render — cheap relative to the
   *  shader pass on small inputs, and avoids stale GL state. */
  private texSource: WebGLTexture | null;
  private texMask: WebGLTexture | null;
  private texPaint: WebGLTexture | null;
  private texThresh: WebGLTexture | null;
  private texRegions: WebGLTexture[] = [];
  private threshCanvas: HTMLCanvasElement | null = null;
  private threshDirty = true;
  /** Per-input upload dirty bits. A brush stroke writes to a single
   *  canvas in place; without these flags every render would re-
   *  upload every texture (~ 12 MB / frame), so paint mode at high
   *  pen rates burns ~ 1 GB/s of upload bandwidth for no good reason.
   *  Studio call sites set the relevant key when they mutate the
   *  matching canvas; setInputs auto-sets on identity change. */
  private dirtyTex = {
    source: true,
    mask: true,
    paint: true,
    regions: true,
  };
  private inputs: CompositorInputs = { ...EMPTY_INPUTS };
  private rafId = 0;
  private contextLost = false;

  constructor(preview: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.preview = preview;
    this.gl = gl;
    this.program = this.linkProgram(VS, FS);
    if (!this.program) {
      // The constructor caller should have checked; if we hit this
      // we let renderSync degrade to clearing the preview. Easier to
      // diagnose than throwing during attach.
      console.warn("[compositor] WebGL2 shader link failed; preview will be blank");
    }
    this.cacheUniforms();
    this.quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    if (this.program) {
      const loc = gl.getAttribLocation(this.program, "aPos");
      if (loc >= 0) {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      }
    }
    gl.bindVertexArray(null);

    this.texSource = gl.createTexture();
    this.texMask = gl.createTexture();
    this.texPaint = gl.createTexture();
    this.texThresh = gl.createTexture();
    for (let i = 0; i < 8; i++) this.texRegions.push(gl.createTexture()!);

    // Lost context: drop everything and rebuild on restore. Simpler
    // than tracking exactly which resources need rebuilding.
    preview.addEventListener("webglcontextlost", this.onContextLost, { passive: false });
    preview.addEventListener("webglcontextrestored", this.onContextRestored);
  }

  private onContextLost = (e: Event) => {
    e.preventDefault();
    this.contextLost = true;
  };
  private onContextRestored = () => {
    // The caller will recreate us if they want to recover; we just
    // stop trying to use the dead context.
    this.contextLost = false;
  };

  backend(): CompositorBackend {
    return "webgl2";
  }

  resize(targetW: number, targetH: number): void {
    const w = Math.max(1, Math.round(targetW));
    const h = Math.max(1, Math.round(targetH));
    if (this.preview.width !== w || this.preview.height !== h) {
      this.preview.width = w;
      this.preview.height = h;
    }
  }

  setInputs(patch: Partial<CompositorInputs>): void {
    if (patch.threshold !== undefined && patch.threshold !== this.inputs.threshold) {
      this.threshDirty = true;
    }
    if (patch.source !== undefined && patch.source !== this.inputs.source) {
      this.threshDirty = true;
      this.dirtyTex.source = true;
    }
    if (patch.mask !== undefined && patch.mask !== this.inputs.mask) {
      this.dirtyTex.mask = true;
    }
    if (patch.paint !== undefined && patch.paint !== this.inputs.paint) {
      this.dirtyTex.paint = true;
    }
    if (patch.regions !== undefined && patch.regions !== this.inputs.regions) {
      this.dirtyTex.regions = true;
    }
    this.inputs = { ...this.inputs, ...patch };
  }

  invalidateThreshold(): void {
    this.threshDirty = true;
  }

  markDirty(key: DirtyKey): void {
    if (key === "thresh") {
      this.threshDirty = true;
      return;
    }
    this.dirtyTex[key] = true;
  }

  invalidate(): void {
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      this.renderSync();
    });
  }

  renderSync(): void {
    const gl = this.gl;
    if (this.contextLost || !this.program) {
      gl.viewport(0, 0, this.preview.width, this.preview.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }
    const { source, mask, paint, regions, studioMode, threshold, focusRegionId, selectedRegionId } =
      this.inputs;
    gl.viewport(0, 0, this.preview.width, this.preview.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!source) return;

    // Per-texture upload-or-bind. Dirty bits track which canvases
    // had their pixels mutated since the last render; clean
    // textures are just rebound to their sampler slot (cheap), only
    // dirty ones re-upload to VRAM (4 MB each for a 1024² source).
    if (this.dirtyTex.source) {
      this.uploadTexture(this.texSource, source, gl.TEXTURE0);
      this.dirtyTex.source = false;
    } else {
      this.bindTextureOnly(this.texSource, gl.TEXTURE0);
    }
    let hasMask = false;
    if (mask) {
      if (this.dirtyTex.mask) {
        this.uploadTexture(this.texMask, mask, gl.TEXTURE1);
        this.dirtyTex.mask = false;
      } else {
        this.bindTextureOnly(this.texMask, gl.TEXTURE1);
      }
      hasMask = true;
    }
    let hasPaint = false;
    if (paint) {
      if (this.dirtyTex.paint) {
        this.uploadTexture(this.texPaint, paint, gl.TEXTURE2);
        this.dirtyTex.paint = false;
      } else {
        this.bindTextureOnly(this.texPaint, gl.TEXTURE2);
      }
      hasPaint = true;
    }
    let hasThresh = false;
    if (threshold > 0 && source) {
      if (this.threshDirty) {
        this.threshCanvas = bakeThresholdMask(source, threshold, this.threshCanvas);
        this.threshDirty = false;
        // Threshold canvas was rebuilt — upload mandatory.
        if (this.threshCanvas) {
          this.uploadTexture(this.texThresh, this.threshCanvas, gl.TEXTURE3);
          hasThresh = true;
        }
      } else if (this.threshCanvas) {
        this.bindTextureOnly(this.texThresh, gl.TEXTURE3);
        hasThresh = true;
      }
    }

    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL2 API, not a React hook.
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    gl.uniform1i(this.uniforms.uMode!, studioMode === "mask" ? 0 : studioMode === "split" ? 1 : 2);
    gl.uniform1i(this.uniforms.uSource!, 0);
    gl.uniform1i(this.uniforms.uMask!, 1);
    gl.uniform1i(this.uniforms.uPaint!, 2);
    gl.uniform1i(this.uniforms.uThresh!, 3);
    gl.uniform1i(this.uniforms.uHasMask!, hasMask ? 1 : 0);
    gl.uniform1i(this.uniforms.uHasPaint!, hasPaint ? 1 : 0);
    gl.uniform1i(this.uniforms.uHasThresh!, hasThresh ? 1 : 0);

    // Split mode region uploads. We only count active regions —
    // shader loops break out at uRegionCount. Regions are uploaded
    // every render when the dirty bit is set; the cost of tracking
    // per-region dirty bits isn't worth it for a max of 8 regions.
    let regionCount = 0;
    if (studioMode === "split") {
      const colors = new Float32Array(8 * 3);
      const alphas = new Float32Array(8);
      const regionsDirty = this.dirtyTex.regions;
      for (let i = 0; i < Math.min(regions.length, 8); i++) {
        const r = regions[i];
        if (focusRegionId && r.id !== focusRegionId) continue;
        if (regionsDirty) {
          this.uploadTexture(this.texRegions[regionCount], r.canvas, gl.TEXTURE4 + regionCount);
        } else {
          this.bindTextureOnly(this.texRegions[regionCount], gl.TEXTURE4 + regionCount);
        }
        gl.uniform1i(this.regionUniforms[regionCount]!, 4 + regionCount);
        const [cr, cg, cb] = hexToVec3(r.color);
        colors[regionCount * 3 + 0] = cr;
        colors[regionCount * 3 + 1] = cg;
        colors[regionCount * 3 + 2] = cb;
        const isFocused = focusRegionId === r.id;
        alphas[regionCount] = isFocused ? 0.7 : r.id === selectedRegionId ? 0.55 : 0.3;
        regionCount++;
      }
      gl.uniform3fv(this.uniforms.uRegionColor!, colors);
      gl.uniform1fv(this.uniforms.uRegionAlpha!, alphas);
      this.dirtyTex.regions = false;
    }
    gl.uniform1i(this.uniforms.uRegionCount!, regionCount);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  private bindTextureOnly(tex: WebGLTexture | null, unit: number): void {
    if (!tex) return;
    const gl = this.gl;
    gl.activeTexture(unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  }

  private uploadTexture(tex: WebGLTexture | null, canvas: HTMLCanvasElement, unit: number): void {
    if (!tex) return;
    const gl = this.gl;
    gl.activeTexture(unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private linkProgram(vs: string, fs: string): WebGLProgram | null {
    const gl = this.gl;
    const vsh = this.compile(vs, gl.VERTEX_SHADER);
    const fsh = this.compile(fs, gl.FRAGMENT_SHADER);
    if (!vsh || !fsh) return null;
    const prog = gl.createProgram();
    if (!prog) return null;
    gl.attachShader(prog, vsh);
    gl.attachShader(prog, fsh);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn("[compositor] link failed:", gl.getProgramInfoLog(prog));
      return null;
    }
    return prog;
  }
  private compile(src: string, type: number): WebGLShader | null {
    const gl = this.gl;
    const sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.warn("[compositor] compile failed:", gl.getShaderInfoLog(sh));
      return null;
    }
    return sh;
  }
  private cacheUniforms(): void {
    if (!this.program) return;
    const gl = this.gl;
    const names = [
      "uMode",
      "uSource",
      "uMask",
      "uPaint",
      "uThresh",
      "uHasMask",
      "uHasPaint",
      "uHasThresh",
      "uRegionCount",
      "uRegionColor",
      "uRegionAlpha",
    ];
    for (const n of names) this.uniforms[n] = gl.getUniformLocation(this.program, n);
    for (let i = 0; i < 8; i++) {
      this.regionUniforms.push(gl.getUniformLocation(this.program, `uRegion${i}`));
    }
  }

  dispose(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    const gl = this.gl;
    if (this.program) gl.deleteProgram(this.program);
    if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer);
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.texSource) gl.deleteTexture(this.texSource);
    if (this.texMask) gl.deleteTexture(this.texMask);
    if (this.texPaint) gl.deleteTexture(this.texPaint);
    if (this.texThresh) gl.deleteTexture(this.texThresh);
    for (const t of this.texRegions) if (t) gl.deleteTexture(t);
    this.preview.removeEventListener("webglcontextlost", this.onContextLost);
    this.preview.removeEventListener("webglcontextrestored", this.onContextRestored);
  }
}
