// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/social-accounts', () => ({ getSocialAccountTokens: vi.fn(), touchSocialAccount: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: vi.fn(() => ({ __mock: 'service-client' })) }));
vi.mock('@/lib/upload/publish-media', () => ({
  uploadPublishMedia: vi.fn(async () => 'https://s.example/signed.mp4'),
  presignPublishMedia: vi.fn(async () => 'https://s.example/archive.mp4'),
  cleanupPublishMedia: vi.fn(async () => 0),
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/analytics', () => ({ trackApiEvent: vi.fn() }));
vi.mock('@/lib/facebook', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/facebook')>()),
  publishFacebookMedia: vi.fn(),
}));

import { trackApiEvent } from '@/lib/analytics';
import { FacebookError } from '@/lib/errors';
import { handleFacebookUpload } from '@/lib/upload/facebook-handler';
import { getSocialAccountTokens, touchSocialAccount } from '@/lib/social-accounts';
import { cleanupPublishMedia, presignPublishMedia, uploadPublishMedia } from '@/lib/upload/publish-media';
import { publishFacebookMedia, FACEBOOK_TEXT_MAX_CHARS } from '@/lib/facebook';
import { logger } from '@/lib/logger';

const MP4_BYTES = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);

function formData(overrides: { caption?: string | null; video?: File | null; ids?: string[] } = {}): FormData {
  const fd = new FormData();
  const video = overrides.video === undefined ? new File([MP4_BYTES], 'clip.mp4', { type: 'video/mp4' }) : overrides.video;
  if (video !== null) fd.append('video', video);
  const caption = overrides.caption === undefined ? 'my post' : overrides.caption;
  if (caption !== null) fd.append('caption', caption);
  for (const id of overrides.ids ?? ['111']) fd.append('facebookAccountIds', id);
  return fd;
}

function tokens(value: Record<string, unknown>): never {
  return { tokens: value } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSocialAccountTokens).mockResolvedValue(tokens({ access_token: 'page-tok' }));
  vi.mocked(publishFacebookMedia).mockResolvedValue({ postId: 'vid-1', permalink: 'https://www.facebook.com/111/videos/vid-1/', aiLabelApplied: false });
});

