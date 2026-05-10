"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useReferences } from "@/lib/avatar/useReferences";

type Props = {
  /** Stable puppet identifier — same scheme as LayersPanel /
   *  VariantsPanel / GeneratePanel. `null` disables persistence and
   *  shows the "save to library" hint. */
  puppetKey: string | null;
};

/**
 * Right-sidebar section that lets the user upload character / style
 * reference images for the puppet. Sprint 5.1 implements the storage
 * UI only — the actual generate-time wiring (passing these blobs as
 * `image[]` entries to OpenAI's `/v1/images/edits`) lands in 5.2.
 *
 * Total bytes / count are surfaced because gpt-image-2 charges per
 * input image and gets slower with each one — both numbers help the
 * user keep their request shape sensible without us hard-capping it.
 */
export function ReferencesPanel({ puppetKey }: Props) {
  const { references, upload, remove } = useReferences(puppetKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Blob URL pool keyed by row id. Stored in a ref (not state) so the
  // memoized derivation can revoke stale URLs in place without
  // triggering its own re-run. We re-derive on every `references`
  // change: existing rows reuse their URL, new rows mint one, gone
  // rows have their URL revoked. The unmount effect handles the rest.
  const urlsRef = useRef<Record<string, string>>({});
  const previewUrls = useMemo(() => {
    const next: Record<string, string> = {};
    const seen = new Set<string>();
    for (const r of references) {
      seen.add(r.id);
      next[r.id] = urlsRef.current[r.id] ?? URL.createObjectURL(r.blob);
    }
    for (const id of Object.keys(urlsRef.current)) {
      if (!seen.has(id)) URL.revokeObjectURL(urlsRef.current[id]);
    }
    urlsRef.current = next;
    return next;
  }, [references]);
  useEffect(
    () => () => {
      for (const url of Object.values(urlsRef.current)) URL.revokeObjectURL(url);
      urlsRef.current = {};
    },
    [],
  );

  const totalBytes = useMemo(() => references.reduce((n, r) => n + r.blob.size, 0), [references]);

  const persistDisabled = puppetKey === null;

  async function handleUpload(files: File[]) {
    if (files.length === 0) {
      console.warn("[ReferencesPanel] upload triggered with empty file list");
      return;
    }
    console.info(
      `[ReferencesPanel] uploading ${files.length} file(s):`,
      files.map((f) => `${f.name} (${f.type || "?"}, ${f.size}B)`),
    );
    setBusy(true);
    setError(null);
    try {
      for (const file of files) {
        if (!file.type.startsWith("image/")) {
          setError(`${file.name} 은(는) 이미지 파일이 아닙니다 (${file.type || "MIME 없음"})`);
          continue;
        }
        const id = await upload(file);
        console.info(`[ReferencesPanel] saved reference id=${id}`);
      }
    } catch (e) {
      console.error("[ReferencesPanel] upload failed", e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shrink-0 border-b border-[var(--color-border)] px-4 py-3">
      <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-widest text-[var(--color-fg-dim)]">
        <span>References ({references.length})</span>
        {!persistDisabled && (
          <label className="cursor-pointer rounded border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-fg-dim)] hover:border-[var(--color-fg-dim)] hover:text-[var(--color-fg)]">
            {busy ? "uploading…" : "+ upload"}
            <input
              type="file"
              hidden
              multiple
              accept="image/*"
              disabled={busy}
              onChange={(e) => {
                // Snapshot the FileList synchronously into a plain
                // array BEFORE clearing input.value. The FileList is a
                // live view backed by the input element — once we set
                // value="" the browser empties it, so any later reads
                // (including Array.from inside the async handler) see
                // zero files. Reproduces as: file picker opens, user
                // picks files, panel never updates.
                const input = e.currentTarget;
                const files = input.files ? Array.from(input.files) : [];
                input.value = "";
                void handleUpload(files);
              }}
            />
          </label>
        )}
      </div>

      {persistDisabled && (
        <p className="text-[11px] text-[var(--color-fg-dim)]">
          Save this puppet to the library to attach reference images.
        </p>
      )}

      {!persistDisabled && references.length === 0 && (
        <p className="text-[11px] text-[var(--color-fg-dim)]">
          Upload character or style reference images. They'll be sent alongside the layer source on
          every AI generation so results stay tonally consistent.
        </p>
      )}

      {references.length > 0 && (
        <>
          <div className="mb-1 text-[10px] text-[var(--color-fg-dim)]">
            {(totalBytes / 1024).toFixed(0)} KB total
            <span className="ml-2">· each ref adds API cost + latency</span>
          </div>
          <ul className="grid grid-cols-3 gap-1.5">
            {references.map((r) => {
              const url = previewUrls[r.id];
              return (
                <li
                  key={r.id}
                  className="group relative aspect-square overflow-hidden rounded border border-[var(--color-border)] bg-[var(--color-bg)]"
                  title={`${r.name} · ${(r.blob.size / 1024).toFixed(0)} KB`}
                >
                  {url ? (
                    // biome-ignore lint/performance/noImgElement: blob URLs aren't compatible with next/image
                    <img src={url} alt={r.name} className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-[10px] text-[var(--color-fg-dim)]">
                      …
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`Remove reference "${r.name}"?`)) void remove(r.id);
                    }}
                    className="absolute right-0.5 top-0.5 rounded bg-black/60 px-1 text-[10px] text-white opacity-0 transition-opacity hover:text-red-300 group-hover:opacity-100"
                    title="Remove reference"
                    aria-label={`remove reference ${r.name}`}
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {error && <p className="mt-1 text-[10px] text-red-400">{error}</p>}
    </div>
  );
}
