// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SITE_URL } from '@/lib/seo';
import DocsPage from '../page';
import DocSlugPage, { generateMetadata, generateStaticParams } from '../[slug]/page';

describe('app/docs — server-rendered docs pages', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', () => {
      throw new Error('fetch must not run during docs render');
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the docs index with its title and a link to /docs/mcp', () => {
    const markup = renderToStaticMarkup(<DocsPage />);
    expect(markup).toContain('Documentation');
    expect(markup).toContain('href="/docs/mcp"');
  });

  it('renders the mcp guide with its title and its tool list', async () => {
    const element = await DocSlugPage({ params: Promise.resolve({ slug: 'mcp' }) });
    const markup = renderToStaticMarkup(element);
    expect(markup).toContain('MCP server');
    expect(markup).toContain('publish_video');
  });

  it('statically generates every docs slug', () => {
    expect(generateStaticParams()).toEqual([
      { slug: 'mcp' },
      { slug: 'api' },
      { slug: 'use-cases' },
      { slug: 'integrations' },
    ]);
  });

  it('returns the mcp canonical from generateMetadata', async () => {
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: 'mcp' }) });
    const alternates = metadata.alternates as { canonical?: string };
    expect(alternates.canonical).toBe(`${SITE_URL}/docs/mcp`);
  });

  it('calls notFound for an unknown slug', async () => {
    await expect(DocSlugPage({ params: Promise.resolve({ slug: 'no-such-guide' }) })).rejects.toThrow(
      'NEXT_HTTP_ERROR_FALLBACK;404',
    );
  });
});
