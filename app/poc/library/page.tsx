"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AttributionFooter } from "@/components/AttributionFooter";
import type { AssetOriginNote } from "@/lib/avatar/types";
import { deletePuppet, listPuppets, type PuppetRow, updatePuppet } from "@/lib/persistence/db";

const ORIGIN_OPTIONS: { value: AssetOriginNote["source"]; label: string }[] = [
  { value: "unknown", label: "unknown" },
  { value: "live2d-official", label: "Live2D 공식 샘플" },
  { value: "spine-official", label: "Spine 공식 샘플" },
  { value: "inochi2d-official", label: "Inochi2D 공식" },
  { value: "community", label: "커뮤니티 (서드파티)" },
  { value: "self-made", label: "자체 제작" },
];

const ORIGIN_LICENSE_NOTES: Record<AssetOriginNote["source"], string> = {
  unknown: "출처를 알 수 없는 자산. 외부 공유나 상업적 이용 전에 원 저작자/배포처 확인 필요.",
  "live2d-official":
    "Live2D 공식 샘플은 Live2D Free Material License 적용. 학습/개인 용도는 허용, 상업 이용은 별도 라이선스 계약 필요.",
  "spine-official":
    "Esoteric Software 공식 샘플 (예: spineboy)은 Spine Examples License 적용. Spine Runtimes를 쓰려면 별도의 Spine SDK 라이선스 보유 필요.",
  "inochi2d-official":
    "Inochi2D 공식 자산은 BSD 2-Clause / CC-BY 등 자유 라이선스. 자산별 라이선스를 동봉된 LICENSE 파일에서 확인.",
  community:
    "커뮤니티/서드파티 자산. 원 저작자가 명시한 라이선스 (BOOTH 페이지, README 등)를 따라야 함.",
  "self-made": "본인 제작 자산. 원하는 라이선스로 자유롭게 배포 가능.",
};

export default function LibraryPage() {
  const [puppets, setPuppets] = useState<PuppetRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setPuppets(await listPuppets());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function onDelete(id: string) {
    if (!confirm("Delete this puppet from the library? This can't be undone.")) return;
    try {
      await deletePuppet(id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onOriginChange(id: string, source: AssetOriginNote["source"]) {
    try {
      await updatePuppet(id, { origin: { source } });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <main className="flex h-full flex-col overflow-hidden bg-[var(--color-bg)]">
      <header className="shrink-0 border-b border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-fg-dim)]">
        <span className="font-mono text-[var(--color-accent)]">Library</span>
        <span className="ml-3">
          {puppets == null
            ? "불러오는 중…"
            : puppets.length === 0
              ? "저장된 puppet 없음"
              : `${puppets.length}개 puppet 저장됨 (IndexedDB)`}
        </span>
        <a
          href="/poc/upload"
          className="ml-3 rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
        >
          + upload
        </a>
        {error && <span className="ml-3 text-red-400">error: {error}</span>}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {puppets && puppets.length === 0 && (
          <div className="mx-auto max-w-2xl rounded border border-dashed border-[var(--color-border)] bg-[var(--color-panel)] p-12 text-center text-sm text-[var(--color-fg-dim)]">
            <div className="mb-2 text-[var(--color-fg)]">아직 저장된 puppet 이 없습니다.</div>
            <div>
              Spine 또는 Cubism 번들을{" "}
              <a href="/poc/upload" className="text-[var(--color-accent)] underline">
                업로드 페이지
              </a>{" "}
              에 드롭하면 여기에 나타납니다.{" "}
              <a href="/" className="text-[var(--color-accent)] underline">
                홈
              </a>{" "}
              의 built-in 샘플로 먼저 둘러봐도 좋습니다.
            </div>
          </div>
        )}

        {puppets && puppets.length > 0 && (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {puppets.map((p) => (
              <li
                key={p.id}
                className="flex flex-col rounded border border-[var(--color-border)] bg-[var(--color-panel)]"
              >
                <a
                  href={`/edit/${p.id}`}
                  className="flex flex-1 flex-col p-4 hover:bg-[var(--color-bg)]"
                >
                  <PuppetThumb blob={p.thumbnailBlob} />
                  <div className="mb-1 flex items-baseline gap-2">
                    <span className="rounded border border-[var(--color-border)] px-1.5 py-0.5 font-mono text-xs text-[var(--color-accent)]">
                      {p.runtime}
                    </span>
                    {p.version && (
                      <span className="font-mono text-xs text-[var(--color-fg-dim)]">
                        {p.version}
                      </span>
                    )}
                    <span className="ml-auto font-mono text-xs text-[var(--color-fg-dim)]">
                      {p.id.slice(-6)}
                    </span>
                  </div>
                  <div className="mb-2 truncate text-base font-medium">{p.name}</div>
                  <div className="text-xs text-[var(--color-fg-dim)]">
                    {p.fileCount} files · {humanBytes(p.totalSize)}
                  </div>
                  <div className="mt-1 text-xs text-[var(--color-fg-dim)]">
                    {formatRelative(p.updatedAt)}
                  </div>
                </a>
                <div className="flex shrink-0 flex-col gap-1 border-t border-[var(--color-border)] px-3 py-1.5 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-[var(--color-fg-dim)]">origin:</span>
                    <select
                      value={p.origin?.source ?? "unknown"}
                      onChange={(e) =>
                        onOriginChange(p.id, e.target.value as AssetOriginNote["source"])
                      }
                      onClick={(e) => e.stopPropagation()}
                      className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1.5 py-0.5 text-xs text-[var(--color-fg)] focus:border-[var(--color-accent)] focus:outline-none"
                    >
                      {ORIGIN_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <details className="text-[10px]">
                      <summary
                        className="cursor-pointer list-none rounded border border-[var(--color-border)] px-1.5 py-0.5 font-mono text-[var(--color-fg-dim)] hover:border-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
                        title="라이선스 안내 보기"
                      >
                        i
                      </summary>
                      <div className="mt-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2 text-[10px] leading-relaxed text-[var(--color-fg-dim)]">
                        {ORIGIN_LICENSE_NOTES[p.origin?.source ?? "unknown"]}
                        {p.origin?.url && (
                          <>
                            {" · "}
                            <a
                              href={p.origin.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[var(--color-accent)] underline"
                            >
                              source URL
                            </a>
                          </>
                        )}
                      </div>
                    </details>
                    <button
                      type="button"
                      onClick={() => onDelete(p.id)}
                      className="rounded border border-transparent px-2 py-0.5 text-[var(--color-fg-dim)] hover:border-[var(--color-border)] hover:text-red-400"
                    >
                      delete
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <AttributionFooter />
    </main>
  );
}

function PuppetThumb({ blob }: { blob?: Blob }) {
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  if (!url) {
    return (
      <div className="mb-3 flex aspect-square w-full items-center justify-center rounded border border-dashed border-[var(--color-border)] bg-[var(--color-bg)] text-xs text-[var(--color-fg-dim)]">
        no preview
      </div>
    );
  }
  return (
    // biome-ignore lint/performance/noImgElement: blob URLs aren't compatible with next/image optimization
    <img
      src={url}
      alt=""
      className="mb-3 aspect-square w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] object-contain"
    />
  );
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatRelative(ts: number): string {
  const diffMs = Date.now() - ts;
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}
