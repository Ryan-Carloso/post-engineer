// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TelegramError } from '@/lib/errors';
import {
  TELEGRAM_API_BASE,
  TELEGRAM_CAPTION_MAX_LENGTH,
  TELEGRAM_FILE_MAX_BYTES,
  assertBotCanPost,
  getTelegramBot,
  getTelegramChat,
  isValidTelegramBotToken,
  publishToTelegram,
  telegramPostUrl,
  type TelegramChatInfo,
} from '@/lib/telegram';

const TOKEN = `123456789:${'A'.repeat(35)}`;

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const fetchMock = vi.fn<(input: string, init: RequestInit) => Promise<Response>>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function caught(promise: Promise<unknown>): Promise<TelegramError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof TelegramError) return error;
    throw error;
  }
  throw new Error('expected a TelegramError');
}

const CHANNEL: TelegramChatInfo = { chatId: '-1001', chatType: 'channel', title: 'News', username: 'news' };
const GROUP: TelegramChatInfo = { chatId: '-1002', chatType: 'supergroup', title: 'Club', username: null };

describe('isValidTelegramBotToken', () => {
  it('accepts the @BotFather shape and trims surrounding space', () => {
    expect(isValidTelegramBotToken(TOKEN)).toBe(true);
    expect(isValidTelegramBotToken(`  ${TOKEN} `)).toBe(true);
  });

  it.each([
    ['no colon', 'A'.repeat(45)],
    ['short secret', `123456789:${'A'.repeat(34)}`],
    ['long secret', `123456789:${'A'.repeat(36)}`],
    ['non-numeric bot id', `abcdefghi:${'A'.repeat(35)}`],
    ['short bot id', `1234567:${'A'.repeat(35)}`],
    ['illegal character', `123456789:${'A'.repeat(34)}!`],
  ])('rejects %s', (_name, value) => {
    expect(isValidTelegramBotToken(value)).toBe(false);
  });
});

