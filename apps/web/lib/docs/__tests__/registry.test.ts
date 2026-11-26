// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DOC_PAGES, docLocales, docPath, findDocPage } from '../registry';

describe('lib/docs/registry — one source for docs and help pages', () => {
  it('gives every page a unique path in every locale', () => {
    const paths = DOC_PAGES.flatMap((page) => docLocales(page).map((locale) => docPath(page, locale)));
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('keeps every path under /docs, /help or /en/help, never under /recipes', () => {
    for (const page of DOC_PAGES) {
      for (const locale of docLocales(page)) {
        const path = docPath(page, locale);
        expect(path.startsWith('/docs') || path.startsWith('/help') || path.startsWith('/en/help')).toBe(true);
        expect(path.startsWith('/recipes')).toBe(false);
      }
    }
  });

  it('resolves every registry page through findDocPage', () => {
    for (const page of DOC_PAGES) {
      expect(findDocPage(page.section, page.slug)).toBe(page);
    }
    expect(findDocPage('docs', 'no-such-guide')).toBeUndefined();
  });
});
