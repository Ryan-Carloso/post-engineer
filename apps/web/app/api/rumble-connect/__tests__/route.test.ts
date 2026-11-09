// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));

vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(),
}));

vi.mock('@/lib/token-crypto', () => ({
  // non-reversible mock: hides the content like the real cipher would
  encryptTokens: vi.fn(
    (payload: Record<string, unknown>) => `v1.mockcipher.${Buffer.from(JSON.stringify(payload)).toString('base64')}`,
  ),
  decryptTokens: vi.fn(),
}));

// The limiter has its own suite (rate-limit.test.ts); here it never throttles.
vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rate-limit')>();
  return { ...actual, applyRateLimit: vi.fn().mockResolvedValue(null) };
});

import { POST } from '@/app/api/rumble-connect/route';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { encryptTokens } from '@/lib/token-crypto';
import { applyRateLimit } from '@/lib/rate-limit';
import { NextResponse } from 'next/server';

const USER_ID = 'user-uuid-1';
const TOKEN = 'a'.repeat(40);

function mockSupabase(overrides: { user?: { id: string } | null; insertError?: unknown; isApiKey?: boolean } = {}) {
  const inserted: Array<Record<string, unknown>> = [];
  const selectMock = vi.fn(() => ({
    single: vi.fn(async () => ({
      data: { id: 'row-1', ...inserted[inserted.length - 1] },
      error: overrides.insertError ?? null,
    })),
  }));
  const client = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: overrides.user === null ? null : { id: USER_ID } },
        error: null,
      })),
    },
    from: vi.fn((table: string) => {
      if (table === 'social_accounts') {
        return {
          insert: vi.fn((values: Record<string, unknown>) => {
            inserted.push(values);
            return {
              select: selectMock,
            };
          }),
        };
      }
      return {};
    }),
  };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
  vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
  vi.mocked(requireSupabaseSession).mockResolvedValue(
    (overrides.user === null
      ? { auth: null, error: null }
      : {
        auth: {
          userId: USER_ID,
          accessToken: 'test-key',
          isApiKey: overrides.isApiKey === true,
        },
        error: null,
      }) as never
  );
  return { inserted, selectMock };
}

function formRequest(fields: Record<string, string>): Request {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value);
  }
  return new Request('http://localhost/api/rumble-connect', { method: 'POST', body: formData });
}

function jsonRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/rumble-connect', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', authorization: 'Bearer test-key' },
  });
}

