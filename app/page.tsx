"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AttributionFooter } from "@/components/AttributionFooter";
import { UploadDropzone } from "@/components/UploadDropzone";
import type { AssetOriginNote } from "@/lib/avatar/types";
import { BUILTIN_SAMPLES } from "@/lib/builtin/samples";
import { tryRestoreGenyAvatarZip } from "@/lib/import/restoreBundle";
import {
  deletePuppet,
  listPuppets,
  type PuppetId,
  type PuppetRow,
  savePuppet,
  updatePuppet,
} from "@/lib/persistence/db";
import { disposeBundle, parseBundle } from "@/lib/upload/parseBundle";
import type { ParsedBundle } from "@/lib/upload/types";

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
    "Esoteric Software 공식 샘플 (예: spineboy)은 Spine Examples License 적용. Spine Runtimes 를 쓰려면 별도의 Spine SDK 라이선스 보유 필요.",
  "inochi2d-official":
    "Inochi2D 공식 자산은 BSD 2-Clause / CC-BY 등 자유 라이선스. 자산별 라이선스를 동봉된 LICENSE 파일에서 확인.",
  community:
    "커뮤니티/서드파티 자산. 원 저작자가 명시한 라이선스 (BOOTH 페이지, README 등)를 따라야 함.",
  "self-made": "본인 제작 자산. 원하는 라이선스로 자유롭게 배포 가능.",
};

/**
 * Workspace selector / landing. Three things merged into one page so
 * the user doesn't have to bounce between routes:
 *
 *   1. Upload — drop a Spine/Cubism bundle (or a previously-exported
 *      `*.geny-avatar.zip`) → autosave to IDB → jump to `/edit/<id>`.
 *   2. Built-in samples — Hiyori + spineboy as zero-friction entries
 *      so first-time visitors have something to click immediately.
 *   3. Library — every puppet the user has saved before, with origin
 *      tagging, license disclosure, and delete.
 *
 * Keeps the page entirely on the client because the library list and
 * the upload flow both need IndexedDB. The shell + footer are server-
 * renderable but not worth splitting for a single static frame.
 */
