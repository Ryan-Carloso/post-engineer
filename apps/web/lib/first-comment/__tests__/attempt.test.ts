// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { logger } from '@/lib/logger';
import { FIRST_COMMENT_MAX_LENGTH } from '@/lib/contracts/first-comment';
import { attemptFirstComment, readFirstCommentField } from '../attempt';
import { classifyFirstCommentError } from '../classify';
import { FirstCommentError } from '../http';
import { exceedsFirstCommentLimit } from '../limits';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('readFirstCommentField', () => {
  it('returns null text when the field is absent or blank', () => {
    expect(readFirstCommentField(new FormData())).toEqual({ ok: true, text: null });
    const blank = new FormData();
    blank.append('firstComment', '   ');
    expect(readFirstCommentField(blank)).toEqual({ ok: true, text: null });
  });

  it('trims a provided comment', () => {
    const form = new FormData();
    form.append('firstComment', '  Link in bio ');
    expect(readFirstCommentField(form)).toEqual({ ok: true, text: 'Link in bio' });
  });

  it('rejects a comment over the shared limit', () => {
    const form = new FormData();
    form.append('firstComment', 'x'.repeat(FIRST_COMMENT_MAX_LENGTH + 1));
    const result = readFirstCommentField(form);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain(String(FIRST_COMMENT_MAX_LENGTH));
  });

  it('rejects a file where text is expected', () => {
    const form = new FormData();
    form.append('firstComment', new File(['x'], 'x.txt'));
    expect(readFirstCommentField(form).ok).toBe(false);
  });
});

describe('attemptFirstComment', () => {
  it('does nothing when there is no comment', async () => {
    const run = vi.fn();
    expect(await attemptFirstComment({ provider: 'youtube', accountId: 'a', text: null }, run)).toEqual({});
    expect(run).not.toHaveBeenCalled();
  });

  it('passes the text to the network function and adds no warning on success', async () => {
    const run = vi.fn(async () => 'posted' as const);
    expect(await attemptFirstComment({ provider: 'facebook', accountId: 'a', text: 'Hello' }, run)).toEqual({});
    expect(run).toHaveBeenCalledWith('Hello');
  });

  it('turns a failure into FIRST_COMMENT_FAILED and logs it without the token', async () => {
    const run = vi.fn(async () => {
      throw new FirstCommentError('FACEBOOK_COMMENT_FAILED: boom https://x.test/?access_token=SECRET123&a=1', 500);
    });
    const result = await attemptFirstComment({ provider: 'facebook', accountId: 'page-1', text: 'Hello' }, run);
    expect(result).toEqual({ warnings: ['FIRST_COMMENT_FAILED'] });
    const [message, metadata] = vi.mocked(logger.warn).mock.calls[0];
    expect(message).toContain('the post stays published');
    expect(metadata).toMatchObject({ provider: 'facebook', accountId: 'page-1', code: 'FIRST_COMMENT_FAILED' });
    expect(JSON.stringify(metadata)).not.toContain('SECRET123');
  });

  it('maps a 403 to FIRST_COMMENT_RECONNECT_REQUIRED', async () => {
    const run = vi.fn(async () => {
      throw new FirstCommentError('YOUTUBE_COMMENT_FAILED: scopes', 403, { reason: 'insufficientPermissions' });
    });
    expect(await attemptFirstComment({ provider: 'youtube', accountId: 'a', text: 'Hello' }, run)).toEqual({
      warnings: ['FIRST_COMMENT_RECONNECT_REQUIRED'],
    });
  });

  it('reports the skipped chat with its own code', async () => {
    const run = vi.fn(async () => 'unsupported_chat' as const);
    expect(await attemptFirstComment({ provider: 'telegram', accountId: 'c', text: 'Hello' }, run)).toEqual({
      warnings: ['FIRST_COMMENT_UNSUPPORTED_CHAT'],
    });
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('skips the call when the comment is over the network limit', async () => {
    const run = vi.fn(async () => 'posted' as const);
    const result = await attemptFirstComment({ provider: 'bluesky', accountId: 'did', text: 'x'.repeat(301) }, run);
    expect(result).toEqual({ warnings: ['FIRST_COMMENT_TOO_LONG'] });
    expect(run).not.toHaveBeenCalled();
  });
});

describe('classifyFirstCommentError', () => {
  it.each([
    ['youtube', new FirstCommentError('x', 403, { reason: 'insufficientPermissions' })],
    ['youtube', new FirstCommentError('x', 401)],
    ['instagram', new FirstCommentError('x', 401)],
    ['instagram', new FirstCommentError('x', 400, { providerCode: 190 })],
    ['linkedin', new FirstCommentError('x', 403)],
    ['instagram', new FirstCommentError('x', 400, { providerCode: 10 })],
    ['facebook', new FirstCommentError('x', 400, { providerCode: 200 })],
    ['threads', new FirstCommentError('x', 400, { reason: 'PERMISSION_DENIED' })],
  ] as const)('%s: a permission failure asks the user to reconnect', (provider, error) => {
    expect(classifyFirstCommentError(provider, error)).toBe('FIRST_COMMENT_RECONNECT_REQUIRED');
  });

  it.each([
    ['linkedin', new FirstCommentError('x', 500)],
    ['facebook', new FirstCommentError('x', 400, { providerCode: 100 })],
    ['youtube', new FirstCommentError('x', 403, { reason: 'forbidden' })],
    ['youtube', new FirstCommentError('x', 403)],
    ['bluesky', new TypeError('fetch failed')],
  ] as const)('%s: any other failure is a plain comment failure', (provider, error) => {
    expect(classifyFirstCommentError(provider, error)).toBe('FIRST_COMMENT_FAILED');
  });

  it('never asks a Telegram user to reconnect, there is no scope to grant', () => {
    expect(classifyFirstCommentError('telegram', new FirstCommentError('x', 403))).toBe('FIRST_COMMENT_FAILED');
  });
});

describe('exceedsFirstCommentLimit', () => {
  it('counts Bluesky graphemes, not UTF-16 units', () => {
    const family = '👨‍👩‍👧‍👦';
    expect(exceedsFirstCommentLimit('bluesky', family.repeat(300))).toBe(false);
    expect(exceedsFirstCommentLimit('bluesky', family.repeat(301))).toBe(true);
  });

  it('applies the Threads and LinkedIn limits', () => {
    expect(exceedsFirstCommentLimit('threads', 'x'.repeat(500))).toBe(false);
    expect(exceedsFirstCommentLimit('threads', 'x'.repeat(501))).toBe(true);
    expect(exceedsFirstCommentLimit('linkedin', 'x'.repeat(1251))).toBe(true);
  });

  it('keeps every network at or above the shared limit except the three short ones', () => {
    for (const provider of ['youtube', 'instagram', 'facebook', 'telegram'] as const) {
      expect(exceedsFirstCommentLimit(provider, 'x'.repeat(FIRST_COMMENT_MAX_LENGTH))).toBe(false);
    }
  });
});