describe('POST /api/rumble-connect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 without session and names the missing auth', async () => {
    mockSupabase({ user: null });
    const res = await POST(formRequest({ channelId: 'chan-1', accessToken: TOKEN }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ success: false, error: 'Authentication required.' });
  });

  it('returns 400 without channelId or accessToken and names the missing field', async () => {
    mockSupabase();
    const noChannel = await POST(formRequest({ accessToken: TOKEN }));
    expect(noChannel.status).toBe(400);
    expect(await noChannel.json()).toMatchObject({ success: false, error: 'Rumble channel ID is required.' });
    const noToken = await POST(formRequest({ channelId: 'chan-1' }));
    expect(noToken.status).toBe(400);
    expect(await noToken.json()).toMatchObject({ success: false, error: 'Rumble access token is required.' });
  });

  it('returns 400 for a null or array JSON body instead of crashing', async () => {
    mockSupabase();
    const rawJson = (raw: string) => new Request('http://localhost/api/rumble-connect', {
      method: 'POST',
      body: raw,
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-key' },
    });
    const nullBody = await POST(rawJson('null'));
    expect(nullBody.status).toBe(400);
    expect(await nullBody.json()).toMatchObject({ success: false, error: 'Invalid JSON payload.' });
    const arrayBody = await POST(rawJson('[]'));
    expect(arrayBody.status).toBe(400);
    expect(await arrayBody.json()).toMatchObject({ success: false, error: 'Invalid JSON payload.' });
  });

  it('returns 400 for a non-string or blank channelId/token in JSON and saves nothing', async () => {
    const { inserted } = mockSupabase();
    const nonString = await POST(jsonRequest({ channelId: 123, accessToken: TOKEN }));
    expect(nonString.status).toBe(400);
    expect(await nonString.json()).toMatchObject({ success: false, error: 'Rumble channel ID is required.' });
    const blankChannel = await POST(jsonRequest({ channelId: '   ', accessToken: TOKEN }));
    expect(blankChannel.status).toBe(400);
    expect(await blankChannel.json()).toMatchObject({ success: false, error: 'Rumble channel ID is required.' });
    const blankToken = await POST(jsonRequest({ channelId: 'chan-1', accessToken: '   ' }));
    expect(blankToken.status).toBe(400);
    expect(await blankToken.json()).toMatchObject({ success: false, error: 'Rumble access token is required.' });
    expect(inserted).toHaveLength(0);
  });

  it('returns 400 for a blank channelId in FormData', async () => {
    mockSupabase();
    const res = await POST(formRequest({ channelId: '   ', accessToken: TOKEN }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false, error: 'Rumble channel ID is required.' });
  });

  it('trims padded channelId and accessToken before saving (JSON and FormData)', async () => {
    const { inserted } = mockSupabase();
    const jsonRes = await POST(jsonRequest({ channelId: '  chan-1  ', accessToken: `  ${TOKEN}  ` }));
    expect(jsonRes.status).toBe(200);
    expect(inserted[0]).toMatchObject({ provider_account_id: 'chan-1', account_name: 'chan-1' });
    expect(encryptTokens).toHaveBeenCalledWith(
      expect.objectContaining({ access_token: TOKEN, channel_id: 'chan-1' }),
    );

    const formRes = await POST(formRequest({ channelId: '  chan-2  ', accessToken: TOKEN }));
    expect(formRes.status).toBe(200);
    expect(inserted[1]).toMatchObject({ provider_account_id: 'chan-2', account_name: 'chan-2' });
  });

  it('returns 400 for a malformed token (wrong length or non-hex) and saves nothing', async () => {
    mockSupabase();
    const short = await POST(formRequest({ channelId: 'chan-1', accessToken: 'a'.repeat(39) }));
    expect(short.status).toBe(400);
    expect(await short.json()).toMatchObject({
      success: false,
      error: 'Rumble access token must be the 40-character token issued by Rumble (email bd@rumble.com).',
    });
    const nonHex = await POST(formRequest({ channelId: 'chan-1', accessToken: 'g'.repeat(40) }));
    expect(nonHex.status).toBe(400);
    expect(vi.mocked(createSupabaseServerClient)).not.toHaveBeenCalled();
  });

  it('connects: encrypts the token and saves social_accounts with the channel id', async () => {
    const { inserted } = mockSupabase();

    const res = await POST(formRequest({ channelId: 'chan-1', accessToken: TOKEN }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; accountId: string; channelId: string };
    expect(body).toEqual({ success: true, accountId: 'row-1', channelId: 'chan-1' });

    // encrypted token, never in plaintext
    expect(encryptTokens).toHaveBeenCalledWith(
      expect.objectContaining({ access_token: TOKEN, token_type: 'rumble_access_token', channel_id: 'chan-1' }),
    );
    const blob = inserted[0]?.encrypted_tokens;
    expect(typeof blob).toBe('string');
    expect(String(blob)).not.toContain(TOKEN);

    expect(inserted[0]).toMatchObject({
      user_id: USER_ID,
      provider: 'rumble',
      provider_account_id: 'chan-1',
      account_name: 'chan-1',
      account_metadata: {},
    });
  });

  it('returns 500 when the insert fails and names the failure', async () => {
    mockSupabase({ insertError: { message: 'check violation' } });
    const res = await POST(formRequest({ channelId: 'chan-1', accessToken: TOKEN }));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ success: false, error: 'Could not save the Rumble account.' });
  });

  it('returns the rate-limit response instead of connecting', async () => {
    mockSupabase();
    vi.mocked(applyRateLimit).mockResolvedValueOnce(
      NextResponse.json({ success: false, error: 'Too many requests.' }, { status: 429 }),
    );
    const res = await POST(formRequest({ channelId: 'chan-1', accessToken: TOKEN }));
    expect(res.status).toBe(429);
    expect(vi.mocked(createSupabaseServerClient)).not.toHaveBeenCalled();
  });

  it('session flow uses the server client, not the service client, and selects the row id', async () => {
    const { selectMock } = mockSupabase();
    const res = await POST(formRequest({ channelId: 'chan-1', accessToken: TOKEN }));
    expect(res.status).toBe(200);
    expect(vi.mocked(createSupabaseServerClient)).toHaveBeenCalled();
    expect(vi.mocked(createSupabaseServiceClient)).not.toHaveBeenCalled();
    expect(selectMock).toHaveBeenCalledWith('id');
  });

  it('error message never contains the access token', async () => {
    mockSupabase({ user: null });
    const res = await POST(formRequest({ channelId: 'x', accessToken: TOKEN }));
    const body = (await res.json()) as { error?: string };
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it('MCP flow: API key + JSON connects and associates with the key owner', async () => {
    const { inserted } = mockSupabase({ isApiKey: true });

    const res = await POST(jsonRequest({ channelId: 'chan-1', accessToken: TOKEN }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; channelId: string };
    expect(body.success).toBe(true);
    expect(body.channelId).toBe('chan-1');

    expect(inserted[0]).toMatchObject({
      user_id: USER_ID,
      provider: 'rumble',
      provider_account_id: 'chan-1',
    });
    // via API key uses the service client
    expect(vi.mocked(createSupabaseServiceClient)).toHaveBeenCalled();
  });

  it('MCP flow: JSON without channelId/accessToken returns 400', async () => {
    mockSupabase({ isApiKey: true });
    const res = await POST(jsonRequest({ channelId: 'chan-1' }));
    expect(res.status).toBe(400);
  });
});
