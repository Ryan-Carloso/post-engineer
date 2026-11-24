import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPersonaIdentityCard } from '../persona-identity-card-api';
import { HttpStatusError } from '../errors';
import { FIXTURE_CARD } from '@/test/identity-card-fixtures';

function stubFetch(response: Response): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async () => response);
  vi.stubGlobal('fetch', mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchPersonaIdentityCard', () => {
  it('reads the card through the owner-checked route', async () => {
    const mock = stubFetch(Response.json({ success: true, identityCard: FIXTURE_CARD }));
    await expect(fetchPersonaIdentityCard('p 1')).resolves.toEqual(FIXTURE_CARD);
    expect(mock).toHaveBeenCalledWith('/api/persona/identity-card?personaId=p%201');
  });

  it('returns null for a persona without a card', async () => {
    stubFetch(Response.json({ success: true, identityCard: null }));
    await expect(fetchPersonaIdentityCard('p1')).resolves.toBeNull();
  });

  it('throws a status error for a non-2xx answer', async () => {
    stubFetch(Response.json({ success: false, error: 'Persona not found.' }, { status: 404 }));
    const failure = await fetchPersonaIdentityCard('p1').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(HttpStatusError);
    expect((failure as HttpStatusError).status).toBe(404);
  });

  it('throws on a proxy HTML body and on an unexpected payload', async () => {
    stubFetch(new Response('<html>bad gateway</html>', { status: 200 }));
    await expect(fetchPersonaIdentityCard('p1')).rejects.toThrow('unexpected payload');
    stubFetch(Response.json({ success: true, identityCard: { version: 9 } }));
    await expect(fetchPersonaIdentityCard('p1')).rejects.toThrow('unexpected payload');
  });

  it('does not echo the server error text, which may be English', async () => {
    stubFetch(Response.json({ success: false, error: 'internal secret detail' }, { status: 500 }));
    const failure = await fetchPersonaIdentityCard('p1').catch((error: unknown) => error);
    expect(String((failure as Error).message)).not.toContain('secret');
  });
});
