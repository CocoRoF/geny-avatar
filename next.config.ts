import type { NextConfig } from "next";

// Optional URL prefix for hosted-under-prefix deployments (e.g. nginx
// reverse-proxy that mounts geny-avatar at `/avatar-editor/`). Empty
// string means root-mounted. Single source of truth — both Next.js
// (basePath/assetPrefix at build) and our own client-side fetch
// helper (lib/basePath.ts) read this same env var.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Emit a self-contained `.next/standalone/` server bundle so the
  // production Docker image can run with just `node server.js` and
  // doesn't need the full node_modules tree at runtime. Drops the
  // image size by ~150MB and keeps cold-start fast.
  output: "standalone",
  // basePath/assetPrefix expect either a non-empty string starting
  // with "/" or `undefined`. Empty string is invalid → coerce.
  basePath: basePath || undefined,
  assetPrefix: basePath || undefined,
};

export default nextConfig;
