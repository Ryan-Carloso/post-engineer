import { describe, expect, it } from 'vitest';
import nextConfig from '../next.config';

describe('next.config redirects', () => {
  it('permanently redirects the old /api-keys page to the prompts hub', async () => {
    const { redirects: loadRedirects } = nextConfig;
    if (loadRedirects === undefined) throw new Error('next.config has no redirects()');
    const redirects = await loadRedirects();
    expect(redirects).toEqual([
      { source: '/api-keys', destination: '/recipes', permanent: true },
    ]);
  });
});
