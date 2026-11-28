import { describe, expect, it } from 'vitest';
import { LANDING_TITLE, SITE_URL } from '@/lib/seo';
import { buildDocMetadata } from '../metadata';
import { DOC_PAGES, docLocales, docPath } from '../registry';
import { localize } from '../types';

describe('lib/docs/metadata — one metadata object per page and locale', () => {
  it('gives every page a self-canonical equal to its own URL', () => {
    for (const page of DOC_PAGES) {
      for (const locale of docLocales(page)) {
        const metadata = buildDocMetadata(page, locale);
        const alternates = metadata.alternates as { canonical?: string };
        expect(alternates.canonical).toBe(`${SITE_URL}${docPath(page, locale)}`);
      }
    }
  });

  it('keeps titles unique within each locale, and off the landing title', () => {
    for (const locale of ['pt', 'en'] as const) {
      const titles = DOC_PAGES.flatMap((page) =>
        docLocales(page).includes(locale) ? [localize(page.title, locale)] : [],
      );
      expect(new Set(titles).size).toBe(titles.length);
    }
    const titles = DOC_PAGES.flatMap((page) =>
      docLocales(page).map((locale) => localize(page.title, locale)),
    );
    expect(titles).not.toContain(LANDING_TITLE);
  });

  it('keeps descriptions unique within each locale and between 50 and 160 chars', () => {
    for (const locale of ['pt', 'en'] as const) {
      const descriptions = DOC_PAGES.flatMap((page) =>
        docLocales(page).includes(locale) ? [localize(page.description, locale)] : [],
      );
      expect(new Set(descriptions).size).toBe(descriptions.length);
      for (const description of descriptions) {
        expect(description.length).toBeGreaterThanOrEqual(50);
        expect(description.length).toBeLessThanOrEqual(160);
      }
    }
  });

  it('sets openGraph.url to the canonical on every page', () => {
    for (const page of DOC_PAGES) {
      for (const locale of docLocales(page)) {
        const metadata = buildDocMetadata(page, locale);
        const openGraph = metadata.openGraph as { url?: string };
        const alternates = metadata.alternates as { canonical?: string };
        expect(openGraph.url).toBe(alternates.canonical);
      }
    }
  });
});
