// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/social-accounts', () => ({ getSocialAccountTokens: vi.fn(), touchSocialAccount: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: vi.fn(() => ({ __mock: 'service-client' })) }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/analytics', () => ({ trackApiEvent: vi.fn() }));
vi.mock('@/lib/account-needs-reconnect', () => ({ markAccountNeedsReconnect: vi.fn(async () => undefined) }));
vi.mock('@/lib/owner-alert-mail', () => ({ notifyAccountBreak: vi.fn(async () => undefined) }));
vi.mock('@/lib/first-comment/telegram', () => ({ postTelegramFirstComment: vi.fn() }));
vi.mock('@/lib/telegram', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/telegram')>()),
  publishToTelegram: vi.fn(),
}));

import { trackApiEvent } from '@/lib/analytics';
import { markAccountNeedsReconnect } from '@/lib/account-needs-reconnect';
import { TelegramError } from '@/lib/errors';
import { postTelegramFirstComment } from '@/lib/first-comment/telegram';
import { handleTelegramUpload } from '@/lib/upload/telegram-handler';
import { getSocialAccountTokens, touchSocialAccount } from '@/lib/social-accounts';
import { publishToTelegram, TELEGRAM_CAPTION_MAX_LENGTH, TELEGRAM_FILE_MAX_BYTES } from '@/lib/telegram';

const TOKEN = `123456789:${'A'.repeat(35)}`;

function formData(overrides: { caption?: string | null; file?: File | null; field?: string; ids?: string[] } = {}): FormData {
  const fd = new FormData();
  const file = overrides.file === undefined ? new File([new Uint8Array([1, 2, 3])], 'clip.mp4', { type: 'video/mp4' }) : overrides.file;
  if (file !== null) fd.append(overrides.field ?? 'video', file);
  const caption = overrides.caption === undefined ? 'hello channel' : overrides.caption;
  if (caption !== null) fd.append('caption', caption);
  for (const id of overrides.ids ?? ['-1001']) fd.append('telegramAccountIds', id);
  return fd;
}

function stored(username: string | null): never {
  return { tokens: { access_token: TOKEN }, account: { accountMetadata: username === null ? {} : { username } } } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSocialAccountTokens).mockResolvedValue(stored('news'));
  vi.mocked(publishToTelegram).mockResolvedValue({ messageId: 9, chatId: '-1001' });
});

