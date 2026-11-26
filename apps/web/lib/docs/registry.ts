import { docsIndex } from './content/docs-index';
import { mcpGuide } from './content/mcp';
import type { DocLocale, DocPage } from './types';

export const DOC_PAGES: DocPage[] = [docsIndex, mcpGuide];

export function findDocPage(section: DocPage['section'], slug: string | null): DocPage | undefined {
  return DOC_PAGES.find((page) => page.section === section && page.slug === slug);
}

export function docLocales(page: DocPage): DocLocale[] {
  return page.section === 'help' ? ['pt', 'en'] : ['en'];
}

export function docPath(page: DocPage, locale: DocLocale): string {
  const suffix = page.slug === null ? '' : `/${page.slug}`;
  if (page.section === 'docs') return `/docs${suffix}`;
  if (locale === 'en') return `/en/help${suffix}`;
  return `/help${suffix}`;
}