export default function Home() {
  const router = useRouter();
  const [puppets, setPuppets] = useState<PuppetRow[] | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setPuppets(await listPuppets());
    } catch (e) {
      setLibraryError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Hand off the just-dropped File[] to either restore-zip or parse-
  // bundle, save to IDB, and navigate to the editor. Everything else
  // (preview, layer panels, etc.) lives in /edit/[avatarId] — the
  // landing only carries the user from "I have a file" to "I'm in the
  // editor".
  async function handleUpload(files: File[]) {
    if (files.length === 0) return;
    setUploadBusy(true);
    setUploadError(null);
    setUploadStatus("파일 분석 중…");
    let parsed: ParsedBundle | null = null;
    try {
      // First check whether the dropped file is a geny-avatar export
      // ZIP. If so, restore (writes IDB rows) and navigate — skip the
      // regular puppet-bundle parse path entirely.
      if (files.length === 1 && files[0].name.toLowerCase().endsWith(".zip")) {
        setUploadStatus("geny-avatar zip 확인 중…");
        const restored = await tryRestoreGenyAvatarZip(files[0]);
        if (restored) {
          if (restored.warnings.length > 0) {
            console.warn("[home/upload] restore warnings", restored.warnings);
          }
          router.push(`/edit/${restored.puppetId}`);
          return;
        }
      }

      const fileInput: File | File[] =
        files.length === 1 && files[0].name.toLowerCase().endsWith(".zip") ? files[0] : files;
      setUploadStatus("puppet 번들 파싱 중…");
      parsed = await parseBundle(fileInput);
      if (!parsed.ok) {
        setUploadError(`인식 실패: ${parsed.reason}`);
        setUploadStatus(null);
        return;
      }
      setUploadStatus("라이브러리에 저장 중…");
      const entries = Array.from(parsed.entries.values());
      const inferredName = inferBundleName(files, entries, parsed.detection.runtime);
      const id = await savePuppet({
        name: inferredName,
        runtime: parsed.detection.runtime,
        version: parsed.detection.version,
        entries,
      });
      router.push(`/edit/${id}`);
    } catch (e) {
      console.error("[home/upload] failed", e);
      setUploadError(e instanceof Error ? e.message : String(e));
      setUploadStatus(null);
    } finally {
      if (parsed) disposeBundle(parsed);
      setUploadBusy(false);
    }
  }

  async function onDelete(id: PuppetId) {
    if (!confirm("이 puppet 을 라이브러리에서 삭제할까요? 되돌릴 수 없습니다.")) return;
    try {
      await deletePuppet(id);
      await refresh();
    } catch (e) {
      setLibraryError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onOriginChange(id: PuppetId, source: AssetOriginNote["source"]) {
    try {
      await updatePuppet(id, { origin: { source } });
      await refresh();
    } catch (e) {
      setLibraryError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-bg)]">
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-12 sm:px-8 sm:py-16">
        <header className="mb-10">
          <div className="mb-2 font-mono text-xs text-[var(--color-fg-dim)]">
            v0.2.3 · Geny-integratable
          </div>
          <h1 className="mb-3 text-4xl font-semibold tracking-tight">geny-avatar</h1>
          <p className="max-w-2xl text-lg text-[var(--color-fg-dim)]">
            Cubism / Spine puppet 을 브라우저에서 열고, 레이어를 분해하고, 생성형 AI 로 텍스처를
            교체합니다. 모든 작업은 로컬 (IndexedDB) 에 저장됩니다.
          </p>
          <p className="mt-1 font-mono text-xs text-[var(--color-fg-dim)]">
            Cubism · Spine · Pixi v8 · OpenAI gpt-image-2 · SAM
          </p>
        </header>

        {/* Upload */}
        <section className="mb-10">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-widest text-[var(--color-fg-dim)]">
            새 puppet 시작
          </h2>
          <UploadDropzone
            onFiles={handleUpload}
            className="h-44 w-full"
            hint="Spine: .skel/.json + .atlas + .png  ·  Cubism: .model3.json + .moc3 + textures  ·  또는 이전에 export 한 *.geny-avatar.zip (variants/overrides 복원)."
          />
          {(uploadStatus || uploadBusy) && (
            <p className="mt-2 text-xs text-[var(--color-fg-dim)]">{uploadStatus ?? "처리 중…"}</p>
          )}
          {uploadError && <p className="mt-2 text-xs text-red-400">{uploadError}</p>}
        </section>

        {/* Built-in samples */}
        <section className="mb-10">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-widest text-[var(--color-fg-dim)]">
            내장 샘플 — 처음이라면 여기서 시작
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {BUILTIN_SAMPLES.map((s) => (
              <Link
                key={s.key}
                href={`/edit/builtin/${s.key}`}
                className="rounded border border-[var(--color-border)] bg-[var(--color-panel)] p-4 hover:border-[var(--color-accent)]"
              >
                <div className="mb-1 flex items-baseline gap-2">
                  <span className="rounded border border-[var(--color-border)] px-1.5 py-0.5 font-mono text-xs text-[var(--color-accent)]">
                    {s.runtime}
                  </span>
                  {s.version && (
                    <span className="font-mono text-xs text-[var(--color-fg-dim)]">
                      {s.version}
                    </span>
                  )}
                </div>
                <div className="mb-1 text-base font-medium">{s.name}</div>
                <p className="text-sm leading-relaxed text-[var(--color-fg-dim)]">{s.blurb}</p>
              </Link>
            ))}
          </div>
        </section>

        {/* Library */}
        <section className="mb-10">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-medium uppercase tracking-widest text-[var(--color-fg-dim)]">
              내 라이브러리{" "}
              {puppets != null && (
                <span className="ml-1 normal-case tracking-normal text-[var(--color-fg-dim)]">
                  ({puppets.length})
                </span>
              )}
            </h2>
            {libraryError && (
              <span className="text-xs text-red-400">라이브러리 오류: {libraryError}</span>
            )}
          </div>

          {puppets == null && <p className="text-sm text-[var(--color-fg-dim)]">불러오는 중…</p>}

          {puppets != null && puppets.length === 0 && (
            <p className="rounded border border-dashed border-[var(--color-border)] bg-[var(--color-panel)] px-4 py-6 text-sm text-[var(--color-fg-dim)]">
              아직 저장된 puppet 이 없습니다. 위에 puppet 번들을 드롭하거나 내장 샘플로 시작해
              보세요.
            </p>
          )}

          {puppets != null && puppets.length > 0 && (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {puppets.map((p) => (
                <LibraryCard
                  key={p.id}
                  puppet={p}
                  onDelete={() => onDelete(p.id)}
                  onOriginChange={(s) => onOriginChange(p.id, s)}
                />
              ))}
            </ul>
          )}
        </section>

        <section className="border-t border-[var(--color-border)] pt-6 text-xs text-[var(--color-fg-dim)]">
          <p>
            설계 문서는{" "}
            <code className="rounded bg-[var(--color-panel)] px-1.5 py-0.5 font-mono">docs/</code>{" "}
            (analysis · plan · progress) 에 있습니다. 두 가지 운영 철학:{" "}
            <strong className="text-[var(--color-fg)]">Cubism + Spine 모두 1차</strong> ·{" "}
            <strong className="text-[var(--color-fg)]">Upload Day-1</strong>.
          </p>
        </section>
      </main>
      <AttributionFooter />
    </div>
  );
}

function LibraryCard({
  puppet,
  onDelete,
  onOriginChange,
}: {
  puppet: PuppetRow;
  onDelete: () => void;
  onOriginChange: (source: AssetOriginNote["source"]) => void;
}) {
  return (
    <li className="flex flex-col rounded border border-[var(--color-border)] bg-[var(--color-panel)]">
      <Link
        href={`/edit/${puppet.id}`}
        className="flex flex-1 flex-col p-4 hover:bg-[var(--color-bg)]"
      >
        <PuppetThumb blob={puppet.thumbnailBlob} />
        <div className="mb-1 flex items-baseline gap-2">
          <span className="rounded border border-[var(--color-border)] px-1.5 py-0.5 font-mono text-xs text-[var(--color-accent)]">
            {puppet.runtime}
          </span>
          {puppet.version && (
            <span className="font-mono text-xs text-[var(--color-fg-dim)]">{puppet.version}</span>
          )}
          <span className="ml-auto font-mono text-xs text-[var(--color-fg-dim)]">
            {puppet.id.slice(-6)}
          </span>
        </div>
        <div className="mb-2 truncate text-base font-medium">{puppet.name}</div>
        <div className="text-xs text-[var(--color-fg-dim)]">
          {puppet.fileCount} files · {humanBytes(puppet.totalSize)}
        </div>
        <div className="mt-1 text-xs text-[var(--color-fg-dim)]">
          {formatRelative(puppet.updatedAt)}
        </div>
      </Link>
      <div className="flex shrink-0 items-center gap-2 border-t border-[var(--color-border)] px-3 py-1.5 text-xs">
        <span className="text-[var(--color-fg-dim)]">origin:</span>
        <select
          value={puppet.origin?.source ?? "unknown"}
          onChange={(e) => onOriginChange(e.target.value as AssetOriginNote["source"])}
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
            {ORIGIN_LICENSE_NOTES[puppet.origin?.source ?? "unknown"]}
            {puppet.origin?.url && (
              <>
                {" · "}
                <a
                  href={puppet.origin.url}
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
          onClick={onDelete}
          className="rounded border border-transparent px-2 py-0.5 text-[var(--color-fg-dim)] hover:border-[var(--color-border)] hover:text-red-400"
        >
          delete
        </button>
      </div>
    </li>
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
  if (sec < 60) return `${sec}초 전`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  return `${day}일 전`;
}

function inferBundleName(
  files: File[],
  entries: { name: string; path: string }[],
  runtime: "spine" | "live2d",
): string {
  if (runtime === "live2d") {
    const manifest = entries.find((e) => e.name.toLowerCase().endsWith(".model3.json"));
    if (manifest) return manifest.name.replace(/\.model3\.json$/i, "");
  } else {
    const skel = entries.find((e) => e.name.toLowerCase().endsWith(".skel"));
    if (skel) return skel.name.replace(/\.skel$/i, "");
    const json = entries.find(
      (e) =>
        e.name.toLowerCase().endsWith(".json") && !e.name.toLowerCase().endsWith(".model3.json"),
    );
    if (json) return json.name.replace(/\.json$/i, "");
  }
  const zip = files.find((f) => f.name.toLowerCase().endsWith(".zip"));
  if (zip) return zip.name.replace(/\.zip$/i, "");
  const firstSlash = entries[0]?.path.indexOf("/") ?? -1;
  if (firstSlash > 0) {
    const prefix = entries[0].path.substring(0, firstSlash);
    if (entries.every((e) => e.path.startsWith(`${prefix}/`))) return prefix;
  }
  return runtime === "live2d" ? "Cubism puppet" : "Spine puppet";
}
