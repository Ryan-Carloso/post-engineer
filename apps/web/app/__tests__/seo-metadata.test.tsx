import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';

vi.mock('next/font/google', () => ({
  Geist: () => ({ variable: '--font-geist-sans', className: '' }),
  Geist_Mono: () => ({ variable: '--font-geist-mono', className: '' }),
}));

vi.mock('../providers', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="providers">{children}</div>
  ),
}));

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('../globals.css', () => ({}));

describe('root layout metadata — search and social', () => {
  it('sets metadataBase to the production domain so relative OG paths resolve', async () => {
    const { metadata } = await import('../layout');
    expect(metadata.metadataBase?.toString()).toBe('https://post-engineer.com/');
  });

  it('titles and describes the product for YouTube and Instagram, not YouTube alone', async () => {
    const { metadata } = await import('../layout');
    expect(metadata.title).toContain('YouTube');
    expect(metadata.title).toContain('Instagram');
    expect(metadata.description).toContain('YouTube');
    expect(metadata.description).toContain('Instagram');
  });

  it('declares Open Graph and Twitter cards with a real 1200x630 image', async () => {
    const { metadata } = await import('../layout');
    const openGraph = metadata.openGraph as {
      images?: Array<{ url: string; width: number; height: number }>;
    };
    const twitter = metadata.twitter as { images?: string[]; card?: string };
    expect(openGraph.images?.[0]).toMatchObject({
      url: '/og.png',
      width: 1200,
      height: 630,
    });
    expect(twitter.card).toBe('summary_large_image');
    expect(twitter.images).toContain('/og.png');
    const publicDir = join(findRepoRoot(import.meta.url), 'apps', 'web', 'public');
    expect(existsSync(join(publicDir, 'og.png'))).toBe(true);
  });
});

describe('landing layout metadata — canonical and FAQ structured data', () => {
  it('sets the landing canonical to /landing, not the redirecting root', async () => {
    const { metadata } = await import('../landing/layout');
    const alternates = metadata.alternates as { canonical?: string };
    expect(alternates.canonical).toBe('https://post-engineer.com/landing');
  });

  it('points Open Graph at the landing URL with the same social image', async () => {
    const { metadata } = await import('../landing/layout');
    const openGraph = metadata.openGraph as {
      url?: string;
      images?: Array<{ url: string }>;
    };
    expect(openGraph.url).toBe('https://post-engineer.com/landing');
    expect(openGraph.images?.[0]?.url).toBe('/og.png');
  });
});

describe('public/robots.txt — real sitemap, no placeholder', () => {
  it('points crawlers at the real sitemap and keeps the placeholder out', () => {
    const publicDir = join(findRepoRoot(import.meta.url), 'apps', 'web', 'public');
    const robots = readFileSync(join(publicDir, 'robots.txt'), 'utf8');
    expect(robots).toContain('Sitemap: https://post-engineer.com/sitemap.xml');
    expect(robots).not.toContain('your-domain.example');
  });
});
