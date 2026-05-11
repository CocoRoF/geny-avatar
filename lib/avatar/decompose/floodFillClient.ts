/**
 * Main-thread wrapper around the flood-fill worker.
 *
 * Three responsibilities:
 *
 *   1. Lazily spin up the worker the first time someone requests a
 *      flood — saves the bundle/parse cost when the wand tool is
 *      never touched in a session.
 *
 *   2. Multiplex requests by ticket id, so the bucket and wand tools
 *      can share one worker without interfering. The latest request
 *      from a single owner wins — earlier in-flight tickets from the
 *      same owner are resolved with `{ aborted: true }`.
 *
 *   3. Marshal the source canvas → `Uint8ClampedArray` once per call
 *      via `getImageData`, then transfer ownership of the buffer
 *      into the worker. Result mask comes back the same way (zero
 *      copy).
 *
 * Tomorrow's improvement: keep a long-lived worker-side cache of the
 * source pixels so back-to-back wand clicks at different seeds skip
 * the upload. Not worth the complexity until pen-tablet users start
 * spamming wand clicks; today's design is fine for a click + drag.
 */

import type { FloodResponse, SampleMode } from "./floodFillWorker";

export interface FloodArgs {
  source: HTMLCanvasElement;
  seedX: number;
  seedY: number;
  tolerance: number;
  sampleMode?: SampleMode;
  sampleSize?: number;
  contiguous?: boolean;
  antiAlias?: boolean;
  /** When set, an earlier in-flight call from the same owner
   *  resolves with aborted=true so its result can be ignored. */
  ownerKey?: string;
}

export interface FloodResult {
  /** 1 byte / pixel; 0xff inside, 0x80 = anti-alias edge, 0x00 outside. */
  mask: Uint8ClampedArray;
  width: number;
  height: number;
  area: number;
  /** True when the call was superseded by a later call from the
   *  same owner. Callers should drop aborted results. */
  aborted: boolean;
}

let _worker: Worker | null = null;
let _ticket = 0;
const _pending = new Map<
  number,
  {
    resolve: (r: FloodResult) => void;
    reject: (e: unknown) => void;
    width: number;
    height: number;
    ownerKey?: string;
  }
>();
const _latestByOwner = new Map<string, number>();

function getWorker(): Worker {
  if (_worker) return _worker;
  // The `?worker` query is the Next.js / webpack convention for
  // importing the module as a Worker constructor. We use the inline
  // form so the worker bundles into the editor and doesn't need an
  // extra HTTP fetch on first wand click.
  // The @ts-expect-error is for the bundler-specific URL pattern that
  // TypeScript doesn't model natively.
  const url = new URL("./floodFillWorker.ts", import.meta.url);
  _worker = new Worker(url, { type: "module" });
  _worker.onmessage = (ev: MessageEvent<FloodResponse>) => {
    const entry = _pending.get(ev.data.id);
    if (!entry) return;
    _pending.delete(ev.data.id);
    const aborted = entry.ownerKey ? _latestByOwner.get(entry.ownerKey) !== ev.data.id : false;
    entry.resolve({
      mask: ev.data.mask,
      width: entry.width,
      height: entry.height,
      area: ev.data.area,
      aborted,
    });
  };
  _worker.onerror = (e) => {
    // Surface to all pending tickets so callers don't hang forever.
    for (const [id, entry] of _pending) {
      entry.reject(e);
      _pending.delete(id);
    }
  };
  return _worker;
}

/** Run a flood fill in the worker. Returns the result mask + area.
 *  Rejects only on transport-level errors; the worker's "empty
 *  fill" outcome arrives as a zero-area result, not a rejection. */
export async function runFlood(args: FloodArgs): Promise<FloodResult> {
  const {
    source,
    seedX,
    seedY,
    tolerance,
    sampleMode = "alpha",
    sampleSize = 1,
    contiguous = true,
    antiAlias = false,
    ownerKey,
  } = args;
  const w = source.width;
  const h = source.height;
  if (w <= 0 || h <= 0) {
    return { mask: new Uint8ClampedArray(0), width: 0, height: 0, area: 0, aborted: false };
  }
  // Snapshot the source pixels. This is the one main-thread cost —
  // a single getImageData. Browser does the GPU→CPU readback once
  // per wand click, not per stroke sample.
  const ctx = source.getContext("2d");
  if (!ctx) throw new Error("source has no 2d context");
  const data = ctx.getImageData(0, 0, w, h).data;

  const id = ++_ticket;
  if (ownerKey) _latestByOwner.set(ownerKey, id);
  const worker = getWorker();
  return new Promise<FloodResult>((resolve, reject) => {
    _pending.set(id, { resolve, reject, width: w, height: h, ownerKey });
    worker.postMessage(
      {
        id,
        pixels: data,
        width: w,
        height: h,
        seedX: Math.floor(seedX),
        seedY: Math.floor(seedY),
        tolerance,
        sampleMode,
        sampleSize,
        contiguous,
        antiAlias,
      },
      [data.buffer],
    );
  });
}

/** Convert a worker-produced byte mask into a same-dim RGBA canvas
 *  (opaque white inside, transparent outside). Used by the bucket
 *  tool to drawImage the result into the active target canvas. */
export function maskToCanvas(result: FloodResult): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = result.width;
  c.height = result.height;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  const img = ctx.createImageData(result.width, result.height);
  for (let i = 0; i < result.mask.length; i++) {
    const a = result.mask[i];
    img.data[i * 4 + 0] = 255;
    img.data[i * 4 + 1] = 255;
    img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = a;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
