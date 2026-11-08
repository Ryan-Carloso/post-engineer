// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/social-accounts', () => ({ getSocialAccountTokens: vi.fn(), touchSocialAccount: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: vi.fn(() => ({ __mock: 'service-client' })) }));
vi.mock('@/lib/upload/handlers', () => ({ uploadToStorage: vi.fn(async () => 'https://s.example/signed.mp4'), cleanupOldUploads: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/facebook', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/facebook')>()),
  publishFacebookVideo: vi.fn(),
}));

import { handleFacebookUpload } from '@/lib/upload/facebook-handler';
import { getSocialAccountTokens, touchSocialAccount } from '@/lib/social-accounts';
import { cleanupOldUploads, uploadToStorage } from '@/lib/upload/handlers';
import { publishFacebookVideo, FACEBOOK_TEXT_MAX_CHARS } from '@/lib/facebook';
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
  vi.mocked(publishFacebookVideo).mockResolvedValue({ postId: 'vid-1', permalink: 'https://www.facebook.com/111/videos/vid-1/' });
});

describe('handleFacebookUpload', () => {
  it("publishes the stored video to the owner's Page with its Page token and records use", async () => {
    const result = await handleFacebookUpload(formData({ caption: '  my post  ' }), 'user-1');
    expect(result).toEqual({
      success: true,
      results: [{ accountId: '111', success: true, postId: 'vid-1', permalink: 'https://www.facebook.com/111/videos/vid-1/' }],
    });
    expect(getSocialAccountTokens).toHaveBeenCalledWith(expect.anything(), 'user-1', 'facebook', '111');
    expect(vi.mocked(publishFacebookVideo).mock.calls[0][0]).toMatchObject({
      pageAccessToken: 'page-tok',
      pageId: '111',
      videoUrl: 'https://s.example/signed.mp4',
      description: 'my post',
    });
    expect(vi.mocked(uploadToStorage).mock.calls[0][1]).toMatch(/^facebook\/\d+_[0-9a-f]{8}\.mp4$/);
    expect(vi.mocked(uploadToStorage).mock.calls[0][2]).toBe('video/mp4');
    expect(touchSocialAccount).toHaveBeenCalledWith(expect.anything(), 'user-1', 'facebook', '111');
    expect(cleanupOldUploads).toHaveBeenCalledWith('facebook');
  });

  it('stores a MOV upload as quicktime', async () => {
    await handleFacebookUpload(formData({ video: new File([MP4_BYTES], 'clip.mov', { type: 'video/quicktime' }) }), 'user-1');
    expect(vi.mocked(uploadToStorage).mock.calls[0][1]).toMatch(/\.mov$/);
    expect(vi.mocked(uploadToStorage).mock.calls[0][2]).toBe('video/quicktime');
  });

  it('omits the permalink when Facebook returned none', async () => {
    vi.mocked(publishFacebookVideo).mockResolvedValue({ postId: 'vid-1', permalink: null });
    const result = await handleFacebookUpload(formData(), 'user-1');
    expect(result.results[0]).toEqual({ accountId: '111', success: true, postId: 'vid-1' });
  });

  it('logs a failed permalink read without failing the publish', async () => {
    await handleFacebookUpload(formData(), 'user-1');
    const { onPermalinkError } = vi.mocked(publishFacebookVideo).mock.calls[0][0];
    onPermalinkError(new Error('FACEBOOK_PERMALINK_FAILED: nope'));
    expect(logger.warn).toHaveBeenCalledWith('upload-content/facebook: permalink read failed', {
      accountId: '111',
      error: 'Error: FACEBOOK_PERMALINK_FAILED: nope',
    });
  });

  it.each([
    ['no Page', { ids: [] as string[] }, 'At least one Facebook Page ID'],
    ['missing caption', { caption: null }, 'Caption is required'],
    ['blank caption', { caption: '   ' }, 'Caption is required'],
    ['over-long caption', { caption: 'a'.repeat(FACEBOOK_TEXT_MAX_CHARS + 1) }, '63206-character'],
    ['missing video', { video: null }, 'Video file is required'],
    ['non-video bytes', { video: new File(['not a video!'], 'x.mp4', { type: 'video/mp4' }) }, 'MP4 or MOV'],
  ])('rejects %s before storing anything', async (_name, overrides, message) => {
    const result = await handleFacebookUpload(formData(overrides), 'user-1');
    expect(result.success).toBe(false);
    expect(result.results[0].error).toContain(message);
    expect(uploadToStorage).not.toHaveBeenCalled();
    expect(publishFacebookVideo).not.toHaveBeenCalled();
  });

  it('accepts a caption exactly at the limit', async () => {
    const result = await handleFacebookUpload(formData({ caption: 'a'.repeat(FACEBOOK_TEXT_MAX_CHARS) }), 'user-1');
    expect(result.success).toBe(true);
  });

  it('reports a Page without a stored token without calling Facebook', async () => {
    vi.mocked(getSocialAccountTokens).mockResolvedValue(tokens({}));
    const result = await handleFacebookUpload(formData(), 'user-1');
    expect(result).toEqual({ success: false, results: [{ accountId: '111', success: false, error: 'Facebook Page token not found' }] });
    expect(publishFacebookVideo).not.toHaveBeenCalled();
  });

  it('keeps going after one Page fails and is a success if any landed', async () => {
    vi.mocked(publishFacebookVideo).mockRejectedValueOnce(new Error('FACEBOOK_PUBLISH_FAILED: boom'));
    const result = await handleFacebookUpload(formData({ ids: ['1', '2'] }), 'user-1');
    expect(result.success).toBe(true);
    expect(result.results.map((entry) => entry.success)).toEqual([false, true]);
    expect(result.results[0].error).toBe('FACEBOOK_PUBLISH_FAILED: boom');
    expect(touchSocialAccount).toHaveBeenCalledTimes(1);
  });

  it('fails as a whole when every Page fails, and a non-Error throw stays generic', async () => {
    vi.mocked(getSocialAccountTokens).mockRejectedValue('not an error');
    const result = await handleFacebookUpload(formData(), 'user-1');
    expect(result).toEqual({ success: false, results: [{ accountId: '111', success: false, error: 'Unknown error' }] });
    expect(cleanupOldUploads).toHaveBeenCalledWith('facebook');
  });
});
