// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

// The Bot API calls are doubled; lib/__tests__/telegram.test.ts pins them.
vi.mock('@/lib/telegram', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/telegram')>()),
  getTelegramBot: vi.fn(),
  getTelegramChat: vi.fn(),
  assertBotCanPost: vi.fn(),
}));

import { NextResponse } from 'next/server';
import { POST } from '@/app/api/telegram-connect/route';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { encryptTokens } from '@/lib/token-crypto';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { TelegramError } from '@/lib/errors';
import { assertBotCanPost, getTelegramBot, getTelegramChat } from '@/lib/telegram';
import { TelegramConnectResponseSchema } from '@/lib/contracts/accounts';

const USER_ID = 'user-uuid-1';
const TOKEN = `123456789:${'A'.repeat(35)}`;

function mockSupabase(overrides: { user?: null; upsertError?: unknown } = {}) {
  const upserted: Array<Record<string, unknown>> = [];
  const upsertOptions: Array<unknown> = [];
  const client = {
    from: vi.fn((table: string) => {
      if (table !== 'social_accounts') return {};
      return {
        upsert: vi.fn((values: Record<string, unknown>, options?: unknown) => {
          upserted.push(values);
          upsertOptions.push(options);
          return {
            select: vi.fn(() => ({
              single: vi.fn(async () =>
                overrides.upsertError === undefined
                  ? { data: { id: 'row-1' }, error: null }
                  : { data: null, error: overrides.upsertError },
              ),
            })),
          };
        }),
      };
    }),
  };
  vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
  vi.mocked(requireSupabaseSession).mockResolvedValue(
    (overrides.user === null
      ? { auth: null, error: null }
      : { auth: { userId: USER_ID, accessToken: 'test-key', isApiKey: false, isOAuth: false }, error: null }) as never,
  );
  return { upserted, upsertOptions };
}

function formRequest(fields: Record<string, string>): Request {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.append(key, value);
  return new Request('http://localhost/api/telegram-connect', { method: 'POST', body: formData });
}

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/telegram-connect', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json', authorization: 'Bearer test-key' },
  });
}

function chat(chatType: 'channel' | 'group' | 'supergroup', username: string | null = 'news') {
  return { chatId: '-1001', chatType, title: 'News', username };
}

const VALID = { botToken: TOKEN, chatId: '@news', chatType: 'channel' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getTelegramBot).mockResolvedValue({ botId: 42, botUsername: 'pe_bot' });
  vi.mocked(getTelegramChat).mockResolvedValue(chat('channel'));
  vi.mocked(assertBotCanPost).mockResolvedValue(undefined);
});

