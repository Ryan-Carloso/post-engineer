// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/social-accounts', () => ({ touchSocialAccount: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: vi.fn(() => ({ __mock: 'service-client' })) }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/analytics', () => ({ trackApiEvent: vi.fn() }));
vi.mock('@/lib/pinterest-tokens', () => ({ getValidPinterestAccessToken: vi.fn(async () => 'at-1') }));
vi.mock('@/lib/pinterest', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/pinterest')>()),
  publishPinterestVideo: vi.fn(),
}));

import { trackApiEvent } from '@/lib/analytics';
import { PinterestError } from '@/lib/errors';
import { handlePinterestUpload } from '@/lib/upload/pinterest-handler';
import { getValidPinterestAccessToken } from '@/lib/pinterest-tokens';
import { touchSocialAccount } from '@/lib/social-accounts';
import {
  publishPinterestVideo,
  PINTEREST_TITLE_MAX_CHARS,
  PINTEREST_DESCRIPTION_MAX_CHARS,
} from '@/lib/pinterest';

const MP4_BYTES = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);

function formData(
  overrides: {
    title?: string | null;
    description?: string | null;
    caption?: string | null;
    boardId?: string | null;
    video?: File | null;
    ids?: string[];
    coverImageUrl?: string | null;
  } = {},
): FormData {
  const fd = new FormData();
  const video = overrides.video === undefined ? new File([MP4_BYTES], 'clip.mp4', { type: 'video/mp4' }) : overrides.video;
  if (video !== null) fd.append('video', video);
  const title = overrides.title === undefined ? 'My pin' : overrides.title;
  if (title !== null) fd.append('title', title);
  const description = overrides.description === undefined ? 'The description' : overrides.description;
  if (description !== null) fd.append('description', description);
  const caption = overrides.caption === undefined ? null : overrides.caption;
  if (caption !== null) fd.append('caption', caption);
  const boardId = overrides.boardId === undefined ? 'board-1' : overrides.boardId;
  if (boardId !== null) fd.append('boardId', boardId);
  const coverImageUrl = overrides.coverImageUrl === undefined ? null : overrides.coverImageUrl;
  if (coverImageUrl !== null) fd.append('coverImageUrl', coverImageUrl);
  for (const id of overrides.ids ?? ['user-9']) fd.append('pinterestAccountIds', id);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getValidPinterestAccessToken).mockResolvedValue('at-1');
  vi.mocked(publishPinterestVideo).mockResolvedValue({
    pinId: '123456789',
    permalink: 'https://www.pinterest.com/pin/123456789/',
  });
});

