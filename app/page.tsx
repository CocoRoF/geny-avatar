type Phase = {
  id: string;
  title: string;
  status: "done" | "active" | "pending";
  blurb: string;
};

const phases: Phase[] = [
  {
    id: "P0",
    title: "Spike & Adapter Interface Lock",
    status: "active",
    blurb: "Spine + Cubism PoC, 어댑터 인터페이스 확정, 동시 마운트 검증",
  },
  {
    id: "P1",
    title: "Dual Runtime + Upload",
    status: "pending",
    blurb: "두 어댑터 동시 구현, 드래그-드롭 업로드 day-1, 레이어 토글",
  },
  {
    id: "P2",
    title: "Atlas & Decompose Studio",
    status: "pending",
    blurb: "region 슬라이싱, mesh silhouette, 알파/브러시 마스킹",
  },
  {
    id: "P3",
    title: "AI Texture Generation",
    status: "pending",
    blurb: "Replicate 통합, SDXL inpaint + canny ControlNet 워크플로",
  },
  {
    id: "P4",
    title: "Variant System & Export",
    status: "pending",
    blurb: "스킨/변형 모델, ZIP 라운드트립",
  },
  {
    id: "P5",
    title: "AI Quality Push",
    status: "pending",
    blurb: "IP-Adapter + 사용자 LoRA, 자체 ComfyUI",
  },
  {
    id: "P6",
    title: "Decompose Pro",
    status: "pending",
    blurb: "SAM 자동 마스크, 마스킹 UX 개선",
  },
  {
    id: "P7",
    title: "Polish & V1",
    status: "pending",
    blurb: "성능, 온보딩, V1 시연 가능 상태",
  },
];

const philosophies = [
  {
    id: "P1",
    title: "Cubism + Spine 모두 1차",
    blurb:
      "두 어댑터를 처음부터 같이 구현. 인터넷 자산이 두 포맷으로 반반이라 한쪽만 지원하면 도구 가치의 절반을 잃는다.",
  },
  {
    id: "P2",
    title: "Upload Day-1",
    blurb:
      "인터넷에서 받은 puppet을 드래그-드롭하면 즉시 미리보기. Spine 3.8/4.0/4.1/4.2 + Cubism 4/5 (best-effort 2/3) 모두 받는다.",
  },
];

function statusDot(status: Phase["status"]): string {
  if (status === "done") return "bg-[var(--color-accent)]";
  if (status === "active") return "bg-[var(--color-accent)] animate-pulse";
  return "bg-[var(--color-border)]";
}

export default function Home() {
  return (
    <main className="mx-auto max-w-4xl px-8 py-16">
      <header className="mb-16">
        <div className="mb-2 font-mono text-xs text-[var(--color-fg-dim)]">v0.0.1 · phase 0</div>
        <h1 className="mb-3 text-4xl font-semibold tracking-tight">geny-avatar</h1>
        <p className="text-lg text-[var(--color-fg-dim)]">
          Web-based 2D Live Avatar editor with AI-driven texture generation.
        </p>
        <p className="mt-1 text-sm text-[var(--color-fg-dim)]">
          Cubism · Spine · Next.js · Pixi v8 · SDXL inpaint
        </p>
      </header>

      <section className="mb-16">
        <h2 className="mb-4 text-xs font-medium uppercase tracking-widest text-[var(--color-fg-dim)]">
          Operating Philosophies
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {philosophies.map((p) => (
            <div
              key={p.id}
              className="rounded border border-[var(--color-border)] bg-[var(--color-panel)] p-4"
            >
              <div className="mb-1 flex items-baseline gap-2">
                <span className="font-mono text-xs text-[var(--color-accent)]">{p.id}</span>
                <span className="font-medium">{p.title}</span>
              </div>
              <p className="text-sm leading-relaxed text-[var(--color-fg-dim)]">{p.blurb}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-xs font-medium uppercase tracking-widest text-[var(--color-fg-dim)]">
          Roadmap
        </h2>
        <ol className="space-y-2">
          {phases.map((phase) => (
            <li
              key={phase.id}
              className="flex items-start gap-4 rounded border border-[var(--color-border)] bg-[var(--color-panel)] p-4"
            >
              <span
                role="img"
                aria-label={phase.status}
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${statusDot(phase.status)}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-xs text-[var(--color-fg-dim)]">{phase.id}</span>
                  <span className="font-medium">{phase.title}</span>
                </div>
                <p className="mt-0.5 text-sm text-[var(--color-fg-dim)]">{phase.blurb}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-16">
        <h2 className="mb-4 text-xs font-medium uppercase tracking-widest text-[var(--color-fg-dim)]">
          Phase 0 PoC
        </h2>
        <div className="grid gap-2 sm:grid-cols-3">
          <a
            href="/poc/spine"
            className="rounded border border-[var(--color-border)] bg-[var(--color-panel)] p-3 hover:border-[var(--color-accent)]"
          >
            <div className="font-mono text-xs text-[var(--color-accent)]">/poc/spine</div>
            <div className="mt-1 text-sm">spineboy + slot toggle</div>
          </a>
          <a
            href="/poc/cubism"
            className="rounded border border-[var(--color-border)] bg-[var(--color-panel)] p-3 hover:border-[var(--color-accent)]"
          >
            <div className="font-mono text-xs text-[var(--color-accent)]">/poc/cubism</div>
            <div className="mt-1 text-sm">Hiyori + part toggle</div>
          </a>
          <a
            href="/poc/dual"
            className="rounded border border-[var(--color-border)] bg-[var(--color-panel)] p-3 hover:border-[var(--color-accent)]"
          >
            <div className="font-mono text-xs text-[var(--color-accent)]">/poc/dual</div>
            <div className="mt-1 text-sm">T-rt1 — 두 런타임 동시 마운트</div>
          </a>
          <a
            href="/poc/upload-debug"
            className="rounded border border-[var(--color-border)] bg-[var(--color-panel)] p-3 hover:border-[var(--color-accent)]"
          >
            <div className="font-mono text-xs text-[var(--color-accent)]">/poc/upload-debug</div>
            <div className="mt-1 text-sm">parseBundle 결과 뷰어 (sprint 1.3a)</div>
          </a>
          <a
            href="/poc/upload"
            className="rounded border border-[var(--color-border)] bg-[var(--color-panel)] p-3 hover:border-[var(--color-accent)]"
          >
            <div className="font-mono text-xs text-[var(--color-accent)]">/poc/upload</div>
            <div className="mt-1 text-sm">드롭→로드→미리보기 (sprint 1.3b)</div>
          </a>
        </div>
      </section>

      <footer className="mt-16 border-t border-[var(--color-border)] pt-6 text-xs text-[var(--color-fg-dim)]">
        설계 문서는{" "}
        <code className="rounded bg-[var(--color-panel)] px-1.5 py-0.5 font-mono">docs/</code> —
        analysis, plan, progress
      </footer>
    </main>
  );
}
