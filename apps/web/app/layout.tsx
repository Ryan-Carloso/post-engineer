import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import Providers from "./providers";
import WhatsAppFloatingButton from "@/components/ui/whatsapp-button";
import {
  LANDING_DESCRIPTION,
  LANDING_TITLE,
  OG_IMAGE_PATH,
  SITE_URL,
} from "@/lib/seo";
import "./globals.css";

const geistSans = process.env.CYPRESS_COVERAGE === '1' ? { variable: '--font-geist-sans' } : (() => { try { const { Geist } = require('next/font/google'); return Geist({ variable: '--font-geist-sans', subsets: ['latin'] }); } catch { return { variable: '--font-geist-sans' }; } })();

const geistMono = process.env.CYPRESS_COVERAGE === '1' ? { variable: '--font-geist-mono' } : (() => { try { const { Geist_Mono } = require('next/font/google'); return Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] }); } catch { return { variable: '--font-geist-mono' }; } })();

export const metadata: Metadata = {
  title: LANDING_TITLE,
  description: LANDING_DESCRIPTION,
  metadataBase: new URL(SITE_URL),
  icons: { icon: "/icon-128.png", apple: "/apple-icon.png" },
  openGraph: {
    title: LANDING_TITLE,
    description: LANDING_DESCRIPTION,
    url: SITE_URL,
    siteName: "Post Engineer",
    locale: "pt_BR",
    type: "website",
    images: [
      {
        url: OG_IMAGE_PATH,
        width: 1200,
        height: 630,
        alt: "Post Engineer — vídeos com IA publicados automaticamente no YouTube e Instagram",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: LANDING_TITLE,
    description: LANDING_DESCRIPTION,
    images: [OG_IMAGE_PATH],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f8fb" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1220" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-dvh flex-col">
        <Providers>
          {children}
          <WhatsAppFloatingButton />
        </Providers>
        <Analytics />
      </body>
    </html>
  );
}
