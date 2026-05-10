import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "geny-avatar",
  description:
    "Web-based 2D Live Avatar editor with AI-driven texture generation. Solo hobby project.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="h-full">
        {/* Live2D Cubism Core — closed binary from vendor/, synced into
            public/runtime/ at predev/prebuild. Loaded as a global script
            because untitled-pixi-live2d-engine reads it from window.
            7.6 perf: was beforeInteractive (blocks first paint). Switched
            to afterInteractive so the editor's first paint isn't gated
            on a global that only Cubism puppets actually need. The
            Live2DAdapter still polls window.Live2DCubismCore (5s timeout)
            before failing — afterInteractive guarantees the download
            starts right after the page becomes interactive, well within
            that window even on a built-in Hiyori auto-load. */}
        <Script src="/runtime/live2dcubismcore.min.js" strategy="afterInteractive" />
        {children}
      </body>
    </html>
  );
}
