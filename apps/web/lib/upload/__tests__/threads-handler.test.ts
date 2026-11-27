// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/social-accounts', () => ({ getSocialAccountTokens: vi.fn(), touchSocialAccount: vi.fn() }));
vi.mock('@/lib/account-needs-reconnect', () => ({ markAccountNeedsReconnect: vi.fn(async () => undefined) }));
vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: vi.fn(() => ({ __mock: 'service-client' })) }));
vi.mock('@/lib/upload/publish-media', () => ({
  uploadPublishMedia: vi.fn(async () => 'https://s.example/signed.mp4'),
  presignPublishMedia: vi.fn(async () => 'https://s.example/archive.mp4'),
  cleanupPublishMedia: vi.fn(async () => 0),
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/analytics', () => ({ trackApiEvent: vi.fn() }));
vi.mock('@/lib/first-comment/threads', () => ({ postThreadsFirstComment: vi.fn() }));
vi.mock('@/lib/threads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/threads')>()),
  publishThreadsMedia: vi.fn(),
}));

import { trackApiEvent } from '@/lib/analytics';
import { ThreadsError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { handleThreadsUpload } from '@/lib/upload/threads-handler';
import { getSocialAccountTokens, touchSocialAccount } from '@/lib/social-accounts';
import { cleanupPublishMedia, presignPublishMedia, uploadPublishMedia } from '@/lib/upload/publish-media';
import { publishThreadsMedia } from '@/lib/threads';
import { markAccountNeedsReconnect } from '@/lib/account-needs-reconnect';
import { postThreadsFirstComment } from '@/lib/first-comment/threads';
import { FirstCommentError } from '@/lib/first-comment/http';

const MP4_BYTES = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);

function formData(overrides: { caption?: string; video?: File; ids?: string[] } = {}): FormData {
  const fd = new FormData();
  fd.append('video', overrides.video ?? new File([MP4_BYTES], 'clip.mp4', { type: 'video/mp4' }));
  fd.append('caption', overrides.caption ?? 'my post');
  for (const id of overrides.ids ?? ['42']) fd.append('threadsAccountIds', id);
  return fd;
}

function tokens(value: Record<string, unknown>): never {
  return { tokens: value } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSocialAccountTokens).mockResolvedValue(tokens({ access_token: 'tok' }));
  vi.mocked(publishThreadsMedia).mockResolvedValue({ postId: 'p1', permalink: 'https://www.threads.net/@a/post/x' });
});

