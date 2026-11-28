import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { postTelegramFirstComment } from '../telegram';

const fetchMock = vi.fn();
const BOT = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0';

function ok(result: unknown): Response {
  return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
}

function bodyOf(index: number): Record<string, unknown> {
  const call = fetchMock.mock.calls[index] as [string, RequestInit];
  return JSON.parse(String(call[1].body)) as Record<string, unknown>;
}

function urlOf(index: number): string {
  return (fetchMock.mock.calls[index] as [string])[0];
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('postTelegramFirstComment', () => {
  it('skips a channel, even one with a linked discussion group, without sending anything', async () => {
    fetchMock.mockResolvedValueOnce(ok({ id: -1001, type: 'channel', title: 'News', linked_chat_id: -1002 }));
    const outcome = await postTelegramFirstComment({ botToken: BOT, chatId: '-1001', messageId: 55, text: 'Hello' });
    expect(outcome).toBe('unsupported_chat');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(urlOf(0)).toContain('/getChat');
  });

  it('replies to the post in the same chat for a group', async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ id: -2001, type: 'supergroup', title: 'Chat' }))
      .mockResolvedValueOnce(ok({ message_id: 9, chat: { id: -2001 } }));
    const outcome = await postTelegramFirstComment({ botToken: BOT, chatId: '-2001', messageId: 5, text: 'Hello' });
    expect(outcome).toBe('posted');
    expect(bodyOf(1)).toEqual({ chat_id: '-2001', text: 'Hello', reply_parameters: { message_id: 5 } });
  });

  it('scrubs the bot token from a Bot API failure', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error_code: 403, description: `Forbidden: bot ${BOT} was kicked` }), { status: 403 }),
    );
    const error = await postTelegramFirstComment({ botToken: BOT, chatId: '-1', messageId: 1, text: 'x' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(BOT);
  });
});
