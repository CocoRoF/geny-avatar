type Attribution = {
  name: string;
  by: string;
  license: string;
  url?: string;
};

const ATTRIBUTIONS: Attribution[] = [
  {
    name: "Spine Runtime v4",
    by: "Esoteric Software",
    license: "Spine Runtimes License (별도 SDK 라이선스 보유 필요)",
    url: "https://esotericsoftware.com/spine-runtimes-license",
  },
  {
    name: "Live2D Cubism Core",
    by: "Live2D Inc.",
    license: "Live2D Proprietary Software License (EULA)",
    url: "https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html",
  },
  {
    name: "Pixi.js v8",
    by: "PixiJS contributors",
    license: "MIT",
    url: "https://github.com/pixijs/pixijs/blob/main/LICENSE",
  },
  {
    name: "OpenAI gpt-image-2",
    by: "OpenAI",
    license: "OpenAI API Terms of Use",
    url: "https://openai.com/policies/terms-of-use",
  },
];

/**
 * Compact third-party credits strip. Shown on landing + library where
 * users browse before launching the editor — the editor itself is a
 * canvas workspace and stays footer-free. License text is informational
 * for a hobby project; commercial deployment of Spine/Cubism requires
 * separate SDK licenses obtained directly from each vendor.
 */
export function AttributionFooter() {
  return (
    <footer className="border-t border-[var(--color-border)] bg-[var(--color-bg)] px-6 py-4 text-[10px] text-[var(--color-fg-dim)]">
      <div className="mb-1 font-mono uppercase tracking-widest">Third-party / 제3자 자산</div>
      <ul className="grid gap-1 sm:grid-cols-2">
        {ATTRIBUTIONS.map((a) => (
          <li key={a.name}>
            <span className="text-[var(--color-fg)]">{a.name}</span> · {a.by} · {a.license}
            {a.url && (
              <>
                {" · "}
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--color-accent)] underline"
                >
                  license
                </a>
              </>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-2">
        geny-avatar 는 1인 hobby 프로젝트. 자체 코드는 별도 라이선스 미부여 (private). 위 외부
        자산은 각 권리자 소유 — 상업적 배포 시 각 SDK 라이선스를 별도로 확보해야 합니다.
      </p>
    </footer>
  );
}
