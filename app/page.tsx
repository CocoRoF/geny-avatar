import { AttributionFooter } from "@/components/AttributionFooter";
import { BUILTIN_SAMPLES } from "@/lib/builtin/samples";

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
    status: "done",
    blurb: "Spine + Cubism PoC, 어댑터 인터페이스 확정, 동시 마운트 검증",
  },
  {
    id: "P1",
    title: "Dual Runtime + Upload",
    status: "done",
    blurb: "두 어댑터 동시 구현, 드래그-드롭 업로드 day-1, 레이어 토글",
  },
  {
    id: "P2",
    title: "Atlas & Decompose Studio",
    status: "done",
    blurb: "region 슬라이싱, mesh silhouette, 알파/브러시 마스킹",
  },
  {
    id: "P3",
    title: "AI Texture Generation",
    status: "done",
    blurb: "OpenAI gpt-image-2 multi-image edits, references 첨부, region 합성",
  },
  {
    id: "P4",
    title: "Variant System & Export",
    status: "done",
    blurb: "스킨/변형 모델, *.geny-avatar.zip 라운드트립",
  },
  {
    id: "P5",
    title: "AI Quality Push",
    status: "done",
    blurb: "Refine prompt, focus mode region 별 prompt, per-region revert·history",
  },
  {
    id: "P6",
    title: "Decompose Pro",
    status: "done",
    blurb: "SAM 자동 마스크, brush/SAM 합성 (union/intersect/subtract), fullscreen",
  },
  {
    id: "P7",
    title: "Polish & V1",
    status: "active",
    blurb: "Help modal · onboarding · 한국어화 · attribution · 성능 — V1 시연 가능 상태",
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
    <>
      <main className="mx-auto max-w-4xl px-8 py-16">
        <header className="mb-16">
          <div className="mb-2 font-mono text-xs text-[var(--color-fg-dim)]">
            v0.1.0 · phase 7 (polish & V1)
          </div>
          <h1 className="mb-3 text-4xl font-semibold tracking-tight">geny-avatar</h1>
          <p className="text-lg text-[var(--color-fg-dim)]">
            Cubism / Spine puppet 을 브라우저에서 열고, 레이어를 분해하고, 생성형 AI 로 텍스처를
            교체합니다.
          </p>
          <p className="mt-1 text-sm text-[var(--color-fg-dim)]">
            Cubism · Spine · Next.js · Pixi v8 · OpenAI gpt-image-2 · SAM
          </p>
        </header>

        <section className="mb-16">
          <h2 className="mb-4 text-xs font-medium uppercase tracking-widest text-[var(--color-fg-dim)]">
            Built-in samples
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {BUILTIN_SAMPLES.map((s) => (
              <a
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
              </a>
            ))}
          </div>
          <p className="mt-3 text-xs text-[var(--color-fg-dim)]">
            본인 puppet 은{" "}
            <a href="/poc/upload" className="text-[var(--color-accent)] underline">
              업로드
            </a>{" "}
            → 자동 저장 → 같은 에디터로 진입. 저장된 puppet 은{" "}
            <a href="/poc/library" className="text-[var(--color-accent)] underline">
              라이브러리
            </a>{" "}
            에서 다시 열 수 있습니다.
          </p>
        </section>

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
            Debug / 데모 페이지
          </h2>
          <div className="grid gap-2 sm:grid-cols-3">
            <a
              href="/poc/upload"
              className="rounded border border-[var(--color-border)] bg-[var(--color-panel)] p-3 hover:border-[var(--color-accent)]"
            >
              <div className="font-mono text-xs text-[var(--color-accent)]">/poc/upload</div>
              <div className="mt-1 text-sm">puppet 드롭 → 라이브러리 저장</div>
            </a>
            <a
              href="/poc/library"
              className="rounded border border-[var(--color-border)] bg-[var(--color-panel)] p-3 hover:border-[var(--color-accent)]"
            >
              <div className="font-mono text-xs text-[var(--color-accent)]">/poc/library</div>
              <div className="mt-1 text-sm">저장된 puppet 목록</div>
            </a>
            <a
              href="/poc/dual"
              className="rounded border border-[var(--color-border)] bg-[var(--color-panel)] p-3 hover:border-[var(--color-accent)]"
            >
              <div className="font-mono text-xs text-[var(--color-accent)]">/poc/dual</div>
              <div className="mt-1 text-sm">두 런타임 동시 마운트 검증</div>
            </a>
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
              href="/poc/sam-debug"
              className="rounded border border-[var(--color-border)] bg-[var(--color-panel)] p-3 hover:border-[var(--color-accent)]"
            >
              <div className="font-mono text-xs text-[var(--color-accent)]">/poc/sam-debug</div>
              <div className="mt-1 text-sm">SAM 점→마스크 단독 호출</div>
            </a>
          </div>
          <p className="mt-4 text-xs text-[var(--color-fg-dim)]">
            본 에디터는{" "}
            <code className="rounded bg-[var(--color-panel)] px-1.5 py-0.5 font-mono">
              /edit/[avatarId]
            </code>
            . 라이브러리 카드를 클릭하거나 위 built-in 샘플로 진입할 수 있습니다.
          </p>
        </section>

        <p className="mt-16 border-t border-[var(--color-border)] pt-6 text-xs text-[var(--color-fg-dim)]">
          설계 문서는{" "}
          <code className="rounded bg-[var(--color-panel)] px-1.5 py-0.5 font-mono">docs/</code> —
          analysis, plan, progress
        </p>
      </main>
      <AttributionFooter />
    </>
  );
}
