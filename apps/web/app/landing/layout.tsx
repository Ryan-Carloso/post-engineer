import type { Metadata } from 'next';
import { ptDictionary } from '@/lib/i18n/pt';
import {
  LANDING_DESCRIPTION,
  LANDING_TITLE,
  OG_IMAGE_PATH,
  SITE_URL,
  buildFaqJsonLd,
} from '@/lib/seo';

//---------------
// Landing metadata — the landing page itself is a client component,
// so it cannot export metadata. This server layout owns it instead:
// one canonical URL, social cards, and FAQ structured data.
// The JSON-LD mirrors the default-locale (pt) FAQ verbatim: the
// locale switcher is client-side, so crawlers only ever see pt here.
// The root (/) redirects to /landing for signed-out visitors, so
// /landing — not / — is the canonical public URL.
//---------------
export const metadata: Metadata = {
  title: LANDING_TITLE,
  description: LANDING_DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/landing` },
  openGraph: {
    title: LANDING_TITLE,
    description: LANDING_DESCRIPTION,
    url: `${SITE_URL}/landing`,
    siteName: 'Post Engineer',
    locale: 'pt_BR',
    type: 'website',
    images: [
      {
        url: OG_IMAGE_PATH,
        width: 1200,
        height: 630,
        alt: 'Post Engineer — vídeos com IA publicados automaticamente no YouTube e Instagram',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: LANDING_TITLE,
    description: LANDING_DESCRIPTION,
    images: [OG_IMAGE_PATH],
  },
};

// faq3 (cancel) was removed with the Starter plan: the product is still
// beta, so the structured data lists exactly the visible FAQ items.
const LANDING_FAQ = [
  { question: ptDictionary.landing.faq1Q, answer: ptDictionary.landing.faq1A },
  { question: ptDictionary.landing.faq2Q, answer: ptDictionary.landing.faq2A },
  { question: ptDictionary.landing.faq4Q, answer: ptDictionary.landing.faq4A },
];

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildFaqJsonLd(LANDING_FAQ)) }}
      />
    </>
  );
}
