import type { MetadataRoute } from 'next';
import { PUBLIC_PAGES, SITE_URL } from '@/lib/seo';

//---------------
// sitemap — the only public pages, as absolute URLs.
// The root (/) is a redirect (unauthenticated -> /landing,
// authenticated -> dashboard home), so it must never appear here:
// listing it would hand crawlers a redirect as a canonical URL.
// Recipe detail slugs are intentionally absent (see lib/seo.ts).
//---------------
export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PAGES.map((page) => ({
    url: `${SITE_URL}${page}`,
    lastModified: new Date(),
    changeFrequency: page === '/landing' ? 'weekly' : 'monthly',
    priority: page === '/landing' ? 1 : 0.5,
  }));
}
