import { describe, it, expect } from 'vitest';
import sitemap from '../sitemap';

describe('app/sitemap — real sitemap, not the homepage', () => {
  it('lists every top-level public page as an absolute URL', () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toEqual([
      'https://post-engineer.com/landing',
      'https://post-engineer.com/recipes',
      'https://post-engineer.com/privacy',
      'https://post-engineer.com/terms',
    ]);
  });

  it('never lists auth-only or redirect pages', () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).not.toContain('https://post-engineer.com/');
    expect(urls).not.toContain('https://post-engineer.com/login');
    expect(urls.some((url) => url.includes('/api/'))).toBe(false);
  });

  it('ranks the landing above the legal pages', () => {
    const entries = sitemap();
    const landing = entries.find((entry) => entry.url.endsWith('/landing'));
    const privacy = entries.find((entry) => entry.url.endsWith('/privacy'));
    expect(landing?.priority).toBe(1);
    expect(privacy?.priority).toBeLessThan(1);
  });

  it('refreshes the landing weekly and the other pages monthly', () => {
    const entries = sitemap();
    const landing = entries.find((entry) => entry.url.endsWith('/landing'));
    expect(landing?.changeFrequency).toBe('weekly');
    for (const entry of entries.filter((e) => e.url !== landing?.url)) {
      expect(entry.changeFrequency).toBe('monthly');
    }
  });

  it('stamps every entry with a lastModified date', () => {
    for (const entry of sitemap()) {
      expect(entry.lastModified).toBeInstanceOf(Date);
    }
  });
});