describe('POST /api/telegram-connect', () => {
  it('is rate limited with its own bucket', async () => {
    mockSupabase();
    vi.mocked(applyRateLimit).mockResolvedValueOnce(NextResponse.json({ success: false }, { status: 429 }));
    const response = await POST(formRequest(VALID));
    expect(response.status).toBe(429);
    expect(applyRateLimit).toHaveBeenCalledWith(expect.any(Request), RATE_LIMITS.telegramConnect);
    expect(getTelegramBot).not.toHaveBeenCalled();
  });

  it('answers 401 without a session and never calls Telegram', async () => {
    mockSupabase({ user: null });
    const response = await POST(formRequest(VALID));
    expect(response.status).toBe(401);
    expect(getTelegramBot).not.toHaveBeenCalled();
  });

  it.each([
    ['missing token', { chatId: '@news', chatType: 'channel' }, 'bot token is required'],
    ['blank chat', { botToken: TOKEN, chatId: '   ', chatType: 'channel' }, 'chat ID or @username is required'],
    ['unknown kind', { botToken: TOKEN, chatId: '@news', chatType: 'supergroup' }, 'chatType must be channel or group'],
    ['malformed token', { botToken: 'not-a-token', chatId: '@news', chatType: 'channel' }, '@BotFather issued'],
  ])('answers 400 for a %s before calling Telegram', async (_name, fields, message) => {
    mockSupabase();
    const response = await POST(formRequest(fields));
    expect(response.status).toBe(400);
    expect(String((await response.json()).error)).toContain(message);
    expect(getTelegramBot).not.toHaveBeenCalled();
  });

  it('answers 400 for a JSON body that is not an object', async () => {
    mockSupabase();
    expect((await POST(jsonRequest('[1]'))).status).toBe(400);
    expect((await POST(jsonRequest('{not json'))).status).toBe(400);
  });

  it('saves a channel under its canonical chat id, with the proven kind and the encrypted token', async () => {
    const { upserted, upsertOptions } = mockSupabase();
    const response = await POST(formRequest({ ...VALID, botToken: `  ${TOKEN}  ` }));
    expect(response.status).toBe(200);
    const body = TelegramConnectResponseSchema.parse(await response.json());
    expect(body).toEqual({ success: true, accountId: 'row-1', chatId: '-1001', chatType: 'channel', title: 'News' });
    expect(getTelegramChat).toHaveBeenCalledWith(TOKEN, '@news');
    expect(assertBotCanPost).toHaveBeenCalledWith(TOKEN, chat('channel'), 42);
    expect(upserted[0]).toMatchObject({
      user_id: USER_ID,
      provider: 'telegram',
      provider_account_id: '-1001',
      account_name: 'News',
      account_metadata: { chatType: 'channel', username: 'news', botUsername: 'pe_bot' },
      needs_reconnect: false,
    });
    expect(upsertOptions[0]).toEqual({ onConflict: 'user_id,provider,provider_account_id' });
    expect(encryptTokens).toHaveBeenCalledWith({
      access_token: TOKEN,
      token_type: 'telegram_bot_token',
      bot_id: '42',
      bot_username: 'pe_bot',
    });
    expect(JSON.stringify(upserted[0])).not.toContain(TOKEN);
  });

  it.each(['group', 'supergroup'] as const)('accepts a %s when the user picked Group (JSON body, MCP)', async (chatType) => {
    const { upserted } = mockSupabase();
    vi.mocked(getTelegramChat).mockResolvedValue(chat(chatType, null));
    const response = await POST(jsonRequest({ botToken: TOKEN, chatId: '-1001', chatType: 'group' }));
    expect(response.status).toBe(200);
    expect(upserted[0].account_metadata).toEqual({ chatType, username: null, botUsername: 'pe_bot' });
  });

  it.each([
    ['channel', 'group', 'That chat is a group, not a channel.'],
    ['group', 'channel', 'That chat is a channel, not a group.'],
  ] as const)('refuses a %s pick for a real %s with TELEGRAM_CHAT_KIND_MISMATCH and saves nothing', async (picked, real, message) => {
    const { upserted } = mockSupabase();
    vi.mocked(getTelegramChat).mockResolvedValue(chat(real));
    const response = await POST(formRequest({ ...VALID, chatType: picked }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({ success: false, code: 'TELEGRAM_CHAT_KIND_MISMATCH' });
    expect(String(body.error)).toContain(message);
    expect(assertBotCanPost).not.toHaveBeenCalled();
    expect(upserted).toHaveLength(0);
  });

  it.each([
    ['invalid_token', 422, 'TELEGRAM_TOKEN_REJECTED'],
    ['chat_not_found', 404, 'TELEGRAM_CHAT_NOT_FOUND'],
    ['not_member', 403, 'TELEGRAM_BOT_NOT_MEMBER'],
    ['no_permission', 403, 'TELEGRAM_BOT_CANNOT_POST'],
  ] as const)('maps a Telegram %s to %i + %s and saves nothing', async (code, status, errorCode) => {
    const { upserted } = mockSupabase();
    vi.mocked(assertBotCanPost).mockRejectedValue(new TelegramError(code, 'TELEGRAM_API_ERROR: nope', 400));
    const response = await POST(formRequest(VALID));
    expect(response.status).toBe(status);
    const body = await response.json();
    expect(body).toMatchObject({ success: false, code: errorCode });
    expect(JSON.stringify(body)).not.toContain(TOKEN);
    expect(upserted).toHaveLength(0);
  });

  it('answers a logged 500 for a Telegram outage and saves nothing', async () => {
    const { upserted } = mockSupabase();
    vi.mocked(getTelegramBot).mockRejectedValue(new TelegramError('publish_failed', 'TELEGRAM_REQUEST_FAILED: timeout', 502));
    const response = await POST(formRequest(VALID));
    expect(response.status).toBe(500);
    expect(upserted).toHaveLength(0);
  });

  it('answers 500 when the account row cannot be saved', async () => {
    mockSupabase({ upsertError: { message: 'db down' } });
    const response = await POST(formRequest(VALID));
    expect(response.status).toBe(500);
    expect(String((await response.json()).error)).toContain('Could not save the Telegram account');
  });
});
