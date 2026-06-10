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
import {
  buildLayerCatalog,
  executePlanItem,
  type LayerCatalog,
  requestRestylePlan,
} from "@/lib/ai/restyleOrchestrator";
import { renderPuppetReference } from "@/lib/avatar/canonicalPoseRender";
import type { Avatar, LayerId } from "@/lib/avatar/types";
import { useReferences } from "@/lib/avatar/useReferences";
import { saveAIJob } from "@/lib/persistence/db";
import { useEditorStore } from "@/lib/store/editor";

type PageState = {
  page: RestylePageSource;
  sourceUrl: string;
  status: "idle" | "running" | "succeeded" | "failed";
  resultBlob?: Blob;
  resultUrl?: string;
  failedReason?: string;
};

type SmartItem = {
  /** Catalog index (what the planner referenced). */
  index: number;
  instruction: string;
  enabled: boolean;
  status: "idle" | "running" | "succeeded" | "failed";
  failedReason?: string;
  thumbUrl: string;
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
 * Whole-character restyle. Two strategies:
 *
 *  - **smart (default)** — a vision LLM reads a numbered contact sheet
 *    of every visible layer + the assembled character + the style
 *    references, plans WHICH parts to repaint with WHAT instruction,
 *    and the proven per-layer pipeline executes each item at full
 *    resolution. The user reviews/edits the plan before spending image
 *    calls; results land live per layer and the whole run is
 *    revertible in one click.
 *
 *  - **page (experimental)** — transform whole atlas pages in one call
 *    each. Kept for small atlases; weak on 2048+ pages (detail loss,
 *    sprite-sheet ↔ body-part mapping is too hard for the model).
 */
export function RestylePanel({ open, onClose, adapter, avatar, app, puppetKey }: Props) {
  const setLayerTextureOverride = useEditorStore((s) => s.setLayerTextureOverride);
  const setPageTextureOverride = useEditorStore((s) => s.setPageTextureOverride);
  // Shared with the sidebar References panel (same IDB rows).
  const { references, upload: uploadReference, remove: removeReference } = useReferences(puppetKey);

  const [mode, setMode] = useState<"smart" | "page">("smart");
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [refError, setRefError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ── smart mode state ────────────────────────────────────────────
  const [catalog, setCatalog] = useState<LayerCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [styleAnchor, setStyleAnchor] = useState("");
  const [smartItems, setSmartItems] = useState<SmartItem[] | null>(null);
  const [executing, setExecuting] = useState(false);
  const snapshotRef = useRef<Blob | null>(null);
  /** Pre-run override blobs per touched layer — "이번 실행 되돌리기". */
  const prevOverridesRef = useRef<Map<LayerId, Blob | null>>(new Map());
  const [canRevertRun, setCanRevertRun] = useState(false);

  // ── page mode state ─────────────────────────────────────────────
  const [pages, setPages] = useState<PageState[]>([]);
  const [pageRunning, setPageRunning] = useState(false);
  const [bakeError, setBakeError] = useState<string | null>(null);

  const busy = planning || executing || pageRunning;

  // Build the layer catalog when the panel opens in smart mode (also
  // used as the bake trigger for page mode previews).
  useEffect(() => {
    if (!open || !adapter || !avatar) return;
    let cancelled = false;
    setCatalog(null);
    setCatalogError(null);
    setSmartItems(null);
    setStyleAnchor("");
    setCanRevertRun(false);
    prevOverridesRef.current = new Map();
    (async () => {
      try {
        const { visibilityOverrides, layerMasks, layerTextureOverrides } =
          useEditorStore.getState();
        const built = await buildLayerCatalog({
          adapter,
          avatar,
          visibilityOverrides,
          layerMasks,
          layerTextureOverrides,
        });
        if (!cancelled) setCatalog(built);
      } catch (e) {
        if (!cancelled) setCatalogError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, adapter, avatar]);

  // Page-mode sources bake lazily when the user switches to page mode.
  useEffect(() => {
    if (!open || mode !== "page" || !adapter || !avatar || pages.length > 0) return;
    let cancelled = false;
    setBakeError(null);
    (async () => {
      try {
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
  }, [open, mode, adapter, avatar, pages.length]);

  // Reference thumbnail URLs (previous list revoked on change — the
  // fresh memo minted new URLs for everything rendered).
  const refThumbs = useMemo(
    () => references.map((r) => ({ id: r.id, name: r.name, url: URL.createObjectURL(r.blob) })),
    [references],
  );
  useEffect(() => {
    return () => {
      for (const t of refThumbs) URL.revokeObjectURL(t.url);
    };
  }, [refThumbs]);

  // Page-result preview URLs: revoke on unmount only.
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  useEffect(() => {
    return () => {
      for (const p of pagesRef.current) {
        if (p.resultUrl) URL.revokeObjectURL(p.resultUrl);
      }
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") requestCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const onUploadRefs = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = "";
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

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // ── smart: plan ─────────────────────────────────────────────────
  const generatePlan = useCallback(async () => {
    if (!catalog || planning || prompt.trim().length === 0) return;
    setPlanning(true);
    setPlanError(null);
    setSmartItems(null);
    try {
      if (app && !snapshotRef.current) {
        try {
          snapshotRef.current = await renderPuppetReference(app);
        } catch (e) {
          console.warn("[restyle] snapshot capture failed; planning without", e);
        }
      }
      const plan = await requestRestylePlan({
        userPrompt: prompt.trim(),
        catalog,
        snapshot: snapshotRef.current,
        referenceImages: references.map((r) => r.blob),
        maxItems: 14,
      });
      setStyleAnchor(plan.styleAnchor);
      setSmartItems(
        plan.plan.map((p) => {
          const entry = catalog.entries[p.index];
          // 64px thumbs for the plan list — the catalog canvas can be large.
          const t = document.createElement("canvas");
          const scale = Math.min(64 / entry.canvas.width, 64 / entry.canvas.height, 1);
          t.width = Math.max(1, Math.round(entry.canvas.width * scale));
          t.height = Math.max(1, Math.round(entry.canvas.height * scale));
          t.getContext("2d")?.drawImage(entry.canvas, 0, 0, t.width, t.height);
          return {
            index: p.index,
            instruction: p.instruction,
            enabled: true,
            status: "idle" as const,
            thumbUrl: t.toDataURL("image/png"),
          };
        }),
      );
    } catch (e) {
      setPlanError(e instanceof Error ? e.message : String(e));
    } finally {
      setPlanning(false);
    }
  }, [catalog, planning, prompt, app, references]);

  // ── smart: execute ──────────────────────────────────────────────
  const executePlan = useCallback(async () => {
    if (!catalog || !smartItems || executing) return;
    const targets = smartItems.filter((it) => it.enabled);
    if (targets.length === 0) return;
    setExecuting(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const refBlobs = references.map((r) => r.blob);
    try {
      // Concurrency 2: parallel enough to matter, gentle on rate limits.
      let cursor = 0;
      const worker = async () => {
        while (cursor < targets.length && !controller.signal.aborted) {
          const item = targets[cursor++];
          const entry = catalog.entries[item.index];
          setSmartItems((prev) =>
            (prev ?? []).map((it) =>
              it.index === item.index ? { ...it, status: "running", failedReason: undefined } : it,
            ),
          );
          try {
            const blob = await executePlanItem({
              entry,
              instruction: item.instruction,
              styleAnchor,
              userPrompt: prompt.trim(),
              snapshot: snapshotRef.current,
              referenceImages: refBlobs,
              signal: controller.signal,
            });
            // Capture the pre-run override once per layer so the whole
            // run can be reverted.
            if (!prevOverridesRef.current.has(entry.layer.id)) {
              prevOverridesRef.current.set(
                entry.layer.id,
                useEditorStore.getState().layerTextureOverrides[entry.layer.id] ?? null,
              );
            }
            setLayerTextureOverride(entry.layer.id, blob);
            setCanRevertRun(true);
            if (puppetKey) {
              void saveAIJob({
                puppetKey,
                layerExternalId: entry.layer.externalId,
                providerId: "openai",
                prompt: item.instruction,
                negativePrompt: negativePrompt.trim() || undefined,
                resultBlob: blob,
                regionSignature: "restyle-orchestrator",
              }).catch(() => {});
            }
            setSmartItems((prev) =>
              (prev ?? []).map((it) =>
                it.index === item.index ? { ...it, status: "succeeded" } : it,
              ),
            );
          } catch (e) {
            const reason = e instanceof Error ? e.message : String(e);
            setSmartItems((prev) =>
              (prev ?? []).map((it) =>
                it.index === item.index ? { ...it, status: "failed", failedReason: reason } : it,
              ),
            );
            if (controller.signal.aborted) return;
          }
        }
      };
      await Promise.all([worker(), worker()]);
    } finally {
      setExecuting(false);
    }
  }, [
    catalog,
    smartItems,
    executing,
    references,
    styleAnchor,
    prompt,
    negativePrompt,
    puppetKey,
    setLayerTextureOverride,
  ]);

  const revertRun = useCallback(() => {
    for (const [layerId, blob] of prevOverridesRef.current) {
      setLayerTextureOverride(layerId, blob);
    }
    prevOverridesRef.current = new Map();
    setCanRevertRun(false);
    setSmartItems((prev) =>
      (prev ?? []).map((it) => (it.status === "succeeded" ? { ...it, status: "idle" } : it)),
    );
  }, [setLayerTextureOverride]);

  // ── page mode generate (unchanged pipeline) ─────────────────────
  const generatePages = useCallback(async () => {
    if (pageRunning || pages.length === 0 || prompt.trim().length === 0) return;
    setPageRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const refBlobs = references.map((r) => r.blob);
      let snapshot: Blob | null = snapshotRef.current;
      if (app && !snapshot) {
        try {
          snapshot = await renderPuppetReference(app);
          snapshotRef.current = snapshot;
        } catch (e) {
          console.warn("[restyle] snapshot capture failed; continuing without", e);
        }
      }
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
          if (controller.signal.aborted) break;
        }
      }
    } finally {
      setPageRunning(false);
    }
  }, [pageRunning, pages, prompt, negativePrompt, references, app]);

  const applyPage = useCallback(
    (i: number) => {
      const entry = pages[i];
      if (!entry?.resultBlob) return;
      setPageTextureOverride(entry.page.pageIndex, entry.resultBlob);
    },
    [pages, setPageTextureOverride],
  );

  const applyAllPages = useCallback(() => {
    for (const entry of pages) {
      if (entry.resultBlob) setPageTextureOverride(entry.page.pageIndex, entry.resultBlob);
    }
    onClose();
  }, [pages, setPageTextureOverride, onClose]);

  const requestClose = useCallback(() => {
    if (busy) {
      if (typeof window !== "undefined") {
        const ok = window.confirm("Restyle 진행 중입니다.\n\n확인 = 취소하고 닫기\n취소 = 계속");
        if (!ok) return;
      }
      cancel();
    }
    onClose();
  }, [busy, cancel, onClose]);
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  if (!open) return null;

  const enabledCount = smartItems?.filter((it) => it.enabled).length ?? 0;
  const anyPageSucceeded = pages.some((p) => p.status === "succeeded");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div
        className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded border border-[var(--color-border)] bg-[var(--color-bg)]"
        role="dialog"
        aria-label="전신 리스타일"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-[var(--color-border)] px-4 py-2 text-xs">
          <span className="font-mono text-[var(--color-accent)]">restyle · whole character</span>
          <div className="flex items-center gap-1 rounded border border-[var(--color-border)] p-0.5">
            <button
              type="button"
              onClick={() => setMode("smart")}
              disabled={busy}
              className={`rounded px-2 py-0.5 ${mode === "smart" ? "bg-[var(--color-accent)]/15 text-[var(--color-accent)]" : "text-[var(--color-fg-dim)]"}`}
              title="vision LLM 이 부위별 플랜을 짜고, 부위 단위 고해상 생성으로 실행 (권장)"
            >
              AI 플랜
            </button>
            <button
              type="button"
              onClick={() => setMode("page")}
              disabled={busy}
              className={`rounded px-2 py-0.5 ${mode === "page" ? "bg-[var(--color-accent)]/15 text-[var(--color-accent)]" : "text-[var(--color-fg-dim)]"}`}
              title="아틀라스 페이지를 통째로 변환 (실험적 — 큰 페이지에서는 디테일 손실)"
            >
              페이지 통짜
            </button>
          </div>
          <button
            type="button"
            onClick={requestClose}
            className="ml-auto rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
          >
            close
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          <label className="flex flex-col gap-1 text-xs text-[var(--color-fg-dim)]">
            <span className="uppercase tracking-widest">Prompt — 전체 스타일 지시</span>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={2}
              placeholder="예: '전체 의상을 레퍼런스 이미지의 화이트 셔츠 스타일로 — 흰색·은색 팔레트'"
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

          {/* References strip — shared with the sidebar panel */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs text-[var(--color-fg-dim)]">
              <span className="uppercase tracking-widest">
                References — 스타일 레퍼런스 ({references.length})
              </span>
              <label
                className={`cursor-pointer rounded border border-[var(--color-accent)]/60 px-2 py-0.5 text-[var(--color-accent)] ${busy || !puppetKey ? "cursor-not-allowed opacity-40" : ""}`}
                title="스타일 레퍼런스 추가 — 사이드바 References 패널과 공유"
              >
                + upload
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={onUploadRefs}
                  disabled={busy || !puppetKey}
                  className="sr-only"
                />
              </label>
            </div>
            {refError && <div className="text-[11px] text-red-300">업로드 실패: {refError}</div>}
            {refThumbs.length === 0 ? (
              <div className="rounded border border-dashed border-[var(--color-border)] px-2 py-1.5 text-[11px] text-[var(--color-fg-dim)]">
                레퍼런스를 올리면 플랜과 모든 부위 생성에 함께 전송됩니다.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {refThumbs.map((t) => (
                  <div key={t.id} className="group relative" title={t.name}>
                    {/* biome-ignore lint/performance/noImgElement: blob URL preview */}
                    <img
                      src={t.url}
                      alt={t.name}
                      className="h-14 w-14 rounded border border-[var(--color-border)] object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => void removeReference(t.id)}
                      disabled={busy}
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

          {/* ── smart mode body ── */}
          {mode === "smart" && (
            <>
              <div className="text-[11px] text-[var(--color-fg-dim)]">
                {catalogError ? (
                  <span className="text-red-300">레이어 카탈로그 실패: {catalogError}</span>
                ) : catalog ? (
                  <>
                    편집 가능 레이어 {catalog.entries.length}개 카탈로그 준비됨 — "플랜 생성" 을
                    누르면 vision LLM 이 어떤 부위를 어떻게 바꿀지 결정합니다 (chat 1콜). 플랜을
                    검토·수정한 뒤 실행하면 부위당 이미지 1콜로 생성되고, 완료되는 대로 라이브
                    퍼펫에 즉시 반영됩니다.
                  </>
                ) : (
                  "레이어 카탈로그 생성 중…"
                )}
              </div>
              {planError && (
                <div className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-xs text-red-300">
                  플랜 실패: {planError}
                </div>
              )}

              {smartItems && (
                <div className="flex flex-col gap-2">
                  <label className="flex flex-col gap-1 text-xs text-[var(--color-fg-dim)]">
                    <span className="uppercase tracking-widest">
                      Style anchor — 모든 부위가 공유하는 팔레트/재질 (수정 가능)
                    </span>
                    <input
                      value={styleAnchor}
                      onChange={(e) => setStyleAnchor(e.target.value)}
                      disabled={executing}
                      className="rounded border border-[var(--color-border)] bg-[var(--color-panel)] px-2 py-1.5 text-xs text-[var(--color-fg)] focus:border-[var(--color-accent)] focus:outline-none"
                    />
                  </label>
                  <div className="flex flex-col gap-1.5">
                    {smartItems.map((item) => {
                      const entry = catalog?.entries[item.index];
                      if (!entry) return null;
                      return (
                        <div
                          key={item.index}
                          className={`flex items-start gap-2 rounded border p-2 ${
                            item.status === "succeeded"
                              ? "border-emerald-500/40"
                              : item.status === "failed"
                                ? "border-red-500/40"
                                : "border-[var(--color-border)]"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={item.enabled}
                            disabled={executing}
                            onChange={(e) =>
                              setSmartItems((prev) =>
                                (prev ?? []).map((it) =>
                                  it.index === item.index
                                    ? { ...it, enabled: e.target.checked }
                                    : it,
                                ),
                              )
                            }
                            className="mt-1"
                          />
                          {/* biome-ignore lint/performance/noImgElement: data URL thumb */}
                          <img
                            src={item.thumbUrl}
                            alt={entry.layer.name}
                            className="h-12 w-12 shrink-0 rounded border border-[var(--color-border)] bg-black/40 object-contain"
                          />
                          <div className="flex min-w-0 flex-1 flex-col gap-1">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="truncate text-[var(--color-fg)]">
                                #{item.index} · {entry.layer.name}
                              </span>
                              <span
                                className={
                                  item.status === "succeeded"
                                    ? "text-emerald-400"
                                    : item.status === "failed"
                                      ? "text-red-400"
                                      : item.status === "running"
                                        ? "text-[var(--color-accent)]"
                                        : "text-[var(--color-fg-dim)]"
                                }
                              >
                                {item.status === "running" ? "생성 중…" : item.status}
                              </span>
                            </div>
                            <textarea
                              value={item.instruction}
                              disabled={executing}
                              rows={2}
                              onChange={(e) =>
                                setSmartItems((prev) =>
                                  (prev ?? []).map((it) =>
                                    it.index === item.index
                                      ? { ...it, instruction: e.target.value }
                                      : it,
                                  ),
                                )
                              }
                              className="rounded border border-[var(--color-border)] bg-[var(--color-panel)] px-2 py-1 text-[11px] leading-snug text-[var(--color-fg)] focus:border-[var(--color-accent)] focus:outline-none"
                            />
                            {item.failedReason && (
                              <div className="text-[10px] text-red-300">{item.failedReason}</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── page mode body ── */}
          {mode === "page" && (
            <>
              {bakeError && (
                <div className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-xs text-red-300">
                  페이지 베이크 실패: {bakeError}
                </div>
              )}
              <div className="text-[11px] text-[var(--color-fg-dim)]">
                실험적 — 페이지 전체를 1024 로 줄여 한 번에 변환합니다. 큰 아틀라스(2048+)에서는
                디테일이 손실되고 부위 매핑이 부정확할 수 있습니다. "AI 플랜" 모드를 권장합니다.
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
                        <img
                          src={p.resultUrl}
                          alt="result"
                          className="w-full rounded bg-black/40"
                        />
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
                        title="이 페이지만 적용 (Layers 패널에서 revert 가능)"
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
            </>
          )}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-[var(--color-border)] p-3">
          {mode === "smart" ? (
            <>
              <button
                type="button"
                onClick={() => void generatePlan()}
                disabled={busy || !catalog || prompt.trim().length === 0}
                className="rounded border border-[var(--color-accent)] px-3 py-1.5 text-sm text-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {planning ? "플랜 생성 중…" : smartItems ? "플랜 다시 생성" : "1) AI 플랜 생성"}
              </button>
              {smartItems && (
                <button
                  type="button"
                  onClick={() => void executePlan()}
                  disabled={busy || enabledCount === 0}
                  className="rounded border border-[var(--color-accent)] bg-[var(--color-accent)]/10 px-3 py-1.5 text-sm text-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {executing ? "실행 중…" : `2) 선택한 ${enabledCount}개 부위 생성`}
                </button>
              )}
              {canRevertRun && !executing && (
                <button
                  type="button"
                  onClick={revertRun}
                  className="rounded border border-red-400/50 px-3 py-1.5 text-sm text-red-300"
                  title="이번 실행으로 바뀐 모든 레이어를 실행 전 상태로 복구"
                >
                  이번 실행 되돌리기
                </button>
              )}
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void generatePages()}
                disabled={busy || pages.length === 0 || prompt.trim().length === 0}
                className="rounded border border-[var(--color-accent)] px-3 py-1.5 text-sm text-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {pageRunning
                  ? "restyling…"
                  : `restyle ${pages.length} page${pages.length > 1 ? "s" : ""}`}
              </button>
              {anyPageSucceeded && !pageRunning && (
                <button
                  type="button"
                  onClick={applyAllPages}
                  className="rounded border border-[var(--color-accent)] bg-[var(--color-accent)]/10 px-3 py-1.5 text-sm text-[var(--color-accent)]"
                >
                  apply all & close
                </button>
              )}
            </>
          )}
          {busy && (
            <button
              type="button"
              onClick={cancel}
              className="rounded border border-red-400/50 px-3 py-1.5 text-sm text-red-300"
            >
              취소
            </button>
          )}
          <span className="ml-auto text-[10px] text-[var(--color-fg-dim)]">
            provider: OpenAI gpt-image · 부위당 1콜 (1–3분)
          </span>
        </footer>
      </div>
    </div>
  );
}
