import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SITE_URL } from '@/lib/seo';
import HelpPage from '../page';
import HelpSlugPage, { generateMetadata, generateStaticParams } from '../[slug]/page';
import EnHelpPage from '../../en/help/page';
import EnHelpSlugPage, {
  generateMetadata as generateEnMetadata,
  generateStaticParams as generateEnStaticParams,
} from '../../en/help/[slug]/page';

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
    expect(markup).toContain('href="/help/primeiros-passos"');
  });

  it('renders the en index with its title and locale links', () => {
    const markup = renderToStaticMarkup(<EnHelpPage />);
    expect(markup).toContain('Help');
    expect(markup).toContain('href="/en/help/primeiros-passos"');
  });

  it('renders the first steps guide in both locales', async () => {
    const ptElement = await HelpSlugPage({ params: Promise.resolve({ slug: 'primeiros-passos' }) });
    expect(renderToStaticMarkup(ptElement)).toContain('Primeiros passos');
    const enElement = await EnHelpSlugPage({ params: Promise.resolve({ slug: 'primeiros-passos' }) });
    expect(renderToStaticMarkup(enElement)).toContain('First steps');
  });

  it('statically generates every help slug in both locales', () => {
    const slugs = [
      { slug: 'primeiros-passos' },
      { slug: 'conectar-contas' },
    ];
    expect(generateStaticParams()).toEqual(slugs);
    expect(generateEnStaticParams()).toEqual(slugs);
  });

  it('returns self-canonicals and hreflang for the first steps page in both locales', async () => {
    const pt = await generateMetadata({ params: Promise.resolve({ slug: 'primeiros-passos' }) });
    const ptAlternates = pt.alternates as { canonical?: string; languages?: Record<string, string> };
    expect(ptAlternates.canonical).toBe(`${SITE_URL}/help/primeiros-passos`);
    expect(ptAlternates.languages).toEqual({
      'pt-BR': `${SITE_URL}/help/primeiros-passos`,
      en: `${SITE_URL}/en/help/primeiros-passos`,
    });
    const en = await generateEnMetadata({ params: Promise.resolve({ slug: 'primeiros-passos' }) });
    const enAlternates = en.alternates as { canonical?: string; languages?: Record<string, string> };
    expect(enAlternates.canonical).toBe(`${SITE_URL}/en/help/primeiros-passos`);
    expect(enAlternates.languages).toEqual({
      'pt-BR': `${SITE_URL}/help/primeiros-passos`,
      en: `${SITE_URL}/en/help/primeiros-passos`,
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
