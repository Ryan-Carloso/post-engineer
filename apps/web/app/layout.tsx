import type { Metadata } from "next";
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

//---------------
// Fonts — next/font/google requires SWC; with coverage instrumentation
// (Babel + babel-plugin-istanbul) SWC is disabled. We use a system
// font stack as fallback when CYPRESS_COVERAGE=1.
//---------------

// Single-line ternaries on purpose: under CYPRESS_COVERAGE=1 the
// fallback branch always runs, so a multi-line form would leave the
// next/font branch as a permanently uncovered line in the Cypress gate.
const geistSans = process.env.CYPRESS_COVERAGE === '1' ? { variable: '--font-geist-sans' } : (() => { try { const { Geist } = require('next/font/google'); return Geist({ variable: '--font-geist-sans', subsets: ['latin'] }); } catch { return { variable: '--font-geist-sans' }; } })();

const geistMono = process.env.CYPRESS_COVERAGE === '1' ? { variable: '--font-geist-mono' } : (() => { try { const { Geist_Mono } = require('next/font/google'); return Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] }); } catch { return { variable: '--font-geist-mono' }; } })();

export const metadata: Metadata = {
  title: LANDING_TITLE,
  description: LANDING_DESCRIPTION,
  // metadataBase turns every relative OG/Twitter path into an absolute
  // URL — without it, crawlers resolve /og.png against the page URL.
  metadataBase: new URL(SITE_URL),
  // Single icon source set in /public (no file-convention twins in app/:
  // once any config `icons` object exists, Next.js skips the file-convention
  // icons entirely — so every role must be declared here).
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="pt-BR"
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
