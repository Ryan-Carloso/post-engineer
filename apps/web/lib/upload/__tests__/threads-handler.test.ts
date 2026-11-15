// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/social-accounts', () => ({ getSocialAccountTokens: vi.fn(), touchSocialAccount: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: vi.fn(() => ({ __mock: 'service-client' })) }));
vi.mock('@/lib/upload/publish-media', () => ({
  uploadPublishMedia: vi.fn(async () => 'https://s.example/signed.mp4'),
  presignPublishMedia: vi.fn(async () => 'https://s.example/archive.mp4'),
  cleanupPublishMedia: vi.fn(async () => 0),
}));
vi.mock('@/lib/analytics', () => ({ trackApiEvent: vi.fn() }));
vi.mock('@/lib/threads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/threads')>()),
  publishThreadsVideo: vi.fn(),
}));

import { trackApiEvent } from '@/lib/analytics';
import { ThreadsError } from '@/lib/errors';
import { handleThreadsUpload } from '@/lib/upload/threads-handler';
import { getSocialAccountTokens, touchSocialAccount } from '@/lib/social-accounts';
import { cleanupPublishMedia, presignPublishMedia, uploadPublishMedia } from '@/lib/upload/publish-media';
import { publishThreadsVideo } from '@/lib/threads';

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
  vi.mocked(publishThreadsVideo).mockResolvedValue({ postId: 'p1', permalink: 'https://www.threads.net/@a/post/x' });
});

describe('handleThreadsUpload', () => {
  it('publishes the stored video to the owner\'s account and records use', async () => {
    const result = await handleThreadsUpload(formData(), 'user-1');
    expect(result).toEqual({
      success: true,
      results: [{ accountId: '42', success: true, postId: 'p1', permalink: 'https://www.threads.net/@a/post/x' }],
    });
    expect(getSocialAccountTokens).toHaveBeenCalledWith(expect.anything(), 'user-1', 'threads', '42');
    expect(vi.mocked(publishThreadsVideo).mock.calls[0][0]).toMatchObject({
      accessToken: 'tok', userId: '42', videoUrl: 'https://s.example/signed.mp4', text: 'my post',
    });
    expect(touchSocialAccount).toHaveBeenCalledWith(expect.anything(), 'user-1', 'threads', '42');
    expect(cleanupPublishMedia).toHaveBeenCalledWith('threads');
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
    expect(publishThreadsVideo).not.toHaveBeenCalled();
  });

  it('emits publish_account_unauthorized when Threads rejects the token with 401', async () => {
    vi.mocked(publishThreadsVideo).mockRejectedValueOnce(
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
    vi.mocked(publishThreadsVideo).mockRejectedValueOnce(new ThreadsError('THREADS_PUBLISH_FAILED: boom', 500));
    await handleThreadsUpload(formData(), 'user-1');
    expect(trackApiEvent).not.toHaveBeenCalled();
  });

  it('presigns the engine archive instead of uploading a copy', async () => {
    const fd = new FormData();
    fd.append('videoStoragePath', 'user-1/faceless/task-7/final-1.mp4');
    fd.append('caption', 'my post');
    fd.append('threadsAccountIds', '42');
    const result = await handleThreadsUpload(fd, 'user-1');
    expect(result.success).toBe(true);
    expect(presignPublishMedia).toHaveBeenCalledWith('user-1/faceless/task-7/final-1.mp4');
    expect(uploadPublishMedia).not.toHaveBeenCalled();
    expect(cleanupPublishMedia).not.toHaveBeenCalled();
    expect(vi.mocked(publishThreadsVideo).mock.calls[0][0].videoUrl).toBe('https://s.example/archive.mp4');
  });

  it('rejects an archive key that belongs to another user', async () => {
    const fd = new FormData();
    fd.append('videoStoragePath', 'other-user/faceless/task-7/final-1.mp4');
    fd.append('caption', 'my post');
    fd.append('threadsAccountIds', '42');
    const result = await handleThreadsUpload(fd, 'user-1');
    expect(result.success).toBe(false);
    expect(result.results[0].error).toContain('belong to this user');
    expect(presignPublishMedia).not.toHaveBeenCalled();
    expect(publishThreadsVideo).not.toHaveBeenCalled();
  });

  it('rejects a request that sends both a file and an archive key', async () => {
    const fd = formData();
    fd.append('videoStoragePath', 'user-1/faceless/task-7/final-1.mp4');
    const result = await handleThreadsUpload(fd, 'user-1');
    expect(result.success).toBe(false);
    expect(result.results[0].error).toContain('either a file or videoStoragePath');
    expect(presignPublishMedia).not.toHaveBeenCalled();
  });

  it('keeps going after one account fails and is a success if any landed', async () => {
    vi.mocked(publishThreadsVideo).mockRejectedValueOnce(new Error('boom'));
    const result = await handleThreadsUpload(formData({ ids: ['1', '2'] }), 'user-1');
    expect(result.success).toBe(true);
    expect(result.results.map((entry) => entry.success)).toEqual([false, true]);
    expect(result.results[0].error).toBe('boom');
  });
});
