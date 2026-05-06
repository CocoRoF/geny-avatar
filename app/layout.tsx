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
            because untitled-pixi-live2d-engine reads it from window. */}
        <Script src="/runtime/live2dcubismcore.min.js" strategy="beforeInteractive" />
        {children}
      </body>
    </html>
  );
}
