import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/session-expiry', () => ({ notifyIfSessionExpired: vi.fn() }));

import { notifyIfSessionExpired } from '@/lib/session-expiry';
import { HttpStatusError } from '@/lib/errors';
import { createShareLink, fetchShareLinks, revokeShareLink } from '@/lib/share-links-client';

const ID = '33333333-3333-4333-8333-333333333333';

function respond(status: number, body: unknown): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })));
}

describe('share links client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(notifyIfSessionExpired).mockClear();
  });

  it('lists links from a valid response', async () => {
    const links = [{ id: ID, personaIds: null, createdAt: 'a', expiresAt: null, revokedAt: null, lastViewedAt: null }];
    respond(200, { success: true, links });
    await expect(fetchShareLinks()).resolves.toEqual(links);
  });

  it('throws an HTTP status error for a non-2xx list and reports an expired session', async () => {
    respond(401, {});
    await expect(fetchShareLinks()).rejects.toBeInstanceOf(HttpStatusError);
    expect(notifyIfSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('throws for a 200 whose body is not JSON', async () => {
    respond(200, '<html>proxy</html>');
    await expect(fetchShareLinks()).rejects.toBeInstanceOf(HttpStatusError);
  });

  it('throws for a 200 that does not match the contract', async () => {
    respond(200, { success: true, links: [{ id: 5 }] });
    await expect(fetchShareLinks()).rejects.toBeInstanceOf(HttpStatusError);
  });

  it('returns the generic failure for a 200 that is not a created link', async () => {
    respond(200, { success: true });
    await expect(createShareLink(null)).resolves.toEqual({ success: false, error: 'generic' });
  });

  it('returns the generic failure for a 200 with an HTML body', async () => {
    respond(200, '<html>proxy</html>');
    await expect(createShareLink(null)).resolves.toEqual({ success: false, error: 'generic' });
  });

  it('maps a 409 to the limit failure and anything else to generic', async () => {
    respond(409, { success: false });
    await expect(createShareLink(null)).resolves.toEqual({ success: false, error: 'limit' });
    respond(500, { success: false });
    await expect(createShareLink(null)).resolves.toEqual({ success: false, error: 'generic' });
  });

  it('maps a missing link on revoke to the generic failure', async () => {
    respond(404, { success: false });
    await expect(revokeShareLink(ID)).resolves.toEqual({ success: false, error: 'generic' });
  });

  it('reports an expired session on a mutation 401', async () => {
    respond(401, {});
    await createShareLink(null);
    expect(notifyIfSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('turns a thrown transport error into the generic failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));
    await expect(revokeShareLink(ID)).resolves.toEqual({ success: false, error: 'generic' });
  });

  it('sends the persona scope in the body and only that', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    await createShareLink(['p1']);
    await createShareLink(null);
    const bodies = fetchMock.mock.calls.map((call) => (call as unknown as [string, RequestInit])[1].body);
    expect(bodies).toEqual([JSON.stringify({ personaIds: ['p1'] }), '{}']);
  });

  it('encodes the id when revoking', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    await revokeShareLink('a/b');
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('/api/share-links/a%2Fb');
  });
});
