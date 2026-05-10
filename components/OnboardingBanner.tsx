"use client";

import { useEffect, useState } from "react";

type Props = {
  /** Opens the full help modal so the user can read more after a
   *  banner intro. Wired from the editor page that already owns
   *  the modal state. */
  onOpenHelp: () => void;
};

/** localStorage key. Versioned so future copy / shortcut changes
 *  can re-surface the banner via a `:v2` bump without nuking the
 *  whole user prefs namespace. */
const STORAGE_KEY = "geny-avatar:onboarding-dismissed:v1";

/**
 * One-time onboarding banner shown above the PuppetCanvas on the
 * editor page. Lists the three or four moves a first-timer needs
 * to know — toggle a layer, refine its mask, swap its texture
 * with AI — and points at the `?` help modal for the long form.
 *
 * Dismissed state lives in localStorage so returning users don't
 * see the banner again. The HelpModal exposes a "show this
 * onboarding again" button that wipes the key when the user wants
 * the intro back.
 */
export function OnboardingBanner({ onOpenHelp }: Props) {
  // Start `null` so SSR + first hydration render NOTHING (no flash
  // of banner before we read localStorage). Real value populates
  // in the mount effect below.
  const [show, setShow] = useState<boolean | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const dismissed = window.localStorage.getItem(STORAGE_KEY);
      setShow(dismissed !== "1");
    } catch {
      // Private mode / blocked storage — show the banner; the
      // dismiss click would just no-op the persist but still hide
      // for this session via state.
      setShow(true);
    }
  }, []);

  const dismiss = () => {
    setShow(false);
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // ignore — state already updated for this session
    }
  };

  if (show !== true) return null;

  return (
    <div className="shrink-0 border-b border-[var(--color-accent)]/30 bg-[var(--color-accent)]/5 px-4 py-2 text-xs text-[var(--color-fg)]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-medium text-[var(--color-accent)]">처음이신가요?</span>
        <span className="text-[var(--color-fg-dim)]">1. 레이어 행 클릭 = 보이기/숨기기 ·</span>
        <span className="text-[var(--color-fg-dim)]">
          2. 레이어 썸네일 클릭 = Decompose (mask · region)
        </span>
        <span className="text-[var(--color-fg-dim)]">· 3. ✨ generate = AI 텍스처 교체</span>
        <button
          type="button"
          onClick={onOpenHelp}
          className="ml-auto rounded border border-[var(--color-accent)]/40 px-2 py-0.5 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10"
        >
          전체 안내 보기 (?)
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
        >
          got it
        </button>
      </div>
    </div>
  );
}

/** Clears the dismissed flag — bound to the HelpModal's
 *  "show onboarding again" button so the banner can reappear on
 *  the next editor visit. */
export function resetOnboardingDismissed(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
