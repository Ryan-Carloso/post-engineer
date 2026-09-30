import { describe, it, expect, vi, afterEach } from 'vitest';
import { GET } from '../route';

describe('GET /api/version', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the Vercel commit SHA when set', async () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abc123def');
    vi.stubEnv('APP_VERSION', '');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: 'abc123def' });
  });

  it('falls back to APP_VERSION without the Vercel SHA', async () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', '');
    vi.stubEnv('APP_VERSION', '1.4.0');
    const res = await GET();
    expect(await res.json()).toEqual({ version: '1.4.0' });
  });

  it('falls back to dev with no version env set', async () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', '');
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
