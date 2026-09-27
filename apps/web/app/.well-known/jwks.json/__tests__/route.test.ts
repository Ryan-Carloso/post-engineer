import { describe, it, expect, vi } from 'vitest';
import { GET } from '../route';

vi.mock('@/lib/oauth/keys', () => ({
  getOAuthKeys: vi.fn().mockResolvedValue({
    kid: 'test-kid',
    publicJwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y', kid: 'test-kid' },
  }),
}));

describe('GET /.well-known/jwks.json', () => {
  it('publishes the signing public key', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      keys: [{ kty: 'EC', crv: 'P-256', x: 'x', y: 'y', kid: 'test-kid' }],
    });
  });

  it('returns a generic 500 when key loading fails (no internal details leaked)', async () => {
    const { getOAuthKeys } = await import('@/lib/oauth/keys');
    vi.mocked(getOAuthKeys).mockRejectedValueOnce(new Error('secret key material: bad PEM at /run/keys/x'));
    const response = await GET();
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('Failed to load signing keys.');
    expect(body.error).not.toContain('PEM');
  });
});