describe('handleThreadsUpload', () => {
  it.each([
    ['JPEG', new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), 'image/jpeg', 'jpg'],
    ['PNG', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]), 'image/png', 'png'],
  ])('publishes a %s image: stored on R2 by its sniffed type, posted as an image', async (_name, bytes, contentType, extension) => {
    const image = new File([bytes], 'photo.bin', { type: 'application/octet-stream' });
    const result = await handleThreadsUpload(formData({ video: image }), 'user-1');
    expect(result.success).toBe(true);
    const key = String(vi.mocked(uploadPublishMedia).mock.calls[0][1]);
    expect(key.startsWith('threads/')).toBe(true);
    expect(key.endsWith(`.${extension}`)).toBe(true);
    expect(vi.mocked(uploadPublishMedia).mock.calls[0][2]).toBe(contentType);
    expect(vi.mocked(publishThreadsMedia).mock.calls[0][0].media.kind).toBe('image');
  });

  it('rejects an image over 8 MB before storing it', async () => {
    const big = new Uint8Array(8 * 1024 * 1024 + 1);
    big.set([0xff, 0xd8, 0xff]);
    const result = await handleThreadsUpload(formData({ video: new File([big], 'big.jpg', { type: 'image/jpeg' }) }), 'user-1');
    expect(result.success).toBe(false);
    expect(result.results[0].error).toContain('Image exceeds the 8 MB limit');
    expect(uploadPublishMedia).not.toHaveBeenCalled();
  });

  it('publishes the stored video to the owner\'s account and records use', async () => {
    const result = await handleThreadsUpload(formData(), 'user-1');
    expect(result).toEqual({
      success: true,
      results: [{ accountId: '42', success: true, postId: 'p1', permalink: 'https://www.threads.net/@a/post/x' }],
    });
    expect(getSocialAccountTokens).toHaveBeenCalledWith(expect.anything(), 'user-1', 'threads', '42');
    expect(vi.mocked(publishThreadsMedia).mock.calls[0][0]).toMatchObject({
      accessToken: 'tok', userId: '42', media: { kind: 'video', url: 'https://s.example/signed.mp4' }, text: 'my post',
    });
    expect(touchSocialAccount).toHaveBeenCalledWith(expect.anything(), 'user-1', 'threads', '42');
    expect(cleanupPublishMedia).toHaveBeenCalledWith('threads');
  });

  it('rejects an aiLabel that is not true or false before storing anything', async () => {
    const fd = formData();
    fd.set('aiLabel', 'yes');
    const result = await handleThreadsUpload(fd, 'user-1');
    expect(result.success).toBe(false);
    expect(result.results[0].error).toContain('Invalid aiLabel');
    expect(uploadPublishMedia).not.toHaveBeenCalled();
    expect(publishThreadsMedia).not.toHaveBeenCalled();
  });

  it('passes aiLabel through to Threads', async () => {
    const fd = formData();
    fd.set('aiLabel', 'true');
    const result = await handleThreadsUpload(fd, 'user-1');
    expect(result.success).toBe(true);
    expect(vi.mocked(publishThreadsMedia).mock.calls[0][0]).toMatchObject({ aiLabel: true });
  });

  it('passes aiLabel false when the form omits it', async () => {
    await handleThreadsUpload(formData(), 'user-1');
    expect(vi.mocked(publishThreadsMedia).mock.calls[0][0]).toMatchObject({ aiLabel: false });
  });

  it('logs a failed permalink read without failing the publish', async () => {
    await handleThreadsUpload(formData(), 'user-1');
    const { onPermalinkError } = vi.mocked(publishThreadsMedia).mock.calls[0][0];
    expect(typeof onPermalinkError).toBe('function');
    onPermalinkError?.(new Error('THREADS_PERMALINK_FAILED: nope'));
    expect(logger.warn).toHaveBeenCalledWith('upload-content/threads: permalink read failed', {
      accountId: '42',
      error: 'Error: THREADS_PERMALINK_FAILED: nope',
    });
  });

  it.each([
    ['no account', { ids: [] as string[] }, 'At least one Threads account ID'],
    ['blank caption', { caption: '   ' }, 'Caption is required'],
    ['over-long caption', { caption: 'a'.repeat(501) }, '500-character'],
    ['non-video bytes', { video: new File(['not a video!'], 'x.mp4', { type: 'video/mp4' }) }, 'MP4 or MOV'],
  ])('rejects %s before storing anything', async (_name, overrides, message) => {
    const result = await handleThreadsUpload(formData(overrides), 'user-1');
    expect(result.success).toBe(false);
    expect(result.results[0].error).toContain(message);
    expect(uploadPublishMedia).not.toHaveBeenCalled();
  });

  it('reports an expired token without calling Threads', async () => {
    vi.mocked(getSocialAccountTokens).mockResolvedValue(tokens({ access_token: 'tok', expiry_date: Date.now() - 1 }));
    const result = await handleThreadsUpload(formData(), 'user-1');
    expect(result.results[0].error).toContain('reconnect');
    expect(publishThreadsMedia).not.toHaveBeenCalled();
  });

  it('emits publish_account_unauthorized when Threads rejects the token with 401', async () => {
    vi.mocked(publishThreadsMedia).mockRejectedValueOnce(
      new ThreadsError('THREADS_PUBLISH_FAILED: Invalid OAuth access token', 401),
    );
    const result = await handleThreadsUpload(formData(), 'user-1');
    expect(result.results[0].success).toBe(false);
    expect(trackApiEvent).toHaveBeenCalledWith('publish_account_unauthorized', {
      provider: 'threads',
      account_id: '42',
      user_id: 'user-1',
      status: 401,
    });
  });

  it('does not emit publish_account_unauthorized when the Threads failure is not a 401', async () => {
    vi.mocked(publishThreadsMedia).mockRejectedValueOnce(new ThreadsError('THREADS_PUBLISH_FAILED: boom', 500));
    await handleThreadsUpload(formData(), 'user-1');
    expect(trackApiEvent).not.toHaveBeenCalled();
  });

  it('presigns the archived upload instead of uploading a copy', async () => {
    const fd = new FormData();
    fd.append('videoStoragePath', 'user-1/voiceover/task-7/final-1.mp4');
    fd.append('caption', 'my post');
    fd.append('threadsAccountIds', '42');
    const result = await handleThreadsUpload(fd, 'user-1');
    expect(result.success).toBe(true);
    expect(presignPublishMedia).toHaveBeenCalledWith('user-1/voiceover/task-7/final-1.mp4');
    expect(uploadPublishMedia).not.toHaveBeenCalled();
    expect(cleanupPublishMedia).not.toHaveBeenCalled();
    expect(vi.mocked(publishThreadsMedia).mock.calls[0][0].media).toEqual({ kind: 'video', url: 'https://s.example/archive.mp4' });
  });

  it('rejects an archive key that belongs to another user', async () => {
    const fd = new FormData();
    fd.append('videoStoragePath', 'other-user/voiceover/task-7/final-1.mp4');
    fd.append('caption', 'my post');
    fd.append('threadsAccountIds', '42');
    const result = await handleThreadsUpload(fd, 'user-1');
    expect(result.success).toBe(false);
    expect(result.results[0].error).toContain('belong to this user');
    expect(presignPublishMedia).not.toHaveBeenCalled();
    expect(publishThreadsMedia).not.toHaveBeenCalled();
  });

  it('rejects a request that sends both a file and an archive key', async () => {
    const fd = formData();
    fd.append('videoStoragePath', 'user-1/voiceover/task-7/final-1.mp4');
    const result = await handleThreadsUpload(fd, 'user-1');
    expect(result.success).toBe(false);
    expect(result.results[0].error).toContain('either a file or videoStoragePath');
    expect(presignPublishMedia).not.toHaveBeenCalled();
  });

  it('keeps going after one account fails and is a success if any landed', async () => {
    vi.mocked(publishThreadsMedia).mockRejectedValueOnce(new Error('boom'));
    const result = await handleThreadsUpload(formData({ ids: ['1', '2'] }), 'user-1');
    expect(result.success).toBe(true);
    expect(result.results.map((entry) => entry.success)).toEqual([false, true]);
    expect(result.results[0].error).toBe('boom');
  });

  it('flags an account whose stored token is empty and never calls Threads', async () => {
    vi.mocked(getSocialAccountTokens).mockResolvedValue(tokens({ access_token: '' }));
    const result = await handleThreadsUpload(formData(), 'user-1');
    expect(result.results[0]).toMatchObject({ success: false, errorCode: 'token_missing' });
    expect(markAccountNeedsReconnect).toHaveBeenCalledWith('user-1', 'threads', '42');
    expect(publishThreadsMedia).not.toHaveBeenCalled();
  });
});

