import type { MetadataRoute } from 'next';
import { DOC_PAGES, docLocales, docPath } from '@/lib/docs/registry';
import { LEGAL_UPDATED_AT, PUBLIC_PAGES, SITE_URL } from '@/lib/seo';

const LEGAL_PAGES = ['/privacy', '/terms'];

export default function sitemap(): MetadataRoute.Sitemap {
  const docUpdatedAt = new Map(
    DOC_PAGES.flatMap((page) =>
      docLocales(page).map((locale) => [docPath(page, locale), page.updatedAt] as const),
    ),
  );
  return PUBLIC_PAGES.map((page) => {
    const entry: MetadataRoute.Sitemap[number] = {
      url: `${SITE_URL}${page}`,
      changeFrequency: page === '/landing' ? 'weekly' : 'monthly',
      priority: page === '/landing' ? 1 : docUpdatedAt.has(page) ? 0.7 : 0.5,
    };
    const updatedAt = docUpdatedAt.get(page);
    if (updatedAt !== undefined) entry.lastModified = new Date(updatedAt);
    else if (LEGAL_PAGES.includes(page)) entry.lastModified = new Date(LEGAL_UPDATED_AT);
    return entry;
  });
}
