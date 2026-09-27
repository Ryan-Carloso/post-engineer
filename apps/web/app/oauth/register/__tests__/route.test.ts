import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST } from '../route';

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));

import { createSupabaseServiceClient } from '@/lib/supabase/service';

function serviceClient(insertResult: { error: unknown }) {
  const insert = vi.fn().mockResolvedValue(insertResult);
  return { from: vi.fn().mockReturnValue({ insert }), __insert: insert };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('POST /oauth/register', () => {
  it('registers a public client and returns its id', async () => {
    const supabase = serviceClient({ error: null });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(
      supabase as unknown as ReturnType<typeof createSupabaseServiceClient>,
    );

    const request = new Request('https://post-engineer.com/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        redirect_uris: ['https://chatgpt.com/connector/callback'],
        client_name: 'ChatGPT',
      }),
    });
    const response = await POST(request);
    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, unknown>;
    expect(typeof body.client_id).toBe('string');
    expect((body.client_id as string).startsWith('mcp_client_')).toBe(true);
    expect(body.token_endpoint_auth_method).toBe('none');
    expect(supabase.__insert).toHaveBeenCalledOnce();
  });

  it('rejects invalid metadata and database failures', async () => {
    const bad = new Request('https://post-engineer.com/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['http://evil.example/cb'] }),
    });
    expect((await POST(bad)).status).toBe(400);

    const supabase = serviceClient({ error: new Error('db down') });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(
      supabase as unknown as ReturnType<typeof createSupabaseServiceClient>,
    );
    const request = new Request('https://post-engineer.com/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['https://chatgpt.com/connector/callback'] }),
    });
    expect((await POST(request)).status).toBe(500);
  });
});

describe('POST /oauth/register rate limiting', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.stubEnv('VERCEL', '1');
  });
  it('returns 429 after the oauthRegister profile limit is exhausted', async () => {
    const { RATE_LIMITS } = await import('@/lib/rate-limit');
    const headers = {
      'Content-Type': 'application/json',
      'x-vercel-forwarded-for': '10.250.0.2',
    };
    const url = 'https://post-engineer.com/oauth/register';
    for (let i = 0; i < RATE_LIMITS.oauthRegister.limit; i++) {
      const res = await POST(new Request(url, { method: 'POST', headers, body: '{}' }));
      expect(res.status).not.toBe(429);
    }
    const blocked = await POST(new Request(url, { method: 'POST', headers, body: '{}' }));
    expect(blocked.status).toBe(429);
  });
});
