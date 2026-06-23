# geny-avatar

Web-based 2D Live Avatar editor with AI-driven texture generation. **A solo hobby project.**

> Drag-and-drop a puppet you grabbed off the internet (Cubism or Spine), tidy up its layers, repaint its textures with generative AI, and check the result instantly in a live preview.

## Two philosophies (locked in)

- **P1 — Cubism + Spine are both first-class** — neither is "secondary." Both adapters are built together from the start.
- **P2 — Upload Day-1** — uploading a file straight off the internet and using it is scenario #1 of the V1 demo. We accept Spine 3.8/4.0/4.1/4.2 + Cubism 4/5 (best-effort 2/3).

## Getting started (development)

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

## Key features

- **Dual runtime upload** — drop Spine 3.8/4.x `.skel` + atlas, or a Cubism 4/5 `.model3.json` + moc3 zip → stored in IndexedDB → live preview
- **Layer / Variant panel** — toggle visibility per slot/part, save and switch variants (skins)
- **Decompose Studio** — automatic alpha-component detection + brush masking + SAM auto-segmentation (define regions by hand in split mode)
- **AI texture generation** — gpt-image-2 multi-image edits API (per-region prompts in focus mode, attach reference images, per-region revert / history)
- **Animation tab** — preview a Cubism puppet's motions / expressions, live kScale·shift sliders, 8 GoEmotions × expression mapping, hit area → tap-motion mapping. Persisted in IndexedDB and bundled automatically on Geny export.
- **Export / Import** — `*.geny-avatar.zip` round-trip (avatar.json + bundle + overrides + LICENSE.md). A baked model zip carries its animation config in an `avatar-editor.json` sidecar (schemaVersion 2).
- **Help / Onboarding** — `?`-key shortcut modal + first-visit banner

## Stack

- Next.js 15 (App Router) + React 19 + TypeScript
- Pixi.js v8 (render engine)
- Spine runtime: `@esotericsoftware/spine-pixi-v8`
- Live2D runtime: `untitled-pixi-live2d-engine` + Cubism Core
- AI: OpenAI gpt-image-2 (`/v1/images/edits`), SAM (Replicate) for segmentation
- Persistence: Dexie (IndexedDB v9)
- Tailwind CSS v4 / Biome / pnpm 10

## Directory layout

```
geny-avatar/
├─ app/                        Next.js App Router
├─ public/                     static assets (samples, runtime static files)
├─ docs/                       design docs (analysis / plan / progress)
└─ ...
```

## Documentation

- [docs/README](docs/README.md) — the entry point
- [docs/analysis](docs/analysis/INDEX.md) — fact-gathering (formats, runtimes, AI, licensing, …)
- [docs/plan](docs/plan/INDEX.md) — decisions and rationale (north star, architecture, tech stack, roadmap, …)
- [docs/progress](docs/progress/INDEX.md) — chronological work log

## Current status

**Phase 7 — Polish & V1 Release** complete (Help modal · onboarding · localization · attribution · README · perf — all 6 sub-sprints). On top of that, the root UX is unified (upload + library + built-in samples on the single `/` page). V1 is demo-ready.

Next up: **Geny integration** (see the section below). geny-avatar slots in as one service of Geny's docker compose and ships baked puppets into Geny's VTuber library. This repo still supports standalone hobby use exactly as before.

For the full chronological record, see [`docs/progress/INDEX.md`](docs/progress/INDEX.md).

## Geny integration (optional)

[Geny](https://github.com/CocoRoF/Geny) pulls this repo in as a git submodule and runs it as the `avatar-editor` service of its own docker compose. nginx reverse-proxies it under the `/avatar-editor/` prefix, and baked models reach the Geny backend through a shared docker volume.

Environment variables this repo reads to make that flow work:

| Env var | Meaning | Standalone use |
|---|---|---|
| `NEXT_PUBLIC_BASE_PATH` | reverse-proxy prefix (e.g. `/avatar-editor`). Inlined at build time and prepended to every route, asset, and `apiUrl()` path. | Unset → root mount (same as current use) |
| `NEXT_PUBLIC_GENY_HOST` | `"true"` enables the "send to Geny" button on the ExportButton. | Unset → button hidden; calling `/api/send-to-geny` directly returns 503 |
| `GENY_BAKED_EXPORTS_DIR` | Directory where "send to Geny" writes baked zips. | Defaults to `/exports` (mounted by Geny's compose); irrelevant for standalone use |

Build / run:

```bash
# Standalone (unchanged)
pnpm dev

# Inside Geny's compose (Geny sets this up automatically)
NEXT_PUBLIC_BASE_PATH=/avatar-editor \
NEXT_PUBLIC_GENY_HOST=true \
GENY_BAKED_EXPORTS_DIR=/exports \
  pnpm build && node .next/standalone/server.js

# Docker (Geny's compose uses this repo's Dockerfile as the build context)
docker build -t geny-avatar:latest .
```

For the full integration architecture, data flow, and sprint breakdown, see [Geny's GENY_AVATAR_INTEGRATION.md](https://github.com/CocoRoF/Geny/blob/main/docs/plan/GENY_AVATAR_INTEGRATION.md).

## License

Own code: a private solo hobby project — no license granted (private).

### Third-party assets

This tool uses the external SDKs / models below. For commercial distribution you must separately obtain a license from each rights holder.

| Asset | Rights holder | License |
|---|---|---|
| [Spine Runtime v4](https://esotericsoftware.com/spine-runtimes-license) | Esoteric Software | Spine Runtimes License (requires a separate Spine SDK license) |
| [Live2D Cubism Core](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html) | Live2D Inc. | Live2D Proprietary Software License (EULA) — isolated under `vendor/` |
| [Pixi.js v8](https://github.com/pixijs/pixijs/blob/main/LICENSE) | PixiJS contributors | MIT |
| [OpenAI gpt-image-2](https://openai.com/policies/terms-of-use) | OpenAI | OpenAI API Terms of Use — requires your own API key |

The built-in sample puppets (Hiyori, spineboy) are each SDK's official samples, bundled for learning/development. For commercial use, follow the original distributor's license terms.

The `LICENSE.md` inside an exported `*.geny-avatar.zip` automatically records the origin / AI provenance at export time — keep it with the file when sharing externally.
