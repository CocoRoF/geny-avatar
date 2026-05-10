import type { BundleEntry } from "./types";

/**
 * Rewrite manifests / atlases so every internal file reference becomes a
 * blob URL pointing into the dropped bundle. We need this because:
 *
 *   - Live2DModel.from(URL) reads the model3.json then fetches siblings
 *     (.moc3, textures, motions...) by resolving relative paths against
 *     the manifest URL. blob: URLs have no directory semantics, so a
 *     relative resolve produces a non-fetchable URL.
 *
 *   - spine-pixi-v8 reads the atlas's first line (a PNG name) and
 *     resolves it relative to the atlas URL. Same blob-no-directory
 *     problem.
 *
 * Fix: rewrite the text so all references are absolute blob: URLs, then
 * hand the adapter the rewritten blob's URL.
 */

// ----- helpers -----

function lookup(map: Map<string, BundleEntry>, baseDir: string, ref: string): BundleEntry | null {
  const candidates = [
    (baseDir + ref).toLowerCase(),
    ref.toLowerCase(),
    // strip leading "./"
    ref.replace(/^\.\/+/, "").toLowerCase(),
    (baseDir + ref.replace(/^\.\/+/, "")).toLowerCase(),
  ];
  for (const c of candidates) {
    const hit = map.get(c);
    if (hit) return hit;
  }
  return null;
}

function entryUrl(entry: BundleEntry, urls: string[]): string {
  const url = URL.createObjectURL(entry.blob);
  urls.push(url);
  return url;
}

function dirOf(path: string): string {
  return path.includes("/") ? path.substring(0, path.lastIndexOf("/") + 1) : "";
}

// ----- Live2D -----

/**
 * Read the model3.json text, replace every internal file reference with
 * a freshly-minted blob URL, and return a new Blob whose URL the engine
 * can safely point at.
 *
 * Returns null if the manifest can't be parsed; caller should warn and
 * skip the load.
 */
export async function rewriteLive2DManifest(
  manifest: BundleEntry,
  entries: Map<string, BundleEntry>,
  warnings: string[],
  urls: string[],
): Promise<Blob | null> {
  let parsed: {
    FileReferences?: Record<string, unknown>;
    [key: string]: unknown;
  };
  try {
    const text = await manifest.blob.text();
    parsed = JSON.parse(text);
  } catch (e) {
    warnings.push(`could not parse model3.json: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }

  const baseDir = dirOf(manifest.path);
  const refs = (parsed.FileReferences ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...refs };

  const resolveOne = (label: string, ref: string): string => {
    const hit = lookup(entries, baseDir, ref);
    if (!hit) {
      warnings.push(`${label} "${ref}" not found in bundle — left as-is`);
      return ref;
    }
    return entryUrl(hit, urls);
  };

  if (typeof refs.Moc === "string") out.Moc = resolveOne("moc3", refs.Moc);
  if (Array.isArray(refs.Textures)) {
    out.Textures = refs.Textures.map((t: unknown, i: number) =>
      typeof t === "string" ? resolveOne(`texture[${i}]`, t) : t,
    );
  }
  if (typeof refs.Physics === "string") out.Physics = resolveOne("physics", refs.Physics);
  if (typeof refs.Pose === "string") out.Pose = resolveOne("pose", refs.Pose);
  if (typeof refs.UserData === "string") out.UserData = resolveOne("userdata", refs.UserData);
  if (typeof refs.DisplayInfo === "string")
    out.DisplayInfo = resolveOne("displayinfo", refs.DisplayInfo);
  if (refs.Motions && typeof refs.Motions === "object") {
    const motionGroups = refs.Motions as Record<string, unknown>;
    const newGroups: Record<string, unknown> = {};
    for (const [groupName, group] of Object.entries(motionGroups)) {
      if (!Array.isArray(group)) {
        newGroups[groupName] = group;
        continue;
      }
      newGroups[groupName] = group.map((m: unknown, i: number) => {
        if (m && typeof m === "object" && "File" in m && typeof m.File === "string") {
          return { ...m, File: resolveOne(`motion[${groupName}][${i}]`, m.File) };
        }
        return m;
      });
    }
    out.Motions = newGroups;
  }
  // Expressions: same shape as Motions entries — `{Name, File}`. Engine
  // resolves the File against the manifest URL when setExpression() fires,
  // so blob: URL manifests need these rewritten too. Without this, the
  // editor's Animation tab ▶ preview silently no-ops on uploaded puppets.
  if (Array.isArray(refs.Expressions)) {
    out.Expressions = refs.Expressions.map((e: unknown, i: number) => {
      if (e && typeof e === "object" && "File" in e && typeof e.File === "string") {
        return { ...e, File: resolveOne(`expression[${i}]`, e.File) };
      }
      return e;
    });
  }

  const rewritten = { ...parsed, FileReferences: out };
  return new Blob([JSON.stringify(rewritten)], { type: "application/json" });
}

// ----- Spine -----

/**
 * Spine .atlas page-name regex. Each page block in an atlas starts with a
 * line that's a bare PNG / JPG / WEBP filename (no colon, no leading
 * indent). Subsequent lines are options (`size: ..`) or region defs
 * (`region_name`, indented `bounds: ..`).
 *
 * We treat any line that:
 *   - has no leading whitespace
 *   - has no ":" (excludes options)
 *   - ends with one of the allowed image extensions
 * as a page reference and rewrite it.
 */
const PAGE_NAME_RE = /^[^\s:][^\n:]*\.(png|jpg|jpeg|webp)$/i;

/**
 * Rewrite the atlas text so each page name becomes a blob URL of the
 * matching PNG entry in the bundle. Returns the new atlas Blob.
 */
export async function rewriteSpineAtlas(
  atlas: BundleEntry,
  entries: Map<string, BundleEntry>,
  warnings: string[],
  urls: string[],
): Promise<Blob> {
  const text = await atlas.blob.text();
  const baseDir = dirOf(atlas.path);
  const lines = text.split(/\r?\n/);
  const rewritten: string[] = [];

  for (const line of lines) {
    if (PAGE_NAME_RE.test(line)) {
      const hit = lookup(entries, baseDir, line.trim());
      if (hit) {
        rewritten.push(entryUrl(hit, urls));
      } else {
        warnings.push(`atlas page "${line.trim()}" not found in bundle — left as-is`);
        rewritten.push(line);
      }
    } else {
      rewritten.push(line);
    }
  }

  return new Blob([rewritten.join("\n")], { type: "text/plain" });
}
