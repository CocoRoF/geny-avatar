import { unzipSync } from "fflate";
import type { AdapterLoadInput } from "../adapters/AvatarAdapter";
import { detectFromFilenames } from "../adapters/AvatarRegistry";
import { rewriteLive2DManifest, rewriteSpineAtlas } from "./rewrite";
import type { BundleEntry, ParsedBundle } from "./types";

/**
 * Parse a dropped file/set of files OR a previously-stored BundleEntry[]
 * (from IndexedDB) into a ParsedBundle that an adapter can immediately
 * load.
 *
 * Accepts:
 *   - A single ZIP File (auto-extracted via fflate)
 *   - A flat array of File objects (folder drop / file picker)
 *   - An array of pre-built BundleEntry objects (IndexedDB replay)
 *
 * Pipeline:
 *   1. Normalize input → BundleEntry[]
 *   2. Filename-only detection (which adapter)
 *   3. Walk the manifest, rewrite to blob URLs, validate references
 *   4. Build the adapter LoadInput
 */
export async function parseBundle(input: File | File[] | BundleEntry[]): Promise<ParsedBundle> {
  let entries: BundleEntry[];

  if (Array.isArray(input) && input.length > 0 && isBundleEntryArray(input)) {
    entries = input;
  } else {
    const files = Array.isArray(input) ? (input as File[]) : [input as File];
    if (files.length === 1 && files[0].name.toLowerCase().endsWith(".zip")) {
      entries = await unpackZip(files[0]);
    } else {
      entries = files.map(fileToEntry);
    }
  }

  if (entries.length === 0) {
    return {
      ok: false,
      reason: "no files in the dropped bundle",
      entries: new Map(),
      detection: null,
    };
  }

  const map = new Map<string, BundleEntry>();
  for (const e of entries) {
    map.set(e.path.toLowerCase(), e);
  }

  const filenames = entries.map((e) => e.path);
  const detected = detectFromFilenames(filenames);
  if (!detected) {
    return {
      ok: false,
      reason: `couldn't identify the runtime — ${filenames.length} files, none matched Spine or Cubism heuristics`,
      entries: map,
      detection: null,
    };
  }

  const urls: string[] = [];
  const warnings: string[] = [];

  // Promote BundleEntry → adapter LoadInput by walking the manifest of
  // the chosen runtime. Each adapter has its own manifest format.
  if (detected.result.runtime === "spine") {
    return await buildSpineLoadInput(entries, map, urls, warnings, detected.result.confidence);
  }
  if (detected.result.runtime === "live2d") {
    return await buildLive2DLoadInput(entries, map, urls, warnings, detected.result.confidence);
  }

  return {
    ok: false,
    reason: `unknown runtime ${detected.result.runtime}`,
    entries: map,
    detection: detected.result,
  };
}

/** Free all blob URLs created for a parsed bundle. Call when the editor
 *  is unmounting or about to load a new puppet. */
export function disposeBundle(parsed: ParsedBundle): void {
  if (!parsed.ok) return;
  for (const url of parsed.urls) {
    URL.revokeObjectURL(url);
  }
}

// ----- internals -----

function isBundleEntryArray(arr: unknown[]): arr is BundleEntry[] {
  // narrow heuristic — first element has `path` string + `blob` Blob.
  const first = arr[0] as Partial<BundleEntry> | undefined;
  return !!(
    first &&
    typeof first.path === "string" &&
    first.blob instanceof Blob &&
    !(first instanceof File)
  );
}

function fileToEntry(file: File): BundleEntry {
  // browsers may put a relative path in webkitRelativePath when a folder
  // is dropped; fall back to file.name for flat picks.
  const wkPath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  const path = wkPath && wkPath.length > 0 ? wkPath : file.name;
  return { name: file.name, path, size: file.size, blob: file };
}

async function unpackZip(zipFile: File): Promise<BundleEntry[]> {
  const buffer = new Uint8Array(await zipFile.arrayBuffer());
  const unzipped = unzipSync(buffer);
  const out: BundleEntry[] = [];
  for (const [rawPath, bytes] of Object.entries(unzipped)) {
    // skip directory entries — fflate emits them as zero-byte trailing-slash names
    if (rawPath.endsWith("/") || bytes.byteLength === 0) continue;
    const path = recodeZipName(rawPath);
    const name = path.split("/").pop() ?? path;
    // wrap the Uint8Array so the underlying ArrayBuffer can be reused; we
    // construct the Blob lazily so memory isn't doubled until needed.
    const blob = new Blob([new Uint8Array(bytes)]);
    out.push({ name, path, size: bytes.byteLength, blob });
  }
  return out;
}

/**
 * fflate decodes ZIP file names as latin-ish (CP437) when the ZIP doesn't
 * set the UTF-8 general-purpose flag. Many real-world tools (Windows
 * Explorer pre-2018, some Chinese/Korean/Japanese OSes) write UTF-8 bytes
 * without setting that flag, so we get mojibake like
 *   "免费模型艾莲" → "Ãå · ÑÅéÐ¦ ¬Ä~"
 *
 * Recover by re-extracting the original bytes (each char is 0-255) and
 * trying common decodings in order: UTF-8 (most likely), GBK (Simplified
 * Chinese), Shift_JIS (Japanese). UTF-8 in fatal mode rejects invalid
 * sequences; if it succeeds, the recovered name is identical to the
 * original.
 */
