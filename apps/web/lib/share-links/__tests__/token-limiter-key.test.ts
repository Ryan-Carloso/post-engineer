import { describe, expect, it, vi } from 'vitest';
import { fakeSupabase } from './fake-supabase';

const { applyRateLimit } = vi.hoisted(() => ({ applyRateLimit: vi.fn(async () => null) }));

vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
  applyRateLimit,
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { resolveSharedPage } from '../resolve-shared-page';
import { hashShareToken } from '../token';

describe('resolveSharedPage token limiter key', () => {
  it('keys the token limiter on a prefix of the token hash, never on the token', async () => {
    const token = 'b'.repeat(43);
    const fake = fakeSupabase({ results: { share_links: [{ data: null, error: null }] } });
    await resolveSharedPage(token, new Request('http://share.invalid/'), fake.client, new Date());
    const identifiers = applyRateLimit.mock.calls.map((call) => (call as unknown as [Request, unknown, string | undefined])[2]);
    expect(identifiers).toEqual([undefined, hashShareToken(token).slice(0, 16)]);
    expect(JSON.stringify(applyRateLimit.mock.calls)).not.toContain(token);
  });
});
