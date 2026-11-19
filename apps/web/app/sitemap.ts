import type { MetadataRoute } from 'next';
import { PUBLIC_PAGES, SITE_URL } from '@/lib/seo';

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PAGES.map((page) => ({
    url: `${SITE_URL}${page}`,
    lastModified: new Date(),
    changeFrequency: page === '/landing' ? 'weekly' : 'monthly',
    priority: page === '/landing' ? 1 : 0.5,
  }));
}