function recodeZipName(name: string): string {
  // ASCII names need no recoding
  let allAscii = true;
  for (let i = 0; i < name.length; i++) {
    if (name.charCodeAt(i) > 127) {
      allAscii = false;
      break;
    }
  }
  if (allAscii) return name;

  const bytes = new Uint8Array(name.length);
  for (let i = 0; i < name.length; i++) bytes[i] = name.charCodeAt(i) & 0xff;

  for (const encoding of ["utf-8", "gbk", "shift_jis", "euc-kr"] as const) {
    try {
      const decoded = new TextDecoder(encoding, { fatal: true }).decode(bytes);
      // sanity — decoded shouldn't contain replacement chars even in
      // non-fatal cases, and shouldn't be longer than original bytes
      // unless the encoding genuinely expanded.
      if (!decoded.includes("�")) return decoded;
    } catch {
      // this encoding rejected the byte sequence; try the next.
    }
  }
  return name;
}

function makeUrl(entry: BundleEntry, sink: string[]): string {
  const url = URL.createObjectURL(entry.blob);
  sink.push(url);
  return url;
}

// ----- Spine -----

async function buildSpineLoadInput(
  entries: BundleEntry[],
  map: Map<string, BundleEntry>,
  urls: string[],
  warnings: string[],
  confidence: "high" | "low",
): Promise<ParsedBundle> {
  const skel = entries.find((e) => e.name.toLowerCase().endsWith(".skel"));
  const json = entries.find(
    (e) =>
      e.name.toLowerCase().endsWith(".json") &&
      !e.name.toLowerCase().endsWith(".model3.json") &&
      !e.path.toLowerCase().includes("motion"),
  );
  const skeleton = skel ?? json;
  const atlas = entries.find((e) => e.name.toLowerCase().endsWith(".atlas"));
  const pages = entries.filter((e) => e.name.toLowerCase().endsWith(".png"));

  if (!skeleton) {
    return {
      ok: false,
      reason: "Spine bundle has neither .skel nor .json skeleton file",
      entries: map,
      detection: { runtime: "spine", confidence },
    };
  }
  if (!atlas) {
    return {
      ok: false,
      reason: "Spine bundle is missing the .atlas file",
      entries: map,
      detection: { runtime: "spine", confidence },
    };
  }
  if (pages.length === 0) {
    warnings.push("no PNG atlas pages found — render will likely be blank");
  }

  // Rewrite the atlas so its page-name lines point at the PNG entries'
  // blob URLs. Without this, spine-pixi-v8's loader resolves page names
  // relative to the atlas URL, which fails for blob: URLs.
  const rewrittenAtlas = await rewriteSpineAtlas(atlas, map, warnings, urls);
  const atlasUrl = URL.createObjectURL(rewrittenAtlas);
  urls.push(atlasUrl);

  const loadInput: AdapterLoadInput = {
    kind: "spine",
    skeleton: makeUrl(skeleton, urls),
    atlas: atlasUrl,
  };

  return {
    ok: true,
    detection: { runtime: "spine", confidence },
    loadInput,
    entries: map,
    urls,
    warnings,
  };
}

// ----- Live2D -----

async function buildLive2DLoadInput(
  entries: BundleEntry[],
  map: Map<string, BundleEntry>,
  urls: string[],
  warnings: string[],
  confidence: "high" | "low",
): Promise<ParsedBundle> {
  const manifest = entries.find((e) => e.name.toLowerCase().endsWith(".model3.json"));
  if (!manifest) {
    if (entries.some((e) => e.name.toLowerCase().endsWith(".moc"))) {
      return {
        ok: false,
        reason:
          "Cubism 2/3 bundle (.moc) detected — this build only loads Cubism 4/5 model3.json. Open in Cubism Editor 4+ and re-export.",
        entries: map,
        detection: { runtime: "live2d", version: "Cubism2/3", confidence },
      };
    }
    return {
      ok: false,
      reason: "Cubism bundle is missing the .model3.json manifest",
      entries: map,
      detection: { runtime: "live2d", confidence },
    };
  }

  // Rewrite the manifest so every FileReferences entry is a blob URL
  // resolved against the bundle. Live2DModel.from() then fetches sibling
  // assets directly by absolute blob URL — no relative-resolve needed.
  const rewritten = await rewriteLive2DManifest(manifest, map, warnings, urls);
  if (!rewritten) {
    return {
      ok: false,
      reason: "could not parse model3.json — manifest is invalid",
      entries: map,
      detection: { runtime: "live2d", confidence },
    };
  }
  const manifestUrl = URL.createObjectURL(rewritten);
  urls.push(manifestUrl);

  const loadInput: AdapterLoadInput = {
    kind: "live2d",
    model3: manifestUrl,
  };

  return {
    ok: true,
    detection: { runtime: "live2d", version: "Cubism4+", confidence },
    loadInput,
    entries: map,
    urls,
    warnings,
  };
}