describe('handleFacebookUpload', () => {
  it.each([
    ['JPEG', new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), 'image/jpeg', 'jpg'],
    ['PNG', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]), 'image/png', 'png'],
  ])('publishes a %s image: stored on R2 by its sniffed type, posted as an image', async (_name, bytes, contentType, extension) => {
    const image = new File([bytes], 'photo.bin', { type: 'application/octet-stream' });
    const result = await handleFacebookUpload(formData({ video: image }), 'user-1');
    expect(result.success).toBe(true);
    const key = String(vi.mocked(uploadPublishMedia).mock.calls[0][1]);
    expect(key.startsWith('facebook/')).toBe(true);
    expect(key.endsWith(`.${extension}`)).toBe(true);
    expect(vi.mocked(uploadPublishMedia).mock.calls[0][2]).toBe(contentType);
    expect(vi.mocked(publishFacebookMedia).mock.calls[0][0].media.kind).toBe('image');
  });

  it('rejects an image over 8 MB before storing it', async () => {
    const big = new Uint8Array(8 * 1024 * 1024 + 1);
    big.set([0xff, 0xd8, 0xff]);
    const result = await handleFacebookUpload(formData({ video: new File([big], 'big.jpg', { type: 'image/jpeg' }) }), 'user-1');
    expect(result.success).toBe(false);
    expect(result.results[0].error).toContain('Image exceeds the 8 MB limit');
    expect(uploadPublishMedia).not.toHaveBeenCalled();
  });

  it("publishes the stored video to the owner's Page with its Page token and records use", async () => {
    const result = await handleFacebookUpload(formData({ caption: '  my post  ' }), 'user-1');
    expect(result).toEqual({
      success: true,
      results: [{ accountId: '111', success: true, postId: 'vid-1', permalink: 'https://www.facebook.com/111/videos/vid-1/' }],
    });
    expect(getSocialAccountTokens).toHaveBeenCalledWith(expect.anything(), 'user-1', 'facebook', '111');
    expect(vi.mocked(publishFacebookMedia).mock.calls[0][0]).toMatchObject({
      pageAccessToken: 'page-tok',
      pageId: '111',
      media: { kind: 'video', url: 'https://s.example/signed.mp4' },
      description: 'my post',
    });
    expect(vi.mocked(uploadPublishMedia).mock.calls[0][1]).toMatch(/^facebook\/\d+_[0-9a-f]{8}\.mp4$/);
    expect(vi.mocked(uploadPublishMedia).mock.calls[0][2]).toBe('video/mp4');
    expect(touchSocialAccount).toHaveBeenCalledWith(expect.anything(), 'user-1', 'facebook', '111');
    expect(cleanupPublishMedia).toHaveBeenCalledWith('facebook');
  });

  it('stores a MOV upload as quicktime', async () => {
    await handleFacebookUpload(formData({ video: new File([MP4_BYTES], 'clip.mov', { type: 'video/quicktime' }) }), 'user-1');
    expect(vi.mocked(uploadPublishMedia).mock.calls[0][1]).toMatch(/\.mov$/);
    expect(vi.mocked(uploadPublishMedia).mock.calls[0][2]).toBe('video/quicktime');
  });

  it('omits the permalink when Facebook returned none', async () => {
    vi.mocked(publishFacebookMedia).mockResolvedValue({ postId: 'vid-1', permalink: null, aiLabelApplied: false });
    const result = await handleFacebookUpload(formData(), 'user-1');
    expect(result.results[0]).toEqual({ accountId: '111', success: true, postId: 'vid-1' });
  });

  it('logs a failed permalink read without failing the publish', async () => {
    await handleFacebookUpload(formData(), 'user-1');
    const { onPermalinkError } = vi.mocked(publishFacebookMedia).mock.calls[0][0];
    onPermalinkError(new Error('FACEBOOK_PERMALINK_FAILED: nope'));
    expect(logger.warn).toHaveBeenCalledWith('upload-content/facebook: permalink read failed', {
      accountId: '111',
      error: 'Error: FACEBOOK_PERMALINK_FAILED: nope',
    });
  });

  it('rejects an aiLabel that is not true or false before storing anything', async () => {
    const fd = formData();
    fd.set('aiLabel', 'yes');
    const result = await handleFacebookUpload(fd, 'user-1');
    expect(result.success).toBe(false);
    expect(result.results[0].error).toContain('Invalid aiLabel');
    expect(uploadPublishMedia).not.toHaveBeenCalled();
    expect(publishFacebookMedia).not.toHaveBeenCalled();
  });

  it('passes aiLabel through to Facebook and reports a failed label edit', async () => {
    const fd = formData();
    fd.set('aiLabel', 'true');
    const result = await handleFacebookUpload(fd, 'user-1');
    expect(result.success).toBe(true);
    expect(vi.mocked(publishFacebookMedia).mock.calls[0][0]).toMatchObject({ aiLabel: true });
    const { onAiLabelError } = vi.mocked(publishFacebookMedia).mock.calls[0][0];
    expect(typeof onAiLabelError).toBe('function');
    onAiLabelError?.(new Error('FACEBOOK_AI_LABEL_FAILED: boom'));
    expect(logger.error).toHaveBeenCalledWith(
      'upload-content/facebook: AI label edit failed; the post is live without the AI disclosure',
      expect.any(Error),
      { accountId: '111' },
    );
  });

  it('passes aiLabel false when the form omits it', async () => {
    await handleFacebookUpload(formData(), 'user-1');
    expect(vi.mocked(publishFacebookMedia).mock.calls[0][0]).toMatchObject({ aiLabel: false });
  });

  it.each([
    ['no Page', { ids: [] as string[] }, 'At least one Facebook Page ID'],
    ['missing caption', { caption: null }, 'Caption is required'],
    ['blank caption', { caption: '   ' }, 'Caption is required'],
    ['over-long caption', { caption: 'a'.repeat(FACEBOOK_TEXT_MAX_CHARS + 1) }, '63206-character'],
    ['missing video', { video: null }, 'A video or image file is required'],
    ['non-video bytes', { video: new File(['not a video!'], 'x.mp4', { type: 'video/mp4' }) }, 'MP4 or MOV'],
  ])('rejects %s before storing anything', async (_name, overrides, message) => {
    const result = await handleFacebookUpload(formData(overrides), 'user-1');
    expect(result.success).toBe(false);
    expect(result.results[0].error).toContain(message);
    expect(uploadPublishMedia).not.toHaveBeenCalled();
    expect(publishFacebookMedia).not.toHaveBeenCalled();
  });

  it('accepts a caption exactly at the limit', async () => {
    const result = await handleFacebookUpload(formData({ caption: 'a'.repeat(FACEBOOK_TEXT_MAX_CHARS) }), 'user-1');
    expect(result.success).toBe(true);
  });

  it('reports a Page without a stored token without calling Facebook', async () => {
    vi.mocked(getSocialAccountTokens).mockResolvedValue(tokens({}));
    const result = await handleFacebookUpload(formData(), 'user-1');
    expect(result).toEqual({ success: false, results: [{ accountId: '111', success: false, error: 'Facebook Page token not found', errorCode: 'token_missing' }] });
    expect(publishFacebookMedia).not.toHaveBeenCalled();
  });

  it('emits publish_account_unauthorized when Facebook rejects the Page token with 401', async () => {
    vi.mocked(publishFacebookMedia).mockRejectedValueOnce(
      new FacebookError('FACEBOOK_PUBLISH_FAILED: Invalid OAuth access token', 401),
    );
    const result = await handleFacebookUpload(formData(), 'user-1');
    expect(result.results[0]).toEqual({ accountId: '111', success: false, error: 'FACEBOOK_PUBLISH_FAILED: Invalid OAuth access token', errorCode: 'token_expired' });
    expect(trackApiEvent).toHaveBeenCalledWith('publish_account_unauthorized', {
      provider: 'facebook',
      account_id: '111',
      user_id: 'user-1',
      status: 401,
    });
  });

  it('does not emit publish_account_unauthorized when the Facebook failure is not a 401', async () => {
    vi.mocked(publishFacebookMedia).mockRejectedValueOnce(new FacebookError('FACEBOOK_PUBLISH_FAILED: boom', 500));
    await handleFacebookUpload(formData(), 'user-1');
    expect(trackApiEvent).not.toHaveBeenCalled();
  });

  it('keeps going after one Page fails and is a success if any landed', async () => {
    vi.mocked(publishFacebookMedia).mockRejectedValueOnce(new Error('FACEBOOK_PUBLISH_FAILED: boom'));
    const result = await handleFacebookUpload(formData({ ids: ['1', '2'] }), 'user-1');
    expect(result.success).toBe(true);
    expect(result.results.map((entry) => entry.success)).toEqual([false, true]);
    expect(result.results[0].error).toBe('FACEBOOK_PUBLISH_FAILED: boom');
    expect(touchSocialAccount).toHaveBeenCalledTimes(1);
  });

  it('presigns the engine archive instead of uploading a copy', async () => {
    const fd = new FormData();
    fd.append('videoStoragePath', 'user-1/persona-9/task-7/final-1.mp4');
    fd.append('caption', 'my post');
    fd.append('facebookAccountIds', '111');
    const result = await handleFacebookUpload(fd, 'user-1');
    expect(result.success).toBe(true);
    expect(presignPublishMedia).toHaveBeenCalledWith('user-1/persona-9/task-7/final-1.mp4');
    expect(uploadPublishMedia).not.toHaveBeenCalled();
    expect(cleanupPublishMedia).not.toHaveBeenCalled();
    expect(vi.mocked(publishFacebookMedia).mock.calls[0][0].media).toEqual({ kind: 'video', url: 'https://s.example/archive.mp4' });
  });

  it('rejects an archive key that belongs to another user', async () => {
    const fd = new FormData();
    fd.append('videoStoragePath', 'other-user/voiceover/task-7/final-1.mp4');
    fd.append('caption', 'my post');
    fd.append('facebookAccountIds', '111');
    const result = await handleFacebookUpload(fd, 'user-1');
    expect(result.success).toBe(false);
    expect(result.results[0].error).toContain('belong to this user');
    expect(presignPublishMedia).not.toHaveBeenCalled();
  });

  it('rejects a request that sends both a file and an archive key', async () => {
    const fd = formData();
    fd.append('videoStoragePath', 'user-1/voiceover/task-7/final-1.mp4');
    const result = await handleFacebookUpload(fd, 'user-1');
    expect(result.success).toBe(false);
    expect(result.results[0].error).toContain('either a file or videoStoragePath');
  });

  it('fails as a whole when every Page fails, and a non-Error throw stays generic', async () => {
    vi.mocked(getSocialAccountTokens).mockRejectedValue('not an error');
    const result = await handleFacebookUpload(formData(), 'user-1');
    expect(result).toEqual({ success: false, results: [{ accountId: '111', success: false, error: 'Unknown error', errorCode: 'transient' }] });
    expect(cleanupPublishMedia).toHaveBeenCalledWith('facebook');
  });
});