describe('getTelegramBot', () => {
  it('calls getMe on the bot URL and returns the identity', async () => {
    fetchMock.mockResolvedValue(reply({ ok: true, result: { id: 42, username: 'pe_bot' } }));
    expect(await getTelegramBot(TOKEN)).toEqual({ botId: 42, botUsername: 'pe_bot' });
    expect(fetchMock.mock.calls[0][0]).toBe(`${TELEGRAM_API_BASE}/bot${TOKEN}/getMe`);
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('maps a 401 to invalid_token and never echoes the token', async () => {
    fetchMock.mockResolvedValue(reply({ ok: false, error_code: 401, description: `Unauthorized ${TOKEN}` }, 401));
    const error = await caught(getTelegramBot(TOKEN));
    expect(error.code).toBe('invalid_token');
    expect(error.statusCode).toBe(401);
    expect(error.message).not.toContain(TOKEN);
    expect(error.message).toContain('[redacted]');
  });

  it('scrubs the token from a network failure (the URL carries it)', async () => {
    fetchMock.mockRejectedValue(new Error(`connect ECONNREFUSED ${TELEGRAM_API_BASE}/bot${TOKEN}/getMe`));
    const error = await caught(getTelegramBot(TOKEN));
    expect(error.code).toBe('publish_failed');
    expect(error.statusCode).toBe(502);
    expect(error.message).not.toContain(TOKEN);
  });

  it('treats a non-JSON body as a failure with the HTTP status', async () => {
    fetchMock.mockResolvedValue(new Response('<html>bad gateway</html>', { status: 502 }));
    const error = await caught(getTelegramBot(TOKEN));
    expect(error.statusCode).toBe(502);
    expect(error.message).toContain('status 502');
  });

  it('rejects an identity without a numeric id and a username', async () => {
    fetchMock.mockResolvedValue(reply({ ok: true, result: { id: '42' } }));
    expect((await caught(getTelegramBot(TOKEN))).message).toContain('invalid bot identity');
  });
});

describe('getTelegramChat', () => {
  it('returns the canonical numeric id, kind, title and username', async () => {
    fetchMock.mockResolvedValue(reply({ ok: true, result: { id: -1001, type: 'channel', title: 'News', username: 'news' } }));
    expect(await getTelegramChat(TOKEN, '@news')).toEqual(CHANNEL);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({ chat_id: '@news' });
  });

  it('falls back to the id for a missing title and null for a missing username', async () => {
    fetchMock.mockResolvedValue(reply({ ok: true, result: { id: -1002, type: 'supergroup', title: '' } }));
    expect(await getTelegramChat(TOKEN, '-1002')).toEqual({ chatId: '-1002', chatType: 'supergroup', title: '-1002', username: null });
  });

  it('refuses a private chat: only channels and groups are destinations', async () => {
    fetchMock.mockResolvedValue(reply({ ok: true, result: { id: 7, type: 'private' } }));
    const error = await caught(getTelegramChat(TOKEN, '7'));
    expect(error.code).toBe('chat_not_found');
  });

  it.each([
    ['Bad Request: chat not found', 400, 'chat_not_found'],
    ['Forbidden: bot is not a member of the channel chat', 403, 'not_member'],
    ['Forbidden: bot was kicked from the group chat', 403, 'not_member'],
    ['Bad Request: not enough rights to send videos', 400, 'no_permission'],
    ['Too Many Requests: retry after 5', 429, 'publish_failed'],
  ])('maps "%s" to its code', async (description, status, code) => {
    fetchMock.mockResolvedValue(reply({ ok: false, error_code: status, description }, status));
    const error = await caught(getTelegramChat(TOKEN, '-1'));
    expect(error.code).toBe(code);
    expect(error.statusCode).toBe(status);
  });
});

describe('assertBotCanPost', () => {
  function member(result: Record<string, unknown>): void {
    fetchMock.mockResolvedValue(reply({ ok: true, result }));
  }

  it('asks getChatMember for the bot in the chat', async () => {
    member({ status: 'administrator', can_post_messages: true });
    await assertBotCanPost(TOKEN, CHANNEL, 42);
    expect(fetchMock.mock.calls[0][0]).toBe(`${TELEGRAM_API_BASE}/bot${TOKEN}/getChatMember`);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({ chat_id: '-1001', user_id: 42 });
  });

  it('accepts a channel creator without the can_post flag', async () => {
    member({ status: 'creator' });
    await expect(assertBotCanPost(TOKEN, CHANNEL, 42)).resolves.toBeUndefined();
  });

  it('refuses a channel member that is not an administrator', async () => {
    member({ status: 'member' });
    const error = await caught(assertBotCanPost(TOKEN, CHANNEL, 42));
    expect(error.code).toBe('no_permission');
    expect(error.message).toContain('administrator');
  });

  it('refuses a channel administrator who cannot post', async () => {
    member({ status: 'administrator', can_post_messages: false });
    const error = await caught(assertBotCanPost(TOKEN, CHANNEL, 42));
    expect(error.code).toBe('no_permission');
    expect(error.message).toContain('cannot post');
  });

  it.each(['left', 'kicked'])('refuses a bot whose status is %s, in either kind', async (status) => {
    member({ status });
    expect((await caught(assertBotCanPost(TOKEN, CHANNEL, 42))).code).toBe('not_member');
    member({ status });
    expect((await caught(assertBotCanPost(TOKEN, GROUP, 42))).code).toBe('not_member');
  });

  it('accepts a plain group member: a group bot does not need admin rights', async () => {
    member({ status: 'member' });
    await expect(assertBotCanPost(TOKEN, GROUP, 42)).resolves.toBeUndefined();
  });

  it('refuses a restricted group member who cannot send, and accepts one who can', async () => {
    member({ status: 'restricted', can_send_messages: false });
    expect((await caught(assertBotCanPost(TOKEN, GROUP, 42))).code).toBe('no_permission');
    member({ status: 'restricted', can_send_messages: true });
    await expect(assertBotCanPost(TOKEN, GROUP, 42)).resolves.toBeUndefined();
  });
});

describe('publishToTelegram', () => {
  const file = new Blob([new Uint8Array([1, 2, 3])], { type: 'video/mp4' });

  it.each([
    ['video', 'sendVideo', 'video'],
    ['photo', 'sendPhoto', 'photo'],
    ['audio', 'sendAudio', 'audio'],
  ] as const)('sends a %s with %s in the %s field', async (kind, method, field) => {
    fetchMock.mockResolvedValue(reply({ ok: true, result: { message_id: 9, chat: { id: -1001 } } }));
    const result = await publishToTelegram({ botToken: TOKEN, chatId: '-1001', kind, file, filename: 'f', caption: 'hello' });
    expect(result).toEqual({ messageId: 9, chatId: '-1001' });
    expect(fetchMock.mock.calls[0][0]).toBe(`${TELEGRAM_API_BASE}/bot${TOKEN}/${method}`);
    const body = fetchMock.mock.calls[0][1].body;
    if (!(body instanceof FormData)) throw new Error('expected a multipart body');
    expect(body.get('chat_id')).toBe('-1001');
    expect(body.get(field)).toBeInstanceOf(Blob);
    expect(body.get('caption')).toBe('hello');
    expect(body.get('supports_streaming')).toBe(kind === 'video' ? 'true' : null);
  });

  it('omits an empty caption', async () => {
    fetchMock.mockResolvedValue(reply({ ok: true, result: { message_id: 9, chat: { id: -1001 } } }));
    await publishToTelegram({ botToken: TOKEN, chatId: '-1001', kind: 'video', file, filename: 'f', caption: '' });
    const body = fetchMock.mock.calls[0][1].body;
    if (!(body instanceof FormData)) throw new Error('expected a multipart body');
    expect(body.has('caption')).toBe(false);
  });

  it('rejects a caption over the limit and a file over 50MB before any request', async () => {
    const long = await caught(
      publishToTelegram({ botToken: TOKEN, chatId: '-1', kind: 'video', file, filename: 'f', caption: 'a'.repeat(TELEGRAM_CAPTION_MAX_LENGTH + 1) }),
    );
    expect(long.statusCode).toBe(400);
    const big = { size: TELEGRAM_FILE_MAX_BYTES + 1 } as unknown as Blob;
    const heavy = await caught(publishToTelegram({ botToken: TOKEN, chatId: '-1', kind: 'video', file: big, filename: 'f', caption: '' }));
    expect(heavy.statusCode).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a publish reply without a message id', async () => {
    fetchMock.mockResolvedValue(reply({ ok: true, result: { chat: { id: -1 } } }));
    const error = await caught(publishToTelegram({ botToken: TOKEN, chatId: '-1', kind: 'video', file, filename: 'f', caption: '' }));
    expect(error.message).toContain('invalid publish response');
  });
});

describe('telegramPostUrl', () => {
  it('links a public chat and never guesses one for a private chat', () => {
    expect(telegramPostUrl('news', 9)).toBe('https://t.me/news/9');
    expect(telegramPostUrl(null, 9)).toBeNull();
    expect(telegramPostUrl('', 9)).toBeNull();
  });
});
