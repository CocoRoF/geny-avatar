"use client";

import { useState } from "react";
import { PuppetCanvas } from "@/components/PuppetCanvas";
import { UploadDropzone } from "@/components/UploadDropzone";
import type { AdapterLoadInput, AvatarAdapter } from "@/lib/adapters/AvatarAdapter";
import type { Avatar } from "@/lib/avatar/types";
import { parseBundle } from "@/lib/upload/parseBundle";

/**
 * PoC — MMD (PMX/PMD) runtime smoke page, following the same pattern as
 * /poc/spine and /poc/cubism: no IndexedDB involvement, just drop a
 * model folder/zip and confirm the babylon-mmd stage loads, idles
 * (blink + breath), and lists materials/morphs. The full editor flow
 * lives at `/` → `/edit/<id>` like the other runtimes; this page exists
 * for fast format debugging.
 */
export default function MmdPocPage() {
  const [input, setInput] = useState<AdapterLoadInput | null>(null);
  const [avatar, setAvatar] = useState<Avatar | null>(null);
  const [adapter, setAdapter] = useState<AvatarAdapter | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  async function handleFiles(files: File[]) {
    setError(null);
    const parsed = await parseBundle(files.length === 1 ? files[0] : files);
    if (!parsed.ok) {
      setError(parsed.reason);
      return;
    }
    if (parsed.detection.runtime !== "mmd") {
      setError(`이 PoC 는 MMD 전용입니다 — 감지된 런타임: ${parsed.detection.runtime}`);
      return;
    }
    setWarnings(parsed.warnings);
    setInput(parsed.loadInput);
  }

  return (
    <main className="flex h-screen flex-col bg-[var(--color-bg)] text-[var(--color-fg)]">
      <header className="shrink-0 border-b border-[var(--color-border)] px-4 py-2 text-sm">
        PoC · MMD (PMX/PMD) — babylon-mmd stage
        {avatar && (
          <span className="ml-3 text-xs text-[var(--color-fg-dim)]">
            {avatar.name} · materials {avatar.layers.length} · morphs {avatar.parameters.length} ·
            VMD {avatar.animations.length}
          </span>
        )}
        {warnings.length > 0 && (
          <span className="ml-3 text-xs text-yellow-300">{warnings.join(" · ")}</span>
        )}
        {error && <span className="ml-3 text-xs text-red-400">{error}</span>}
      </header>
      <div className="flex min-h-0 flex-1">
        <PuppetCanvas
          input={input}
          onReady={(av, a) => {
            setAvatar(av);
            setAdapter(a);
          }}
          onError={setError}
          empty={
            <div className="w-96">
              <UploadDropzone onFiles={handleFiles} />
              <p className="mt-2 text-center text-xs text-[var(--color-fg-dim)]">
                .pmx/.pmd + 텍스처 폴더(또는 zip)를 드롭하세요
              </p>
            </div>
          }
        />
        {adapter && avatar && (
          <aside className="w-72 shrink-0 overflow-y-auto border-l border-[var(--color-border)] p-3 text-xs">
            <h2 className="mb-2 text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
              morphs (즉석 테스트)
            </h2>
            {avatar.parameters.slice(0, 40).map((p) => (
              <label key={p.id} className="mb-1 flex items-center gap-2">
                <span className="w-24 shrink-0 truncate" title={p.name}>
                  {p.name}
                </span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  defaultValue={0}
                  onChange={(e) => adapter.setParameter(p.id, Number(e.target.value))}
                  className="min-w-0 flex-1"
                />
              </label>
            ))}
          </aside>
        )}
      </div>
    </main>
  );
}
