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
FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ── Stage 2: builder ─────────────────────────────────────────────────
# Run prebuild (vendor sync) + next build. Produces .next/standalone +
# .next/static which the runner stage copies out.
FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ── Stage 3: runner ──────────────────────────────────────────────────
# Minimal image: just Node 20 + the standalone bundle. Runs as a non-
# root user. Listens on PORT (default 3000) on all interfaces.
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001 -G nodejs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
