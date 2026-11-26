import type { Metadata } from 'next';
import { ptDictionary } from '@/lib/i18n/pt';
import {
  LANDING_DESCRIPTION,
  LANDING_TITLE,
  OG_IMAGE_PATH,
  SITE_URL,
  buildFaqJsonLd,
  serializeJsonLd,
} from '@/lib/seo';

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
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(buildFaqJsonLd(LANDING_FAQ)) }}
      />
    </>
  );
}
