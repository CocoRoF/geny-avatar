"use client";

import { useCallback, useEffect, useState } from "react";
import type { ProviderId } from "@/lib/ai/types";
import { apiUrl } from "@/lib/basePath";
import { API_KEY_PROVIDERS } from "@/lib/config/apiKeyProviders";

type Props = {
  open: boolean;
  onClose: () => void;
};

type KeyStatus = {
  id: ProviderId;
  label: string;
  envVar: string;
  hint: string;
  configConfigured: boolean;
  preview?: string;
  envConfigured: boolean;
  source: "config" | "env" | null;
};

/**
 * Main-page API key config modal — keys live in the server's
 * `config.json` (GET/PUT /api/config/keys), applied to the next
 * request without a restart.
 *
 * Resolution order (also explained to the user in the modal):
 *   config.json key > server `.env` default. A config key that fails
 *   auth (401/403) falls back to the `.env` key automatically — the
 *   server retries once.
 *
 * The GET endpoint only ever returns a masked preview ("sk-…1234"),
 * never the full key. So the input semantics are: blank = "no
 * change"; typing a value + 저장 = replace; the 제거 button clears.
 */
export function ApiKeysConfig({ open, onClose }: Props) {
  const [status, setStatus] = useState<KeyStatus[] | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<ProviderId, string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const refreshStatus = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch(apiUrl("/api/config/keys"), { cache: "no-store" });
      if (!r.ok) throw new Error(`/api/config/keys ${r.status}`);
      const data = (await r.json()) as { keys: KeyStatus[] };
      setStatus(data.keys);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setDrafts({});
    setSavedFlash(false);
    void refreshStatus();
  }, [open, refreshStatus]);

  // Esc to close — window-level so focus position doesn't matter.
  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const mutate = useCallback(
    async (body: { set?: Partial<Record<ProviderId, string>>; clear?: ProviderId[] }) => {
      setBusy(true);
      setError(null);
      try {
        const r = await fetch(apiUrl("/api/config/keys"), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await r.json()) as { keys?: KeyStatus[]; error?: string };
        if (!r.ok) throw new Error(data.error ?? `/api/config/keys ${r.status}`);
        if (data.keys) setStatus(data.keys);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const onSave = useCallback(async () => {
    const set: Partial<Record<ProviderId, string>> = {};
    for (const { id } of API_KEY_PROVIDERS) {
      const v = drafts[id]?.trim();
      if (v) set[id] = v;
    }
    if (Object.keys(set).length === 0) return;
    const ok = await mutate({ set });
    if (ok) {
      setDrafts({});
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1500);
    }
  }, [drafts, mutate]);

  const onClear = useCallback(
    async (id: ProviderId) => {
      await mutate({ clear: [id] });
    },
    [mutate],
  );

  if (!open) return null;

  const hasDraft = API_KEY_PROVIDERS.some(({ id }) => (drafts[id]?.trim().length ?? 0) > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div
        className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded border border-[var(--color-border)] bg-[var(--color-bg)]"
        role="dialog"
        aria-label="API key 설정"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-[var(--color-border)] px-4 py-2 text-xs">
          <span className="font-mono text-[var(--color-accent)]">config · API keys</span>
          <span className="text-[var(--color-fg-dim)]">서버 config.json 에 저장 · 즉시 적용</span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
          >
            close
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          <p className="text-xs leading-relaxed text-[var(--color-fg-dim)]">
            우선순위: <span className="text-[var(--color-fg)]">config.json 키</span> &gt; 서버{" "}
            <span className="font-mono">.env</span> 기본값. config 키가 인증에 실패(401/403)하면
            서버가 자동으로 <span className="font-mono">.env</span> 키로 한 번 재시도합니다. 저장된
            키는 다시 표시되지 않습니다 (마스킹 미리보기만) — 빈 입력은 "변경 없음"입니다.
          </p>
          {error && (
            <div className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-xs text-red-300">
              {error}
            </div>
          )}

          {API_KEY_PROVIDERS.map(({ id, label, envVar, hint }) => {
            const st = status?.find((k) => k.id === id);
            return (
              <div key={id} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-[var(--color-fg)]">
                    {label}{" "}
                    <span className="font-mono text-[10px] text-[var(--color-fg-dim)]">
                      ({envVar})
                    </span>
                  </span>
                  <span className="text-[10px] text-[var(--color-fg-dim)]">{hint}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="password"
                    value={drafts[id] ?? ""}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [id]: e.target.value }))}
                    placeholder={
                      st?.configConfigured
                        ? `저장됨: ${st.preview} — 새 키 입력 시 교체`
                        : st?.envConfigured
                          ? "(비워두면 서버 .env 기본값 사용)"
                          : "키 입력 — .env 에도 미설정"
                    }
                    autoComplete="off"
                    spellCheck={false}
                    disabled={busy}
                    className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-panel)] px-2 py-1.5 font-mono text-xs text-[var(--color-fg)] placeholder:text-[var(--color-fg-dim)] focus:border-[var(--color-accent)] focus:outline-none"
                  />
                  {st?.configConfigured && (
                    <button
                      type="button"
                      onClick={() => void onClear(id)}
                      disabled={busy}
                      className="shrink-0 rounded border border-[var(--color-border)] px-2 py-1.5 text-[10px] text-[var(--color-fg-dim)] hover:border-red-400/60 hover:text-red-300 disabled:opacity-40"
                      title="config.json 에서 이 키 제거 (.env 기본값으로 복귀)"
                    >
                      제거
                    </button>
                  )}
                </div>
                <div className="text-[10px]">
                  {st?.source === "config" ? (
                    <span className="text-emerald-400">
                      ✓ config.json 키 사용 중{st.envConfigured ? " (.env fallback 있음)" : ""}
                    </span>
                  ) : st?.source === "env" ? (
                    <span className="text-[var(--color-fg-dim)]">.env 기본값 사용 중</span>
                  ) : status ? (
                    <span className="text-amber-400">미설정 — 이 provider 는 비활성</span>
                  ) : (
                    <span className="text-[var(--color-fg-dim)]">상태 확인 중…</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <footer className="flex shrink-0 items-center gap-2 border-t border-[var(--color-border)] p-3">
          <button
            type="button"
            onClick={() => void onSave()}
            disabled={busy || !hasDraft}
            className="rounded border border-[var(--color-accent)] px-3 py-1.5 text-sm text-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "저장 중…" : "저장"}
          </button>
          {savedFlash && <span className="text-xs text-emerald-400">저장됨 — 즉시 적용</span>}
          <span className="ml-auto text-[10px] text-[var(--color-fg-dim)]">
            입력한 provider 만 갱신 · 제거 = .env 복귀
          </span>
        </footer>
      </div>
    </div>
  );
}