describe('handlePinterestUpload', () => {
  it("publishes the video as a Pin on the board with the account's token and records use", async () => {
    const result = await handlePinterestUpload(formData(), 'user-1');
    expect(result).toEqual({
      success: true,
      results: [{ accountId: 'user-9', success: true, postId: '123456789', permalink: 'https://www.pinterest.com/pin/123456789/' }],
    });
    expect(getValidPinterestAccessToken).toHaveBeenCalledWith(expect.anything(), 'user-1', 'user-9');
    expect(vi.mocked(publishPinterestVideo).mock.calls[0][0]).toMatchObject({
      accessToken: 'at-1',
      boardId: 'board-1',
      title: 'My pin',
      description: 'The description',
      contentType: 'video/mp4',
    });
    expect(vi.mocked(publishPinterestVideo).mock.calls[0][0].filename).toMatch(/^pinterest_\d+_[0-9a-f]{8}\.mp4$/);
    expect(touchSocialAccount).toHaveBeenCalledWith(expect.anything(), 'user-1', 'pinterest', 'user-9');
  });

  it('uses the caption as the pin description when no description is sent', async () => {
    await handlePinterestUpload(formData({ description: null, caption: 'caption text' }), 'user-1');
    expect(vi.mocked(publishPinterestVideo).mock.calls[0][0]).toMatchObject({ description: 'caption text' });
  });

  it('stores a MOV upload as quicktime', async () => {
    await handlePinterestUpload(
      formData({ video: new File([MP4_BYTES], 'clip.mov', { type: 'video/quicktime' }) }),
      'user-1',
    );
    expect(vi.mocked(publishPinterestVideo).mock.calls[0][0].filename).toMatch(/\.mov$/);
    expect(vi.mocked(publishPinterestVideo).mock.calls[0][0].contentType).toBe('video/quicktime');
  });

  it('passes a cover image URL through', async () => {
    await handlePinterestUpload(formData({ coverImageUrl: 'https://cdn.example/frame.jpg' }), 'user-1');
    expect(vi.mocked(publishPinterestVideo).mock.calls[0][0]).toMatchObject({ coverImageUrl: 'https://cdn.example/frame.jpg' });
  });

  it.each([
    ['no account', { ids: [] as string[] }, 'At least one Pinterest account ID'],
    ['missing boardId', { boardId: null }, 'board is required'],
    ['blank boardId', { boardId: '   ' }, 'board is required'],
    ['over-long title', { title: 'a'.repeat(PINTEREST_TITLE_MAX_CHARS + 1) }, '100-character'],
    ['over-long description', { description: 'a'.repeat(PINTEREST_DESCRIPTION_MAX_CHARS + 1) }, '800-character'],
    ['over-long caption', { description: null, caption: 'a'.repeat(PINTEREST_DESCRIPTION_MAX_CHARS + 1) }, '800-character'],
    ['missing video', { video: null }, 'Video file is required'],
    ['non-video bytes', { video: new File(['not a video!'], 'x.mp4', { type: 'video/mp4' }) }, 'MP4 or MOV'],
  ])('rejects %s before publishing anything', async (_name, overrides, message) => {
    const result = await handlePinterestUpload(formData(overrides), 'user-1');
    expect(result.success).toBe(false);
    expect(result.results[0].error).toContain(message);
    expect(publishPinterestVideo).not.toHaveBeenCalled();
  });

  it('accepts a title and a description exactly at the limits', async () => {
    const result = await handlePinterestUpload(
      formData({ title: 'a'.repeat(PINTEREST_TITLE_MAX_CHARS), description: 'a'.repeat(PINTEREST_DESCRIPTION_MAX_CHARS) }),
      'user-1',
    );
    expect(result.success).toBe(true);
  });

  it('emits publish_account_unauthorized when Pinterest rejects the token with 401', async () => {
    vi.mocked(publishPinterestVideo).mockRejectedValueOnce(
      new PinterestError('PINTEREST_PUBLISH_FAILED: Invalid access token', 401),
    );
    const result = await handlePinterestUpload(formData(), 'user-1');
    expect(result.results[0]).toEqual({ accountId: 'user-9', success: false, error: 'PINTEREST_PUBLISH_FAILED: Invalid access token' });
    expect(trackApiEvent).toHaveBeenCalledWith('publish_account_unauthorized', {
      provider: 'pinterest',
      account_id: 'user-9',
      user_id: 'user-1',
      status: 401,
    });
  });

  it('does not emit publish_account_unauthorized when the Pinterest failure is not a 401', async () => {
    vi.mocked(publishPinterestVideo).mockRejectedValueOnce(new PinterestError('PINTEREST_PUBLISH_FAILED: boom', 500));
    await handlePinterestUpload(formData(), 'user-1');
    expect(trackApiEvent).not.toHaveBeenCalled();
  });

  it('keeps going after one account fails and is a success if any landed', async () => {
    vi.mocked(publishPinterestVideo).mockRejectedValueOnce(new Error('PINTEREST_PUBLISH_FAILED: boom'));
    const result = await handlePinterestUpload(formData({ ids: ['a-1', 'a-2'] }), 'user-1');
    expect(result.success).toBe(true);
    expect(result.results.map((entry) => entry.success)).toEqual([false, true]);
    expect(result.results[0].error).toBe('PINTEREST_PUBLISH_FAILED: boom');
    expect(touchSocialAccount).toHaveBeenCalledTimes(1);
  });

  it('fails as a whole when every account fails, and a non-Error throw stays generic', async () => {
    vi.mocked(getValidPinterestAccessToken).mockRejectedValue('not an error');
    const result = await handlePinterestUpload(formData(), 'user-1');
    expect(result).toEqual({ success: false, results: [{ accountId: 'user-9', success: false, error: 'Unknown error' }] });
  });
});
