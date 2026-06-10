"use client";

import type { Application } from "pixi.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AvatarAdapter } from "@/lib/adapters/AvatarAdapter";
import { submitGenerate } from "@/lib/ai/client";
import {
  bakeRestyleSources,
  composeRestylePrompt,
  postprocessRestyledPage,
  prepareRestyleFrame,
  type RestylePageSource,
} from "@/lib/ai/restyle";
import { renderPuppetReference } from "@/lib/avatar/canonicalPoseRender";
import type { Avatar } from "@/lib/avatar/types";
import { useReferences } from "@/lib/avatar/useReferences";
import { useEditorStore } from "@/lib/store/editor";

type PageState = {
  page: RestylePageSource;
  sourceUrl: string;
  status: "idle" | "running" | "succeeded" | "failed";
  resultBlob?: Blob;
  resultUrl?: string;
  failedReason?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  adapter: AvatarAdapter | null;
  avatar: Avatar | null;
  app: Application | null;
  puppetKey: string | null;
};

/**
 * Whole-character restyle: every atlas page is sent through the AI in
 * one call per page (style references + assembled-character snapshot
 * attached), and the results land as PAGE OVERRIDES — the live render
 * updates the whole puppet at once. Per-layer overrides stay intact on
 * top; revert per page from the Layers panel.
 */
