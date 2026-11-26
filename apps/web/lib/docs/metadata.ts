import type { Metadata } from 'next';
import { OG_IMAGE_PATH, SITE_URL } from '@/lib/seo';
import { docPath } from './registry';
import { localize, type DocLocale, type DocPage } from './types';

export function buildDocMetadata(page: DocPage, locale: DocLocale): Metadata {
  const title = localize(page.title, locale);
  const description = localize(page.description, locale);
  const url = `${SITE_URL}${docPath(page, locale)}`;
  const fullTitle = `${title} — Post Engineer`;
  return {
    title: fullTitle,
    description,
    alternates: {
      canonical: url,
      languages:
        page.section === 'help'
          ? {
            'pt-BR': `${SITE_URL}${docPath(page, 'pt')}`,
            en: `${SITE_URL}${docPath(page, 'en')}`,
          }
          : undefined,
    },
    openGraph: {
      title: fullTitle,
      description,
      url,
      siteName: 'Post Engineer',
      locale: locale === 'pt' ? 'pt_BR' : 'en_US',
      type: 'article',
      images: [
        {
          url: OG_IMAGE_PATH,
          width: 1200,
          height: 630,
          alt: fullTitle,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description,
      images: [OG_IMAGE_PATH],
    },
  };
}
