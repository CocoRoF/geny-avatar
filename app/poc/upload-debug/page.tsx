"use client";

import { type DragEvent, useState } from "react";
import { disposeBundle, parseBundle } from "@/lib/upload/parseBundle";
import type { ParsedBundle } from "@/lib/upload/types";

type Display = {
  status: "idle" | "parsing" | "done" | "error";
  bundle?: ParsedBundle;
  error?: string;
  inputSummary?: string;
};

export default function UploadDebugPage() {
  const [display, setDisplay] = useState<Display>({ status: "idle" });
  const [dragOver, setDragOver] = useState(false);

  async function handleFiles(files: File[]) {
    if (files.length === 0) return;
    if (display.bundle) disposeBundle(display.bundle);
    setDisplay({
      status: "parsing",
      inputSummary: `${files.length} file${files.length > 1 ? "s" : ""}, ${humanBytes(files.reduce((s, f) => s + f.size, 0))}`,
    });
    try {
      // when a single ZIP is dropped we want the raw File; otherwise pass the array
      const input: File | File[] =
        files.length === 1 && files[0].name.toLowerCase().endsWith(".zip") ? files[0] : files;
      const bundle = await parseBundle(input);
      setDisplay((d) => ({ ...d, status: "done", bundle }));
    } catch (e) {
      setDisplay((d) => ({
        ...d,
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      }));
    }
  }

  function onDrop(ev: DragEvent<HTMLDivElement>) {
    ev.preventDefault();
    setDragOver(false);
    const files: File[] = [];
    if (ev.dataTransfer.items) {
      for (const item of ev.dataTransfer.items) {
        if (item.kind === "file") {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
    } else {
      files.push(...ev.dataTransfer.files);
    }
    handleFiles(files);
  }

  function onDragOver(ev: DragEvent<HTMLDivElement>) {
    ev.preventDefault();
    setDragOver(true);
  }
  function onDragLeave() {
    setDragOver(false);
  }

  function clear() {
    if (display.bundle) disposeBundle(display.bundle);
    setDisplay({ status: "idle" });
  }

  return (
    <main className="grid h-full grid-cols-[1fr_480px] overflow-hidden bg-[var(--color-bg)]">
      <section className="flex min-h-0 min-w-0 flex-col">
        <header className="shrink-0 border-b border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-fg-dim)]">
          <span className="font-mono text-[var(--color-accent)]">PoC · Upload Debug</span>
          <span className="ml-3">parseBundle output viewer · sprint 1.3a</span>
        </header>

        <div className="flex min-h-0 flex-1 flex-col items-center justify-center p-8">
          <section
            aria-label="Drop bundle"
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            className={`flex h-72 w-full max-w-2xl flex-col items-center justify-center rounded-lg border-2 border-dashed text-sm transition-colors ${
              dragOver
                ? "border-[var(--color-accent)] bg-[var(--color-accent-dim)]"
                : "border-[var(--color-border)] bg-[var(--color-panel)]"
            }`}
          >
            <div className="mb-2 text-[var(--color-fg)]">Drop a Spine or Cubism bundle here</div>
            <div className="text-xs text-[var(--color-fg-dim)]">
              ZIP, or a folder of files. Spine: .skel/.json + .atlas + .png. Cubism: .model3.json +
              .moc3 + textures.
            </div>
            <label className="mt-4 cursor-pointer rounded border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-fg-dim)] hover:border-[var(--color-fg-dim)] hover:text-[var(--color-fg)]">
              or pick files
              <input
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files) handleFiles(Array.from(e.target.files));
                }}
              />
            </label>
          </section>

          <div className="mt-6 text-xs text-[var(--color-fg-dim)]">
            Status:{" "}
            <span
              className={
                display.status === "done"
                  ? "text-[var(--color-accent)]"
                  : display.status === "error"
                    ? "text-red-400"
                    : "text-[var(--color-fg-dim)]"
              }
            >
              {display.status}
            </span>
            {display.inputSummary && <span className="ml-3">· input: {display.inputSummary}</span>}
            {display.error && <span className="ml-3 text-red-400">· {display.error}</span>}
            {display.status !== "idle" && (
              <button
                type="button"
                onClick={clear}
                className="ml-3 rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
              >
                clear
              </button>
            )}
          </div>
        </div>
      </section>

      <aside className="flex min-h-0 flex-col border-l border-[var(--color-border)]">
        <div className="shrink-0 border-b border-[var(--color-border)] px-4 py-3 text-xs uppercase tracking-widest text-[var(--color-fg-dim)]">
          Result
        </div>
        <pre className="min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-xs leading-relaxed text-[var(--color-fg)]">
          {renderResult(display.bundle)}
        </pre>
      </aside>
    </main>
  );
}

function renderResult(b: ParsedBundle | undefined): string {
  if (!b) return "(drop a bundle to see the parsed result)";
  if (!b.ok) {
    return JSON.stringify(
      {
        ok: false,
        reason: b.reason,
        detection: b.detection,
        entries: summarizeEntries(b.entries),
      },
      null,
      2,
    );
  }
  return JSON.stringify(
    {
      ok: true,
      detection: b.detection,
      loadInput: redactBlobUrls(b.loadInput),
      warnings: b.warnings,
      entries: summarizeEntries(b.entries),
      blobUrls: b.urls.length,
    },
    null,
    2,
  );
}

// biome-ignore lint/suspicious/noExplicitAny: trimming for debug display
function redactBlobUrls(input: any): any {
  if (typeof input !== "object" || input == null) return input;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    out[k] = typeof v === "string" && v.startsWith("blob:") ? "blob:…" : v;
  }
  return out;
}

function summarizeEntries(entries: Map<string, { name: string; path: string; size: number }>) {
  const out: { path: string; size: string }[] = [];
  for (const e of entries.values()) {
    out.push({ path: e.path, size: humanBytes(e.size) });
  }
  return out;
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
