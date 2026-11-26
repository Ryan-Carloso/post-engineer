// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SITE_URL } from '@/lib/seo';
import { VIDEO_TYPES, computeVideoTokens, type FaceQuality } from '@/lib/tokens';
import HelpPage from '../page';
import HelpSlugPage, { generateMetadata, generateStaticParams } from '../[slug]/page';
import EnHelpPage from '../../en/help/page';
import EnHelpSlugPage, {
  generateMetadata as generateEnMetadata,
  generateStaticParams as generateEnStaticParams,
} from '../../en/help/[slug]/page';

function tableRows(markup: string): string[][] {
  const rows = [...markup.matchAll(/<tr[^>]*>(.*?)<\/tr>/gs)].map((match) => match[1]);
  return rows
    .map((row) =>
      [...row.matchAll(/<t[dh][^>]*>(.*?)<\/t[dh]>/gs)].map((cell) =>
        cell[1].replace(/<[^>]+>/g, ''),
      ),
    )
    .filter((cells) => cells[0] !== 'Video type');
}

describe('app/help — bilingual help pages from one content model', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', () => {
      throw new Error('fetch must not run during help render');
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the pt index with its title and locale links', () => {
    const markup = renderToStaticMarkup(<HelpPage />);
    expect(markup).toContain('Ajuda');
    expect(markup).toContain('href="/help/tokens"');
    expect(markup).toContain('href="/help/primeiros-passos"');
  });

  it('renders the en index with its title and locale links', () => {
    const markup = renderToStaticMarkup(<EnHelpPage />);
    expect(markup).toContain('Help');
    expect(markup).toContain('href="/en/help/tokens"');
    expect(markup).toContain('href="/en/help/primeiros-passos"');
  });

  it('renders the token table from computeVideoTokens in both locales', async () => {
    const expected: string[][] = [];
    for (const videoType of VIDEO_TYPES) {
      if (videoType === 'voiceover') {
        expected.push([videoType, 'any', String(computeVideoTokens(videoType, 'ok'))]);
        continue;
      }
      const qualities: FaceQuality[] = ['ok', 'very_good'];
      for (const quality of qualities) {
        expected.push([videoType, quality, String(computeVideoTokens(videoType, quality))]);
      }
    }
    const ptElement = await HelpSlugPage({ params: Promise.resolve({ slug: 'tokens' }) });
    expect(tableRows(renderToStaticMarkup(ptElement))).toEqual(expected);
    const enElement = await EnHelpSlugPage({ params: Promise.resolve({ slug: 'tokens' }) });
    expect(tableRows(renderToStaticMarkup(enElement))).toEqual(expected);
  });

  it('statically generates every help slug in both locales', () => {
    const slugs = [
      { slug: 'primeiros-passos' },
      { slug: 'tokens' },
      { slug: 'conectar-contas' },
    ];
    expect(generateStaticParams()).toEqual(slugs);
    expect(generateEnStaticParams()).toEqual(slugs);
  });

  it('returns self-canonicals and hreflang for the tokens page in both locales', async () => {
    const pt = await generateMetadata({ params: Promise.resolve({ slug: 'tokens' }) });
    const ptAlternates = pt.alternates as { canonical?: string; languages?: Record<string, string> };
    expect(ptAlternates.canonical).toBe(`${SITE_URL}/help/tokens`);
    expect(ptAlternates.languages).toEqual({
      'pt-BR': `${SITE_URL}/help/tokens`,
      en: `${SITE_URL}/en/help/tokens`,
    });
    const en = await generateEnMetadata({ params: Promise.resolve({ slug: 'tokens' }) });
    const enAlternates = en.alternates as { canonical?: string; languages?: Record<string, string> };
    expect(enAlternates.canonical).toBe(`${SITE_URL}/en/help/tokens`);
    expect(enAlternates.languages).toEqual({
      'pt-BR': `${SITE_URL}/help/tokens`,
      en: `${SITE_URL}/en/help/tokens`,
    });
  });

  it('calls notFound for an unknown slug in both locales', async () => {
    await expect(
      HelpSlugPage({ params: Promise.resolve({ slug: 'no-such-guide' }) }),
    ).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404');
    await expect(
      EnHelpSlugPage({ params: Promise.resolve({ slug: 'no-such-guide' }) }),
    ).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404');
  });
});
