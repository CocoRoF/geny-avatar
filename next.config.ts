import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Emit a self-contained `.next/standalone/` server bundle so the
  // production Docker image can run with just `node server.js` and
  // doesn't need the full node_modules tree at runtime. Drops the
  // image size by ~150MB and keeps cold-start fast.
  output: "standalone",
};

export default nextConfig;
