import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';

import { GET } from '@/app/api/google-oauth/callback/route';

const adversarial = '</script><script>alert(1)</script>';

function makeRequest(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/google-oauth/callback${query}`);
}

describe('/api/google-oauth/callback XSS (real sink)', () => {
  it('does not reflect an unescaped </script> from ?error=', async () => {
    const res = await GET(makeRequest(`?error=${encodeURIComponent(adversarial)}`));
    const html = await res.text();
    expect(html).not.toContain(adversarial);
    expect(html).not.toContain('</script><script>');
  });

  it('still delivers the error text to the popup payload', async () => {
    const res = await GET(makeRequest('?error=access_denied'));
    const html = await res.text();
    expect(html).toContain('access_denied');
    expect(html).toContain('youtube-oauth-error');
  });
});