describe('handleThreadsUpload first comment', () => {
  function withComment(text: string): FormData {
    const fd = formData();
    fd.append('firstComment', text);
    return fd;
  }

  it('replies to the published post as the account', async () => {
    vi.mocked(postThreadsFirstComment).mockResolvedValue('reply-1');
    const result = await handleThreadsUpload(withComment('Link in bio'), 'user-1');
    expect(postThreadsFirstComment).toHaveBeenCalledWith({ accessToken: 'tok', userId: '42', postId: 'p1', text: 'Link in bio' });
    expect(result.results[0].warnings).toBeUndefined();
  });

  it('does not reply when the form has no first comment', async () => {
    await handleThreadsUpload(formData(), 'user-1');
    expect(postThreadsFirstComment).not.toHaveBeenCalled();
  });

  it('keeps the post published and asks to reconnect when the reply scope is missing', async () => {
    vi.mocked(postThreadsFirstComment).mockRejectedValue(new FirstCommentError('THREADS_REPLY_FAILED: permission', 400, { providerCode: 10 }));
    const result = await handleThreadsUpload(withComment('Link in bio'), 'user-1');
    expect(result.success).toBe(true);
    expect(result.results[0]).toMatchObject({ success: true, postId: 'p1', warnings: ['FIRST_COMMENT_RECONNECT_REQUIRED'] });
    expect(trackApiEvent).not.toHaveBeenCalled();
    expect(markAccountNeedsReconnect).not.toHaveBeenCalled();
  });

  it('warns FIRST_COMMENT_TOO_LONG over the 500-character Threads limit without calling the API', async () => {
    const result = await handleThreadsUpload(withComment('x'.repeat(501)), 'user-1');
    expect(result.results[0].warnings).toEqual(['FIRST_COMMENT_TOO_LONG']);
    expect(postThreadsFirstComment).not.toHaveBeenCalled();
  });

  it('rejects an over-length first comment before publishing', async () => {
    const result = await handleThreadsUpload(withComment('x'.repeat(1001)), 'user-1');
    expect(result.success).toBe(false);
    expect(publishThreadsMedia).not.toHaveBeenCalled();
  });
});