describe('handleTelegramUpload', () => {
  it('publishes the video to the chat with the stored bot token, records use and links a public chat', async () => {
    const result = await handleTelegramUpload(formData({ caption: '  hello channel  ' }), 'user-1');
    expect(result).toEqual({
      success: true,
      results: [{ accountId: '-1001', success: true, postId: '9', permalink: 'https://t.me/news/9' }],
    });
    expect(getSocialAccountTokens).toHaveBeenCalledWith(expect.anything(), 'user-1', 'telegram', '-1001');
    expect(vi.mocked(publishToTelegram).mock.calls[0][0]).toMatchObject({
      botToken: TOKEN,
      chatId: '-1001',
      kind: 'video',
      filename: 'clip.mp4',
      caption: 'hello channel',
    });
    expect(touchSocialAccount).toHaveBeenCalledWith(expect.anything(), 'user-1', 'telegram', '-1001');
  });

  it('omits the permalink for a private chat (no username)', async () => {
    vi.mocked(getSocialAccountTokens).mockResolvedValue(stored(null));
    const result = await handleTelegramUpload(formData(), 'user-1');
    expect(result.results[0]).toEqual({ accountId: '-1001', success: true, postId: '9' });
  });

  it.each([
    ['image/png', 'photo'],
    ['image/jpeg', 'photo'],
    ['audio/mpeg', 'audio'],
  ])('sends a %s file as a %s', async (type, kind) => {
    await handleTelegramUpload(formData({ file: new File([new Uint8Array([1])], 'f', { type }) }), 'user-1');
    expect(vi.mocked(publishToTelegram).mock.calls[0][0].kind).toBe(kind);
  });

  it('reads an image sent in the image field', async () => {
    await handleTelegramUpload(formData({ field: 'image', file: new File([new Uint8Array([1])], 'p.png', { type: 'image/png' }) }), 'user-1');
    expect(vi.mocked(publishToTelegram).mock.calls[0][0].kind).toBe('photo');
  });

  it.each([
    ['no chat', { ids: [] as string[] }, 'At least one Telegram chat ID'],
    ['missing file', { file: null }, 'Video, image or audio file is required'],
    ['unsupported type', { file: new File(['x'], 'a.gif', { type: 'image/gif' }) }, 'video, a JPEG/PNG image or an audio file'],
    ['over-long caption', { caption: 'a'.repeat(TELEGRAM_CAPTION_MAX_LENGTH + 1) }, '1024-character'],
  ])('rejects %s before calling Telegram', async (_name, overrides, message) => {
    const result = await handleTelegramUpload(formData(overrides), 'user-1');
    expect(result.success).toBe(false);
    expect(result.results[0].error).toContain(message);
    expect(result.results[0].errorCode).toBe('publish_rejected');
    expect(publishToTelegram).not.toHaveBeenCalled();
  });

  it('rejects a file over the 50MB Bot API limit before calling Telegram', async () => {
    const file = new File([new Uint8Array([1])], 'big.mp4', { type: 'video/mp4' });
    Object.defineProperty(file, 'size', { value: TELEGRAM_FILE_MAX_BYTES + 1 });
    const result = await handleTelegramUpload(formData({ file }), 'user-1');
    expect(result.results[0].error).toContain('50MB');
    expect(publishToTelegram).not.toHaveBeenCalled();
  });

  it('flags a missing bot token for reconnect and keeps publishing the other chats', async () => {
    vi.mocked(getSocialAccountTokens)
      .mockResolvedValueOnce({ tokens: { access_token: '' }, account: { accountMetadata: {} } } as never)
      .mockResolvedValueOnce(stored('club'));
    const result = await handleTelegramUpload(formData({ ids: ['-1001', '-1002'] }), 'user-1');
    expect(result.success).toBe(true);
    expect(result.results[0]).toMatchObject({ accountId: '-1001', success: false, errorCode: 'token_missing' });
    expect(result.results[1]).toMatchObject({ accountId: '-1002', success: true });
    expect(markAccountNeedsReconnect).toHaveBeenCalledWith('user-1', 'telegram', '-1001');
  });

  it('reports a rejected bot token (Telegram 401) as unauthorized and flags the chat for reconnect', async () => {
    vi.mocked(publishToTelegram).mockRejectedValue(new TelegramError('invalid_token', 'TELEGRAM_API_ERROR: Unauthorized', 401));
    const result = await handleTelegramUpload(formData(), 'user-1');
    expect(result.success).toBe(false);
    expect(result.results[0]).toMatchObject({ accountId: '-1001', success: false, errorCode: 'token_expired' });
    expect(trackApiEvent).toHaveBeenCalledWith('publish_account_unauthorized', {
      provider: 'telegram',
      account_id: '-1001',
      user_id: 'user-1',
      status: 401,
    });
    expect(markAccountNeedsReconnect).toHaveBeenCalledWith('user-1', 'telegram', '-1001');
  });

  it('fails a chat the bot lost its seat in without flagging the token', async () => {
    vi.mocked(publishToTelegram).mockRejectedValue(new TelegramError('not_member', 'TELEGRAM_API_ERROR: bot was kicked', 403));
    const result = await handleTelegramUpload(formData(), 'user-1');
    expect(result.results[0]).toMatchObject({ success: false, errorCode: 'publish_rejected' });
    expect(trackApiEvent).not.toHaveBeenCalled();
    expect(markAccountNeedsReconnect).not.toHaveBeenCalled();
  });

  it('retries a Telegram outage as transient', async () => {
    vi.mocked(publishToTelegram).mockRejectedValue(new TelegramError('publish_failed', 'TELEGRAM_REQUEST_FAILED: timeout', 502));
    const result = await handleTelegramUpload(formData(), 'user-1');
    expect(result.results[0]).toMatchObject({ success: false, errorCode: 'transient' });
  });
});

describe('handleTelegramUpload first comment', () => {
  function withComment(text: string): FormData {
    const fd = formData();
    fd.append('firstComment', text);
    return fd;
  }

  it('comments on the group post with the stored bot token', async () => {
    vi.mocked(postTelegramFirstComment).mockResolvedValue('posted');
    const result = await handleTelegramUpload(withComment('Link in bio'), 'user-1');
    expect(postTelegramFirstComment).toHaveBeenCalledWith({ botToken: TOKEN, chatId: '-1001', messageId: 9, text: 'Link in bio' });
    expect(result.results[0].warnings).toBeUndefined();
  });

  it('skips a channel and says so', async () => {
    vi.mocked(postTelegramFirstComment).mockResolvedValue('unsupported_chat');
    const result = await handleTelegramUpload(withComment('Link in bio'), 'user-1');
    expect(result.success).toBe(true);
    expect(result.results[0]).toMatchObject({ success: true, postId: '9', warnings: ['FIRST_COMMENT_UNSUPPORTED_CHAT'] });
  });

  it('keeps the post published when the bot cannot comment and never asks to reconnect', async () => {
    vi.mocked(postTelegramFirstComment).mockRejectedValue(new TelegramError('no_permission', 'TELEGRAM_API_ERROR: not enough rights', 403));
    const result = await handleTelegramUpload(withComment('Link in bio'), 'user-1');
    expect(result.results[0]).toMatchObject({ success: true, warnings: ['FIRST_COMMENT_FAILED'] });
    expect(markAccountNeedsReconnect).not.toHaveBeenCalled();
  });

  it('does not comment without a first comment', async () => {
    await handleTelegramUpload(formData(), 'user-1');
    expect(postTelegramFirstComment).not.toHaveBeenCalled();
  });
});
