"use client";

import { type DragEvent, useState } from "react";

type Props = {
  onFiles: (files: File[]) => void;
  /** className applied to the outer drop region */
  className?: string;
  hint?: string;
};

/**
 * Drop zone that accepts a multi-file pick or a drag-drop. Hands the
 * caller a flat File[] — caller decides how to interpret (single ZIP vs
 * folder vs scattered files). Pure UI; doesn't know about parseBundle.
 */
export function UploadDropzone({ onFiles, className = "", hint }: Props) {
  const [over, setOver] = useState(false);

  function pickFromEvent(ev: DragEvent<HTMLElement>): File[] {
    const out: File[] = [];
    if (ev.dataTransfer.items) {
      for (const item of ev.dataTransfer.items) {
        if (item.kind === "file") {
          const f = item.getAsFile();
          if (f) out.push(f);
        }
      }
    } else {
      out.push(...ev.dataTransfer.files);
    }
    return out;
  }

  function onDrop(ev: DragEvent<HTMLElement>) {
    ev.preventDefault();
    setOver(false);
    const files = pickFromEvent(ev);
    if (files.length > 0) onFiles(files);
  }
  function onDragOver(ev: DragEvent<HTMLElement>) {
    ev.preventDefault();
    setOver(true);
  }
  function onDragLeave() {
    setOver(false);
  }

  return (
    <section
      aria-label="Drop puppet bundle"
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed text-sm transition-colors ${
        over
          ? "border-[var(--color-accent)] bg-[var(--color-accent-dim)]"
          : "border-[var(--color-border)] bg-[var(--color-panel)]"
      } ${className}`}
    >
      <div className="mb-2 text-[var(--color-fg)]">Drop a Spine or Cubism bundle here</div>
      <div className="px-6 text-center text-xs text-[var(--color-fg-dim)]">
        {hint ??
          "ZIP, or a folder of files. Spine: .skel/.json + .atlas + .png. Cubism: .model3.json + .moc3 + textures."}
      </div>
      <label className="mt-4 cursor-pointer rounded border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-fg-dim)] hover:border-[var(--color-fg-dim)] hover:text-[var(--color-fg)]">
        or pick files
        <input
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              onFiles(Array.from(e.target.files));
            }
          }}
        />
      </label>
    </section>
  );
}
