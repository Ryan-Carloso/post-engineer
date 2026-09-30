import { describe, it, expect, vi, afterEach } from 'vitest';
import { GET } from '../route';

describe('GET /api/version', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the baked APP_VERSION', async () => {
    vi.stubEnv('APP_VERSION', '1.5.0');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: '1.5.0' });
  });

  it('falls back to dev with no version set', async () => {
    vi.stubEnv('APP_VERSION', '');
    const res = await GET();
    expect(await res.json()).toEqual({ version: 'dev' });
  });

  it('requires no authentication', async () => {
    // GET takes no Request and never touches request-auth: no mock needed.
    const res = await GET();
    expect(res.status).toBe(200);
  });
});
