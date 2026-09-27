import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';

// No mocks: the error branch returns before any session/DB/provider call,
// so the REAL oauthPopupResponse sink executes end to end.
import { GET } from '@/app/api/instagram-auth/callback/route';

const adversarial = '</script><script>alert(1)</script>';

function makeRequest(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/instagram-auth/callback${query}`);
}

describe('/api/instagram-auth/callback XSS (real sink)', () => {
  it('does not reflect an unescaped </script> from ?error= / ?error_description=', async () => {
    const res = await GET(
      makeRequest(
        `?error=${encodeURIComponent(adversarial)}&error_description=${encodeURIComponent(adversarial)}`,
      ),
    );
    const html = await res.text();
    expect(html).not.toContain(adversarial);
    expect(html).not.toContain('</script><script>');
  });

  it('still delivers the error text to the popup payload', async () => {
    const res = await GET(makeRequest('?error=access_denied'));
    const html = await res.text();
    expect(html).toContain('access_denied');
    expect(html).toContain('instagram-oauth-error');
  });
});
