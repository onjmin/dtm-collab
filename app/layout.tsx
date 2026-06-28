import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DTMコラボ",
  description: "PC・スマホ対応！ブラウザ上で他の人とリアルタイムに協力して作曲できるWebシーケンサー。",
  openGraph: {
    title: "DTMコラボ",
    description: "PC・スマホ対応！ブラウザ上で他の人とリアルタイムに協力して作曲できるWebシーケンサー。",
    type: "website",
    url: "https://onjmin.github.io/dtm-collab/",
  },
  twitter: {
    card: "summary_large_image",
  },
  icons: {
    icon: "https://avatars.githubusercontent.com/u/88383494",
  },
  other: {
    "google-site-verification": "umOJryZRtZeDsWC10CFmGjDOJy7SjkpL3DWlXblOnyE",
    "Cache-Control": "no-cache",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
