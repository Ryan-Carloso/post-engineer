import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import Providers from "./providers";
import WhatsAppFloatingButton from "@/components/ui/whatsapp-button";
import "./globals.css";

//---------------
// Fonts — next/font/google requires SWC; with coverage instrumentation
// (Babel + babel-plugin-istanbul) SWC is disabled. We use a system
// font stack as fallback when CYPRESS_COVERAGE=1.
//---------------

const geistSans = process.env.CYPRESS_COVERAGE === '1'
  ? { variable: '--font-geist-sans' }
  : (() => { try { const { Geist } = require('next/font/google'); return Geist({ variable: '--font-geist-sans', subsets: ['latin'] }); } catch { return { variable: '--font-geist-sans' }; } })();

const geistMono = process.env.CYPRESS_COVERAGE === '1'
  ? { variable: '--font-geist-mono' }
  : (() => { try { const { Geist_Mono } = require('next/font/google'); return Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] }); } catch { return { variable: '--font-geist-mono' }; } })();

export const metadata: Metadata = {
  title: "Post Engineer",
  description: "Publique vídeos no seu canal do YouTube",
  // Single icon source set in /public (no file-convention twins in app/:
  // once any config `icons` object exists, Next.js skips the file-convention
  // icons entirely — so every role must be declared here).
  icons: { icon: "/icon-128.png", apple: "/apple-icon.png" },
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