export function RestylePanel({ open, onClose, adapter, avatar, app, puppetKey }: Props) {
  const setPageTextureOverride = useEditorStore((s) => s.setPageTextureOverride);
  // Shared with the sidebar References panel (same IDB rows) — an image
  // uploaded here also appears there and rides along in per-layer
  // generations, and vice versa.
  const { references, upload: uploadReference, remove: removeReference } = useReferences(puppetKey);

  const [pages, setPages] = useState<PageState[]>([]);
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [bakeError, setBakeError] = useState<string | null>(null);
  const [refError, setRefError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Thumbnail URLs for the reference strip. The cleanup runs with the
  // PREVIOUS list whenever references change — those URLs are no longer
  // rendered (the new memo minted fresh ones), so revoking is safe.
  const refThumbs = useMemo(
    () => references.map((r) => ({ id: r.id, name: r.name, url: URL.createObjectURL(r.blob) })),
    [references],
  );
  useEffect(() => {
    return () => {
      for (const t of refThumbs) URL.revokeObjectURL(t.url);
    };
  }, [refThumbs]);

  const onUploadRefs = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = ""; // allow re-picking the same file
      if (files.length === 0) return;
      setRefError(null);
      try {
        for (const file of files) {
          if (!file.type.startsWith("image/")) continue;
          await uploadReference(file);
        }
      } catch (err) {
        setRefError(err instanceof Error ? err.message : String(err));
      }
    },
    [uploadReference],
  );

  // Bake current page composites when the panel opens.
  useEffect(() => {
    if (!open || !adapter || !avatar) return;
    let cancelled = false;
    setBakeError(null);
    setPages([]);
    (async () => {
      try {
        // Read the override maps imperatively — bake-on-open snapshot,
        // not a reactive dependency (edits happen behind closed modals
        // while this one is up).
        const { layerMasks, layerTextureOverrides } = useEditorStore.getState();
        const sources = await bakeRestyleSources({
          adapter,
          avatar,
          masks: layerMasks,
          textures: layerTextureOverrides,
        });
        if (cancelled) return;
        setPages(
          sources.map((page) => ({
            page,
            sourceUrl: page.canvas.toDataURL("image/png"),
            status: "idle" as const,
          })),
        );
      } catch (e) {
        if (!cancelled) setBakeError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, adapter, avatar]);

  // Object URL lifecycle: revoke on unmount only. Revoking on every
  // `pages` change would kill URLs still on display (per-page status
  // updates replace the array identity mid-run).
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  useEffect(() => {
    return () => {
      for (const p of pagesRef.current) {
        if (p.resultUrl) URL.revokeObjectURL(p.resultUrl);
      }
    };
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const generate = useCallback(async () => {
    if (running || pages.length === 0 || prompt.trim().length === 0) return;
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      // Shared context: style refs + assembled-character snapshot.
      const refBlobs = references.map((r) => r.blob);
      let snapshot: Blob | null = null;
      if (app) {
        try {
          snapshot = await renderPuppetReference(app);
        } catch (e) {
          console.warn("[restyle] snapshot capture failed; continuing without", e);
        }
      }

      // Sequential per page — page N's result rides as a style anchor
      // for page N+1 so multi-page atlases stay consistent.
      let prevResult: Blob | null = null;
      for (let i = 0; i < pages.length; i++) {
        if (controller.signal.aborted) break;
        const entry = pages[i];
        setPages((prev) =>
          prev.map((p, j) => (j === i ? { ...p, status: "running", failedReason: undefined } : p)),
        );
        try {
          const frame = await prepareRestyleFrame(entry.page);
          const composed = composeRestylePrompt({
            userPrompt: prompt.trim(),
            pageNumber: i + 1,
            pageCount: pages.length,
            hasSnapshot: !!snapshot,
            refCount: refBlobs.length,
            hasPrevPageResult: !!prevResult,
          });
          const submitRefs: Blob[] = [
            ...(snapshot ? [snapshot] : []),
            ...refBlobs,
            ...(prevResult ? [prevResult] : []),
          ];
          const raw = await submitGenerate({
            providerId: "openai",
            prompt: prompt.trim(),
            refinedPrompt: composed,
            negativePrompt: negativePrompt.trim() || undefined,
            sourceImage: frame.blob,
            referenceImages: submitRefs.length > 0 ? submitRefs : undefined,
            signal: controller.signal,
          });
          const processed = await postprocessRestyledPage({
            resultBlob: raw,
            frame,
            page: entry.page,
          });
          prevResult = processed;
          // Replacing a previous run's result for this page — release
          // its preview URL before minting the new one.
          if (entry.resultUrl) URL.revokeObjectURL(entry.resultUrl);
          const url = URL.createObjectURL(processed);
          setPages((prev) =>
            prev.map((p, j) =>
              j === i ? { ...p, status: "succeeded", resultBlob: processed, resultUrl: url } : p,
            ),
          );
        } catch (e) {
          const reason = e instanceof Error ? e.message : String(e);
          setPages((prev) =>
            prev.map((p, j) => (j === i ? { ...p, status: "failed", failedReason: reason } : p)),
          );
          // A canceled run stops the whole sequence; a single-page
          // failure continues so the rest can still succeed.
          if (controller.signal.aborted) break;
        }
      }
    } finally {
      setRunning(false);
    }
  }, [running, pages, prompt, negativePrompt, references, app]);

  const applyPage = useCallback(
    (i: number) => {
      const entry = pages[i];
      if (!entry?.resultBlob) return;
      setPageTextureOverride(entry.page.pageIndex, entry.resultBlob);
    },
    [pages, setPageTextureOverride],
  );

  const applyAll = useCallback(() => {
    for (let i = 0; i < pages.length; i++) {
      const entry = pages[i];
      if (entry.resultBlob) setPageTextureOverride(entry.page.pageIndex, entry.resultBlob);
    }
    onClose();
  }, [pages, setPageTextureOverride, onClose]);

  const requestClose = useCallback(() => {
    if (running) {
      if (typeof window !== "undefined") {
        const ok = window.confirm("Restyle 진행 중입니다.\n\n확인 = 취소하고 닫기\n취소 = 계속");
        if (!ok) return;
      }
      cancel();
    }
    onClose();
  }, [running, cancel, onClose]);

  if (!open) return null;

  const anySucceeded = pages.some((p) => p.status === "succeeded");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded border border-[var(--color-border)] bg-[var(--color-bg)]">
        <header className="flex shrink-0 items-center gap-3 border-b border-[var(--color-border)] px-4 py-2 text-xs">
          <span className="font-mono text-[var(--color-accent)]">restyle · whole character</span>
          <span className="text-[var(--color-fg-dim)]">
            아틀라스 페이지 {pages.length}장을 통째로 변환 — 실루엣은 원본 알파로 보존됩니다
          </span>
          <button
            type="button"
            onClick={requestClose}
            className="ml-auto rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
          >
            close
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          {bakeError && (
            <div className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-xs text-red-300">
              페이지 베이크 실패: {bakeError}
            </div>
          )}

          <label className="flex flex-col gap-1 text-xs text-[var(--color-fg-dim)]">
            <span className="uppercase tracking-widest">Prompt — 전체 스타일 지시</span>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder="예: '전체 의상을 고딕 로리타 스타일로, 검정과 와인레드 팔레트' — References 패널의 이미지가 함께 전송됩니다"
              className="rounded border border-[var(--color-border)] bg-[var(--color-panel)] px-2 py-1.5 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-dim)] focus:border-[var(--color-accent)] focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--color-fg-dim)]">
            <span className="uppercase tracking-widest">Negative (optional)</span>
            <input
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              placeholder="피하고 싶은 요소"
              className="rounded border border-[var(--color-border)] bg-[var(--color-panel)] px-2 py-1.5 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-dim)] focus:border-[var(--color-accent)] focus:outline-none"
            />
          </label>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs text-[var(--color-fg-dim)]">
              <span className="uppercase tracking-widest">
                References — 스타일 레퍼런스 ({references.length})
              </span>
              <label
                className={`cursor-pointer rounded border border-[var(--color-accent)]/60 px-2 py-0.5 text-[var(--color-accent)] ${
                  running || !puppetKey ? "cursor-not-allowed opacity-40" : ""
                }`}
                title="이 캐릭터의 스타일 레퍼런스 이미지 추가 — 사이드바 References 패널과 공유됩니다"
              >
                + upload
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={onUploadRefs}
                  disabled={running || !puppetKey}
                  className="sr-only"
                />
              </label>
            </div>
            {refError && <div className="text-[11px] text-red-300">업로드 실패: {refError}</div>}
            {refThumbs.length === 0 ? (
              <div className="rounded border border-dashed border-[var(--color-border)] px-2 py-2 text-[11px] text-[var(--color-fg-dim)]">
                레퍼런스가 없으면 프롬프트 + 전신 스냅샷만으로 변환합니다. 원하는 화풍/의상 이미지를
                올리면 모든 페이지 호출에 함께 전송되어 결과가 그 스타일을 따라갑니다.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {refThumbs.map((t) => (
                  <div key={t.id} className="group relative" title={t.name}>
                    {/* biome-ignore lint/performance/noImgElement: blob URL preview */}
                    <img
                      src={t.url}
                      alt={t.name}
                      className="h-16 w-16 rounded border border-[var(--color-border)] object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => void removeReference(t.id)}
                      disabled={running}
                      className="absolute -right-1.5 -top-1.5 hidden h-4 w-4 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-bg)] text-[10px] leading-none text-red-300 group-hover:flex"
                      title="레퍼런스 삭제"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="text-[11px] text-[var(--color-fg-dim)]">
            references {references.length}개 + 전신 스냅샷이 모든 페이지 호출에 동승 · 페이지 결과는
            다음 페이지의 스타일 앵커로 체이닝 · provider: OpenAI gpt-image (페이지당 1콜, 1–3분)
          </div>

          <div className="grid grid-cols-2 gap-3">
            {pages.map((p, i) => (
              <div
                key={p.page.pageIndex}
                className="flex flex-col gap-1.5 rounded border border-[var(--color-border)] p-2"
              >
                <div className="flex items-center justify-between text-[11px] text-[var(--color-fg-dim)]">
                  <span>
                    atlas page {p.page.pageIndex + 1} · {p.page.width}×{p.page.height}
                  </span>
                  <span
                    className={
                      p.status === "succeeded"
                        ? "text-emerald-400"
                        : p.status === "failed"
                          ? "text-red-400"
                          : p.status === "running"
                            ? "text-[var(--color-accent)]"
                            : ""
                    }
                  >
                    {p.status === "running" ? "생성 중…" : p.status}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {/* biome-ignore lint/performance/noImgElement: data/blob URL preview */}
                  <img src={p.sourceUrl} alt="source" className="w-full rounded bg-black/40" />
                  {p.resultUrl ? (
                    /* biome-ignore lint/performance/noImgElement: blob URL preview */
                    <img src={p.resultUrl} alt="result" className="w-full rounded bg-black/40" />
                  ) : (
                    <div className="flex items-center justify-center rounded bg-black/40 text-[10px] text-[var(--color-fg-dim)]">
                      {p.status === "failed" ? (p.failedReason ?? "failed") : "결과 대기"}
                    </div>
                  )}
                </div>
                {p.status === "succeeded" && (
                  <button
                    type="button"
                    onClick={() => applyPage(i)}
                    className="rounded border border-[var(--color-accent)] px-2 py-0.5 text-xs text-[var(--color-accent)]"
                    title="이 페이지만 라이브 퍼펫에 적용 (Layers 패널에서 revert 가능)"
                  >
                    apply this page
                  </button>
                )}
              </div>
            ))}
            {pages.length === 0 && !bakeError && (
              <div className="col-span-2 py-8 text-center text-xs text-[var(--color-fg-dim)]">
                페이지 베이크 중…
              </div>
            )}
          </div>
        </div>

        <footer className="flex shrink-0 items-center gap-2 border-t border-[var(--color-border)] p-3">
          <button
            type="button"
            onClick={generate}
            disabled={running || pages.length === 0 || prompt.trim().length === 0}
            className="rounded border border-[var(--color-accent)] px-3 py-1.5 text-sm text-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {running ? "restyling…" : `restyle ${pages.length} page${pages.length > 1 ? "s" : ""}`}
          </button>
          {running && (
            <button
              type="button"
              onClick={cancel}
              className="rounded border border-red-400/50 px-3 py-1.5 text-sm text-red-300"
            >
              취소
            </button>
          )}
          {anySucceeded && !running && (
            <button
              type="button"
              onClick={applyAll}
              className="rounded border border-[var(--color-accent)] bg-[var(--color-accent)]/10 px-3 py-1.5 text-sm text-[var(--color-accent)]"
              title="성공한 모든 페이지를 적용하고 닫기"
            >
              apply all & close
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
