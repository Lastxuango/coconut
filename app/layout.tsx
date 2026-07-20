import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "我们的点滴记录",
  description: "一个用来保存照片、文字和恋爱回忆的私人纪念网页。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
