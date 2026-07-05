import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

const TITLE = "DTMコラボ - みんなでリアルタイム作曲Webシーケンサー";
const DESCRIPTION =
  "PC・スマホ対応、インストール不要！ブラウザだけで複数人がリアルタイムに同じ部屋で協力して作曲できる無料のWeb DTM・ピアノロールシーケンサー。ルーム作成・参加も簡単、MML中間言語でみんなの音を即座に同期。";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "DTM",
    "コラボ",
    "共同作業",
    "リアルタイム",
    "作曲",
    "ピアノロール",
    "シーケンサー",
    "無料",
    "ブラウザ",
    "スマホ",
    "PC",
    "MML",
    "Web Audio",
  ],
  alternates: {
    canonical: "https://onjmin.github.io/dtm-collab/",
  },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
    url: "https://onjmin.github.io/dtm-collab/",
    images: ["https://i.imgur.com/Q1er7sR.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["https://i.imgur.com/Q1er7sR.png"],
  },
  icons: {
    icon: "https://i.imgur.com/Q1er7sR.png",
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
    <html lang="ja" className="h-full">
      <head>
        <script
          type="application/ld+json"
          // biome-ignore lint: JSON-LD injection requires dangerouslySetInnerHTML
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "SoftwareApplication",
              name: "DTMコラボ",
              operatingSystem: "Windows, macOS, Linux, Android, iOS",
              applicationCategory: "MultimediaApplication",
              offers: {
                "@type": "Offer",
                price: "0",
                priceCurrency: "JPY",
              },
              description: DESCRIPTION,
              url: "https://onjmin.github.io/dtm-collab/",
            }),
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-M0KNK6K99N"
          strategy="afterInteractive"
        />
        <Script id="gtag-init" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-M0KNK6K99N');
          `}
        </Script>
        {children}
      </body>
    </html>
  );
}
