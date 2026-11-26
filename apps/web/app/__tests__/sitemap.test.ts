import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOC_PAGES, docLocales, docPath } from '@/lib/docs/registry';
import { LEGAL_UPDATED_AT } from '@/lib/seo';
import sitemap from '../sitemap';

describe('app/sitemap — real sitemap, not the homepage', () => {
  it('lists every top-level public page as an absolute URL', () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toEqual([
      'https://post-engineer.com/landing',
      'https://post-engineer.com/recipes',
      'https://post-engineer.com/privacy',
      'https://post-engineer.com/terms',
      'https://post-engineer.com/docs',
      'https://post-engineer.com/docs/mcp',
      'https://post-engineer.com/docs/api',
      'https://post-engineer.com/docs/use-cases',
      'https://post-engineer.com/docs/integrations',
      'https://post-engineer.com/help',
      'https://post-engineer.com/en/help',
      'https://post-engineer.com/help/primeiros-passos',
      'https://post-engineer.com/en/help/primeiros-passos',
      'https://post-engineer.com/help/conectar-contas',
      'https://post-engineer.com/en/help/conectar-contas',
    ]);
  });

  it('never lists auth-only or redirect pages', () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).not.toContain('https://post-engineer.com/');
    expect(urls).not.toContain('https://post-engineer.com/login');
    expect(urls.some((url) => url.includes('/api/'))).toBe(false);
  });

  it('never lists /s/, /recipes/<slug>, /login, /auth, /oauth, /mcp or /api', () => {
    const urls = sitemap().map((entry) => entry.url);
    for (const url of urls) {
      const path = new URL(url).pathname;
      expect(path.startsWith('/s/')).toBe(false);
      expect(path.startsWith('/recipes/')).toBe(false);
      expect(path).not.toBe('/login');
      expect(path.startsWith('/auth')).toBe(false);
      expect(path.startsWith('/oauth')).toBe(false);
      expect(path).not.toBe('/mcp');
      expect(path.startsWith('/api')).toBe(false);
    }
  });

  it('ranks the landing above the legal pages', () => {
    const entries = sitemap();
    const landing = entries.find((entry) => entry.url.endsWith('/landing'));
    const privacy = entries.find((entry) => entry.url.endsWith('/privacy'));
    expect(landing?.priority).toBe(1);
    expect(privacy?.priority).toBeLessThan(1);
  });

  it('ranks docs and help pages at 0.7', () => {
    const entries = sitemap();
    for (const page of DOC_PAGES) {
      for (const locale of docLocales(page)) {
        const url = `https://post-engineer.com${docPath(page, locale)}`;
        const entry = entries.find((candidate) => candidate.url === url);
        expect(entry?.priority, url).toBe(0.7);
      }
    }
  });

  it('refreshes the landing weekly and the other pages monthly', () => {
    const entries = sitemap();
    const landing = entries.find((entry) => entry.url.endsWith('/landing'));
    expect(landing?.changeFrequency).toBe('weekly');
    for (const entry of entries.filter((e) => e.url !== landing?.url)) {
      expect(entry.changeFrequency).toBe('monthly');
    }
  });

  it('stamps docs and help entries with their updatedAt, legal entries with the legal date', () => {
    const entries = sitemap();
    for (const page of DOC_PAGES) {
      for (const locale of docLocales(page)) {
        const url = `https://post-engineer.com${docPath(page, locale)}`;
        const entry = entries.find((candidate) => candidate.url === url);
        expect(entry?.lastModified, url).toEqual(new Date(page.updatedAt));
      }
    }
    for (const legal of ['/privacy', '/terms']) {
      const entry = entries.find((candidate) => candidate.url.endsWith(legal));
      expect(entry?.lastModified).toEqual(new Date(LEGAL_UPDATED_AT));
    }
  });

  it('omits lastModified on the landing and recipes', () => {
    const entries = sitemap();
    for (const page of ['/landing', '/recipes']) {
      const entry = entries.find((candidate) => candidate.url.endsWith(page));
      expect(entry?.lastModified).toBeUndefined();
    }
  });

  describe('under a far-future clock', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('never stamps a lastModified equal to now', () => {
      const now = new Date('2030-01-01T00:00:00.000Z');
      for (const entry of sitemap()) {
        expect(entry.lastModified).not.toEqual(now);
      }
    });
  });
});
