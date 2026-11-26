import { DOC_PAGES, docLocales, docPath } from '@/lib/docs/registry';
import { GITHUB_URL, OG_IMAGE_PATH, SITE_URL } from './site-urls';

export { GITHUB_URL, OG_IMAGE_PATH, SITE_URL };

export const LEGAL_UPDATED_AT = '2026-11-26';

export const LANDING_TITLE =
  'Post Engineer — Vídeos com IA publicados automaticamente no YouTube e Instagram';

export const LANDING_DESCRIPTION =
  'Crie vídeos com IA usando personas e publique automaticamente no YouTube e Instagram, todos os dias, nos horários que escolher. Agendamento automático, com ou sem rosto.';

const STATIC_PAGES = ['/landing', '/recipes', '/privacy', '/terms'] as const;

export const PUBLIC_PAGES: readonly string[] = [
  ...STATIC_PAGES,
  ...DOC_PAGES.flatMap((page) => docLocales(page).map((locale) => docPath(page, locale))),
];

export function publicPageUrls(): string[] {
  return PUBLIC_PAGES.map((page) => `${SITE_URL}${page}`);
}

export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
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
