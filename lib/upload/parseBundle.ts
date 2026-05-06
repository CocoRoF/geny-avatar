import { unzipSync } from "fflate";
import type { AdapterLoadInput } from "../adapters/AvatarAdapter";
import { detectFromFilenames } from "../adapters/AvatarRegistry";
import type { BundleEntry, ParsedBundle } from "./types";

/**
 * Parse a dropped file or set of files into a ParsedBundle that an adapter
 * can immediately load.
 *
 * Accepts:
 *   - A single ZIP File (auto-extracted via fflate)
 *   - A flat array of File objects (from a directory drop)
 *
 * Pipeline:
 *   1. Normalize input → BundleEntry[] with blob + path
 *   2. Filename-only detection (which adapter)
 *   3. Confirm via manifest read — model3.json for Live2D, atlas/skel for Spine
 *   4. Build the adapter LoadInput pointing at blob URLs
 */
export async function parseBundle(input: File | File[]): Promise<ParsedBundle> {
  const files = Array.isArray(input) ? input : [input];
  let entries: BundleEntry[];

  if (files.length === 1 && files[0].name.toLowerCase().endsWith(".zip")) {
    entries = await unpackZip(files[0]);
  } else {
    entries = files.map(fileToEntry);
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
    return buildSpineLoadInput(entries, map, urls, warnings, detected.result.confidence);
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
  for (const [path, bytes] of Object.entries(unzipped)) {
    // skip directory entries — fflate emits them as zero-byte trailing-slash names
    if (path.endsWith("/") || bytes.byteLength === 0) continue;
    const name = path.split("/").pop() ?? path;
    // wrap the Uint8Array so the underlying ArrayBuffer can be reused; we
    // construct the Blob lazily so memory isn't doubled until needed.
    const blob = new Blob([new Uint8Array(bytes)]);
    out.push({ name, path, size: bytes.byteLength, blob });
  }
  return out;
}

function makeUrl(entry: BundleEntry, sink: string[]): string {
  const url = URL.createObjectURL(entry.blob);
  sink.push(url);
  return url;
}

// ----- Spine -----

function buildSpineLoadInput(
  entries: BundleEntry[],
  map: Map<string, BundleEntry>,
  urls: string[],
  warnings: string[],
  confidence: "high" | "low",
): ParsedBundle {
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

  const loadInput: AdapterLoadInput = {
    kind: "spine",
    skeleton: makeUrl(skeleton, urls),
    atlas: makeUrl(atlas, urls),
  };

  // We don't put page URLs into AdapterLoadInput today — Pixi Assets
  // resolves atlas page filenames at load time. The page→blob mapping
  // is exposed via `entries` for sprint 1.3b's atlas page rewrite.
  for (const page of pages) makeUrl(page, urls);

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

  // Read the manifest and check that referenced files actually exist in
  // the bundle. Live2DModel.from() will fetch them by URL relative to
  // the manifest URL, so we point it at the manifest's blob URL — but
  // sibling URLs need to be resolvable. For Sprint 1.3a we just confirm
  // they're in the bundle and warn if missing; resolution happens in 1.3b.
  let parsed: { FileReferences?: Record<string, unknown> } = {};
  try {
    const text = await manifest.blob.text();
    parsed = JSON.parse(text) as typeof parsed;
  } catch (e) {
    warnings.push(`could not parse model3.json: ${e instanceof Error ? e.message : String(e)}`);
  }

  const refs = parsed.FileReferences ?? {};
  const baseDir = manifest.path.includes("/")
    ? manifest.path.substring(0, manifest.path.lastIndexOf("/") + 1)
    : "";

  const checkRef = (relPath: string, label: string) => {
    const fullPath = (baseDir + relPath).toLowerCase();
    if (!map.has(fullPath) && !map.has(relPath.toLowerCase())) {
      warnings.push(`${label} referenced as ${relPath} but not present in bundle`);
    }
  };

  if (typeof refs.Moc === "string") checkRef(refs.Moc, "moc3");
  if (Array.isArray(refs.Textures)) {
    for (const t of refs.Textures) {
      if (typeof t === "string") checkRef(t, "texture");
    }
  }
  if (typeof refs.Physics === "string") checkRef(refs.Physics, "physics");
  if (typeof refs.UserData === "string") checkRef(refs.UserData, "userdata");
  if (typeof refs.DisplayInfo === "string") checkRef(refs.DisplayInfo, "displayinfo (cdi)");
  if (typeof refs.Pose === "string") checkRef(refs.Pose, "pose");
  if (refs.Motions && typeof refs.Motions === "object") {
    for (const group of Object.values(refs.Motions)) {
      if (!Array.isArray(group)) continue;
      for (const m of group) {
        if (m && typeof m === "object" && "File" in m && typeof m.File === "string") {
          checkRef(m.File, "motion");
        }
      }
    }
  }

  // For now, hand the engine the manifest's blob URL. The engine will
  // attempt to resolve siblings via fetch on the blob URL's "directory",
  // which won't work yet — that's the 1.3b problem. Sprint 1.3a stops
  // at "we know what's in the bundle and which adapter wants it".
  const loadInput: AdapterLoadInput = {
    kind: "live2d",
    model3: makeUrl(manifest, urls),
  };

  // Pre-create URLs for every sibling so 1.3b can route them.
  for (const e of entries) {
    if (e === manifest) continue;
    makeUrl(e, urls);
  }

  return {
    ok: true,
    detection: { runtime: "live2d", version: "Cubism4+", confidence },
    loadInput,
    entries: map,
    urls,
    warnings,
  };
}
