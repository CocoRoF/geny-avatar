// Sync curated assets from vendor/ submodule into public/.
// Runs in predev / prebuild. Explicit mappings only — no whole-folder copies,
// so the routing stays auditable.

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const VENDOR = join(ROOT, "vendor");
const PUBLIC = join(ROOT, "public");

/**
 * Each entry: [vendor source path, public target path, "file" | "dir"].
 * Paths are relative to vendor/ and public/ respectively.
 */
const MAPPINGS = [
  // Spine — spineboy evaluation sample (Esoteric examples).
  ["spine/samples/spineboy", "samples/spineboy", "dir"],

  // Cubism — Live2D Cubism Core (closed binary, EULA-bound).
  ["cubism/Core/live2dcubismcore.min.js", "runtime/live2dcubismcore.min.js", "file"],

  // Cubism — Hiyori sample model (Live2D Cubism Sample EULA).
  ["cubism/samples/Hiyori", "samples/hiyori", "dir"],
];

function copyDir(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src)) {
    const s = join(src, entry);
    const d = join(dst, entry);
    if (statSync(s).isDirectory()) {
      copyDir(s, d);
    } else {
      copyFileSync(s, d);
    }
  }
}

let synced = 0;
const skipped = 0;
const missing = [];

for (const [from, to, kind] of MAPPINGS) {
  const src = join(VENDOR, from);
  const dst = join(PUBLIC, to);

  if (!existsSync(src)) {
    missing.push(from);
    continue;
  }

  mkdirSync(dirname(dst), { recursive: true });

  if (kind === "file") {
    copyFileSync(src, dst);
    synced++;
    console.log(`  + ${relative(ROOT, src)} → ${relative(ROOT, dst)}`);
  } else {
    copyDir(src, dst);
    synced++;
    console.log(`  + ${relative(ROOT, src)}/ → ${relative(ROOT, dst)}/`);
  }
}

console.log(`\nvendor sync: ${synced} synced, ${skipped} skipped, ${missing.length} missing.`);

if (missing.length > 0) {
  console.log("missing (PoC may not yet have populated vendor):");
  for (const m of missing) console.log(`  - vendor/${m}`);
  console.log(
    "\nthat's fine if the corresponding PoC hasn't run yet — the missing pages just won't load.",
  );
}
