import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';

// NOTE: no mocks here on purpose — the error branch of the callback runs
// before any session/DB/provider call, so the REAL oauthPopupResponse sink
// executes and these tests prove the exploit chain is closed end to end.
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
    // \u003c-escaped: decodable by the popup, not executable by the parser
    expect(html).toContain('access_denied');
    expect(html).toContain('youtube-oauth-error');
  });
});
