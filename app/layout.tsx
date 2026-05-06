import type { Metadata } from "next";
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
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
