import { describe, it, expect } from 'vitest';
import {
  LANDING_DESCRIPTION,
  LANDING_TITLE,
  OG_IMAGE_PATH,
  PUBLIC_PAGES,
  SITE_URL,
  buildFaqJsonLd,
  publicPageUrls,
} from '@/lib/seo';

describe('lib/seo — public search metadata', () => {
  it('points at the production domain, never a placeholder', () => {
    expect(SITE_URL).toBe('https://post-engineer.com');
    expect(SITE_URL).not.toContain('example');
  });

  it('lists every top-level public page, and no auth-only page', () => {
    expect(PUBLIC_PAGES).toEqual(['/landing', '/recipes', '/privacy', '/terms']);
    expect(publicPageUrls()).toEqual([
      'https://post-engineer.com/landing',
      'https://post-engineer.com/recipes',
      'https://post-engineer.com/privacy',
      'https://post-engineer.com/terms',
    ]);
  });

  it('titles the landing for its real networks, not YouTube alone', () => {
    expect(LANDING_TITLE).toContain('YouTube');
    expect(LANDING_TITLE).toContain('Instagram');
    expect(LANDING_DESCRIPTION).toContain('YouTube');
    expect(LANDING_DESCRIPTION).toContain('Instagram');
  });

  it('uses a 1200x630 social image path under public/', () => {
    expect(OG_IMAGE_PATH).toBe('/og.png');
  });

  it('builds a valid FAQPage with one Question per item, verbatim', () => {
    const jsonLd = buildFaqJsonLd([
      { question: 'Do I need to appear?', answer: 'No.' },
      { question: 'Which platforms?', answer: 'YouTube and Instagram.' },
    ]);
    expect(jsonLd).toEqual({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'Do I need to appear?',
          acceptedAnswer: { '@type': 'Answer', text: 'No.' },
        },
        {
          '@type': 'Question',
          name: 'Which platforms?',
          acceptedAnswer: { '@type': 'Answer', text: 'YouTube and Instagram.' },
        },
      ],
    });
  });

  it('builds an empty FAQPage for zero items instead of crashing', () => {
    expect(buildFaqJsonLd([]).mainEntity).toEqual([]);
  });
});
