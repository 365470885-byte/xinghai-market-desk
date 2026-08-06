import type { Metadata } from "next";
import { headers } from "next/headers";
import "@fontsource-variable/noto-sans-sc/wght.css";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const description = "更快速、更清晰的自选行情与资金流向研究桌面。";
  return {
    metadataBase: new URL(origin),
    title: "星辰大海 · 市场研究台",
    description,
    openGraph: {
      title: "星辰大海 · 市场研究台",
      description,
      type: "website",
      images: [{ url: `${origin}/og-light.png`, width: 1200, height: 630, alt: "星辰大海市场研究台" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "星辰大海 · 市场研究台",
      description,
      images: [`${origin}/og-light.png`],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
