// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/social-accounts', () => ({ touchSocialAccount: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: vi.fn(() => ({ __mock: 'service-client' })) }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/analytics', () => ({ trackApiEvent: vi.fn() }));
vi.mock('@/lib/fanvue-tokens', () => ({ getValidFanvueAccessToken: vi.fn(async () => 'at-1') }));
vi.mock('@/lib/fanvue-media', () => ({
  uploadVideoToFanvueVault: vi.fn(),
}));
vi.mock('@/lib/fanvue-posts', () => ({
  createFanvuePost: vi.fn(),
  FANVUE_POST_TEXT_MAX_LENGTH: 5000,
}));

import { trackApiEvent } from '@/lib/analytics';
import { FanvueError } from '@/lib/errors';
import { handleFanvueUpload } from '@/lib/upload/fanvue-handler';
import { getValidFanvueAccessToken } from '@/lib/fanvue-tokens';
import { touchSocialAccount } from '@/lib/social-accounts';
import { uploadVideoToFanvueVault } from '@/lib/fanvue-media';
import { createFanvuePost } from '@/lib/fanvue-posts';

const MP4_BYTES = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);

function formData(
  overrides: {
    title?: string | null;
    description?: string | null;
    caption?: string | null;
    video?: File | null;
    ids?: string[];
  } = {},
): FormData {
  const fd = new FormData();
  const video = overrides.video === undefined ? new File([MP4_BYTES], 'clip.mp4', { type: 'video/mp4' }) : overrides.video;
  if (video !== null) fd.append('video', video);
  const title = overrides.title === undefined ? 'My post' : overrides.title;
  if (title !== null) fd.append('title', title);
  const description = overrides.description === undefined ? 'The description' : overrides.description;
  if (description !== null) fd.append('description', description);
  const caption = overrides.caption === undefined ? null : overrides.caption;
  if (caption !== null) fd.append('caption', caption);
  for (const id of overrides.ids ?? ['fan-9']) fd.append('fanvueAccountIds', id);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getValidFanvueAccessToken).mockResolvedValue('at-1');
  vi.mocked(uploadVideoToFanvueVault).mockResolvedValue('media-1');
  vi.mocked(createFanvuePost).mockResolvedValue({ postId: 'post-1' });
});

describe('handleFanvueUpload', () => {
  it("uploads the video to the vault, posts it subscribers-only, and records use", async () => {
    const result = await handleFanvueUpload(formData(), 'user-1');
    expect(result).toEqual({
      success: true,
      results: [{ accountId: 'fan-9', success: true, postId: 'post-1' }],
    });
    expect(getValidFanvueAccessToken).toHaveBeenCalledWith(expect.anything(), 'user-1', 'fan-9');
    expect(vi.mocked(uploadVideoToFanvueVault).mock.calls[0][0]).toMatchObject({
      accessToken: 'at-1',
      contentType: 'video/mp4',
    });
    expect(vi.mocked(uploadVideoToFanvueVault).mock.calls[0][0].filename).toMatch(/^fanvue_\d+_[0-9a-f]{8}\.mp4$/);
    expect(vi.mocked(createFanvuePost).mock.calls[0][0]).toEqual({
      accessToken: 'at-1',
      mediaUuid: 'media-1',
      text: 'My post\n\nThe description',
    });
    expect(touchSocialAccount).toHaveBeenCalledWith(expect.anything(), 'user-1', 'fanvue', 'fan-9');
  });

  it('posts the title alone when no description is sent', async () => {
    await handleFanvueUpload(formData({ description: null }), 'user-1');
    expect(vi.mocked(createFanvuePost).mock.calls[0][0]).toMatchObject({ text: 'My post' });
  });

  it('uses the caption as the post description when no description is sent', async () => {
    await handleFanvueUpload(formData({ description: null, caption: 'caption text' }), 'user-1');
    expect(vi.mocked(createFanvuePost).mock.calls[0][0]).toMatchObject({
      text: 'My post\n\ncaption text',
    });
  });

  it('stores a MOV upload as quicktime', async () => {
    await handleFanvueUpload(
      formData({ video: new File([MP4_BYTES], 'clip.mov', { type: 'video/quicktime' }) }),
      'user-1',
    );
    expect(vi.mocked(uploadVideoToFanvueVault).mock.calls[0][0].filename).toMatch(/\.mov$/);
    expect(vi.mocked(uploadVideoToFanvueVault).mock.calls[0][0].contentType).toBe('video/quicktime');
  });

  it.each([
    ['no account', { ids: [] as string[] }, 'At least one Fanvue account ID'],
    ['missing title', { title: null }, 'title is required'],
    ['blank title', { title: '   ' }, 'title is required'],
    ['over-length text', { description: 'a'.repeat(5000) }, 'Post text exceeds 5000 characters'],
    ['missing video', { video: null }, 'Video file is required'],
    ['non-video bytes', { video: new File(['not a video!'], 'x.mp4', { type: 'video/mp4' }) }, 'MP4'],
  ])('rejects %s before publishing anything', async (_name, overrides, message) => {
    const result = await handleFanvueUpload(formData(overrides), 'user-1');
    expect(result.success).toBe(false);
    expect(result.results[0].error).toContain(message);
    expect(result.results[0].errorCode).toBe('publish_rejected');
    expect(uploadVideoToFanvueVault).not.toHaveBeenCalled();
    expect(createFanvuePost).not.toHaveBeenCalled();
  });

  it('emits publish_account_unauthorized when Fanvue rejects the token with 401', async () => {
    vi.mocked(createFanvuePost).mockRejectedValueOnce(
      new FanvueError('FANVUE_PUBLISH_FAILED: Invalid access token', 401),
    );
    const result = await handleFanvueUpload(formData(), 'user-1');
    expect(result.results[0]).toEqual({ accountId: 'fan-9', success: false, error: 'FANVUE_PUBLISH_FAILED: Invalid access token', errorCode: 'token_expired' });
    expect(trackApiEvent).toHaveBeenCalledWith('publish_account_unauthorized', {
      provider: 'fanvue',
      account_id: 'fan-9',
      user_id: 'user-1',
      status: 401,
    });
  });

  it('does not emit publish_account_unauthorized when the Fanvue failure is not a 401', async () => {
    vi.mocked(createFanvuePost).mockRejectedValueOnce(new FanvueError('FANVUE_PUBLISH_FAILED: boom', 500));
    await handleFanvueUpload(formData(), 'user-1');
    expect(trackApiEvent).not.toHaveBeenCalled();
  });

  it('keeps going after one account fails and is a success if any landed', async () => {
    vi.mocked(createFanvuePost).mockRejectedValueOnce(new Error('FANVUE_PUBLISH_FAILED: boom'));
    const result = await handleFanvueUpload(formData({ ids: ['a-1', 'a-2'] }), 'user-1');
    expect(result.success).toBe(true);
    expect(result.results.map((entry) => entry.success)).toEqual([false, true]);
    expect(result.results[0].error).toBe('FANVUE_PUBLISH_FAILED: boom');
    expect(result.results[0].errorCode).toBe('transient');
    expect(touchSocialAccount).toHaveBeenCalledTimes(1);
  });

  it('fails as a whole when every account fails, and a non-Error throw stays generic', async () => {
    vi.mocked(getValidFanvueAccessToken).mockRejectedValue('not an error');
    const result = await handleFanvueUpload(formData(), 'user-1');
    expect(result).toEqual({ success: false, results: [{ accountId: 'fan-9', success: false, error: 'Unknown error', errorCode: 'transient' }] });
  });
});
