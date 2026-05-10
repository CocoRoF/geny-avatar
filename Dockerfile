# syntax=docker/dockerfile:1.6
#
# geny-avatar — production image
#
# Multi-stage build that produces a small Node 20 alpine runner image
# containing only the Next.js standalone server, public assets, and the
# app's compiled output. pnpm is brought in via corepack so the version
# matches package.json's `packageManager` field exactly.
#
# Build context is the geny-avatar repo root. The `vendor/` submodule is
# expected to be checked out (e.g. via `git submodule update --init
# --recursive` on the host). If it's missing, scripts/sync-vendor.mjs
# emits warnings but the build succeeds — the Cubism sample route just
# won't have its bundled assets at runtime.

# ── Stage 1: deps ────────────────────────────────────────────────────
# Resolve and download dependencies once. Cached as long as
# package.json + pnpm-lock.yaml don't change.
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ── Stage 2: builder ─────────────────────────────────────────────────
# Run prebuild (vendor sync) + next build. Produces .next/standalone +
# .next/static which the runner stage copies out.
#
# NEXT_PUBLIC_BASE_PATH and NEXT_PUBLIC_GENY_HOST are inlined into the
# JS bundle by `next build`, so they MUST be present as ENV before the
# build runs — setting them only on the runner stage is too late. Pass
# via `docker build --build-arg` (or compose's `build.args`) when an
# integration deployment needs a non-default value.
FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_BASE_PATH=""
ARG NEXT_PUBLIC_GENY_HOST=""
ENV NEXT_PUBLIC_BASE_PATH=${NEXT_PUBLIC_BASE_PATH}
ENV NEXT_PUBLIC_GENY_HOST=${NEXT_PUBLIC_GENY_HOST}
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ── Stage 3: runner ──────────────────────────────────────────────────
# Minimal image: just Node 22 + the standalone bundle. Listens on PORT
# (default 3000) on all interfaces.
#
# Why Node 22 and not 20: Pixi.js v8 reads `globalThis.navigator` at
# module init for feature detection. `navigator` was added to Node's
# global scope in v21 — Node 20 lacks it, so SSR / static prerender of
# any page that pulls Pixi (e.g. /poc/spine) crashes with
# "ReferenceError: navigator is not defined". Node 22 LTS is the
# minimum that ships globalThis.navigator out of the box.
#
# Why we run as root and not nextjs:1001: The /api/send-to-geny route
# writes baked zips to a docker named volume mounted at /exports.
# Docker creates fresh named volumes with root:root ownership, so a
# UID-1001 process can't write into them; the resulting EACCES blocks
# the entire integration. Adding an init container or su-exec
# entrypoint just to chown one directory is more moving parts than
# it's worth for a single-tenant hobby deployment, so we accept the
# small security trade-off and run as root. The container exposes no
# shell or arbitrary-input surface, so blast radius is minimal.
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
