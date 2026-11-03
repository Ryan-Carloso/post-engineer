//---------------
// SEO — single source of truth for public search metadata.
// The production domain is hardcoded on purpose: it already is in
// next.config.ts (CORS) and the login page (PROD_AUTH_CALLBACK), and
// a sitemap/canonical built from an env var would silently point at
// a preview deploy if the var were ever mis-set.
//---------------

export const SITE_URL = 'https://post-engineer.com';

export const OG_IMAGE_PATH = '/og.png';

export const LANDING_TITLE =
  'Post Engineer — Vídeos com IA publicados automaticamente no YouTube e Instagram';

export const LANDING_DESCRIPTION =
  'Crie vídeos com IA usando personas e publique automaticamente no YouTube e Instagram, todos os dias, nos horários que escolher. Agendamento automático, com ou sem rosto.';

// Top-level public pages only. Recipe detail slugs (/recipes/[slug])
// are discoverable through internal links from /recipes; adding them
// here would couple the sitemap to the prompts data module.
export const PUBLIC_PAGES = ['/landing', '/recipes', '/privacy', '/terms'] as const;

export function publicPageUrls(): string[] {
  return PUBLIC_PAGES.map((page) => `${SITE_URL}${page}`);
}

export interface FaqItem {
  question: string;
  answer: string;
}

export interface FaqJsonLd {
  '@context': 'https://schema.org';
  '@type': 'FAQPage';
  mainEntity: Array<{
    '@type': 'Question';
    name: string;
    acceptedAnswer: { '@type': 'Answer'; text: string };
  }>;
}

//---------------
// buildFaqJsonLd — FAQPage structured data, verbatim.
// The caller passes the exact strings the page renders, so the
// structured data can never drift from the visible FAQ.
//---------------
export function buildFaqJsonLd(items: readonly FaqItem[]): FaqJsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question' as const,
      name: item.question,
      acceptedAnswer: { '@type': 'Answer' as const, text: item.answer },
    })),
  };
}
