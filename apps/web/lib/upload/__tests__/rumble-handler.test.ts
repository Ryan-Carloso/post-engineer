// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/social-accounts', () => ({ getSocialAccountTokens: vi.fn(), touchSocialAccount: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: vi.fn(() => ({ __mock: 'service-client' })) }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/analytics', () => ({ trackApiEvent: vi.fn() }));
vi.mock('@/lib/rumble', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rumble')>()),
  uploadRumbleVideo: vi.fn(),
}));

import { trackApiEvent } from '@/lib/analytics';
import { RumbleError } from '@/lib/errors';
import { handleRumbleUpload } from '@/lib/upload/rumble-handler';
import { getSocialAccountTokens, touchSocialAccount } from '@/lib/social-accounts';
import { uploadRumbleVideo, RUMBLE_TITLE_MAX_LENGTH, RUMBLE_VIDEO_MAX_BYTES } from '@/lib/rumble';

const MP4_BYTES = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
const TOKEN = 'a'.repeat(40);

function formData(overrides: { title?: string | null; description?: string | null; video?: File | null; ids?: string[] } = {}): FormData {
  const fd = new FormData();
  const video = overrides.video === undefined ? new File([MP4_BYTES], 'clip.mp4', { type: 'video/mp4' }) : overrides.video;
  if (video !== null) fd.append('video', video);
  const title = overrides.title === undefined ? 'my video' : overrides.title;
  if (title !== null) fd.append('title', title);
  const description = overrides.description === undefined ? 'my description' : overrides.description;
  if (description !== null) fd.append('description', description);
  for (const id of overrides.ids ?? ['chan-1']) fd.append('rumbleAccountIds', id);
  return fd;
}

function tokens(value: Record<string, unknown>): never {
  return { tokens: value } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSocialAccountTokens).mockResolvedValue(tokens({ access_token: TOKEN }));
  vi.mocked(uploadRumbleVideo).mockResolvedValue({ videoId: 'vid-1', url: 'https://rumble.com/v1abcde.html' });
});

describe('handleRumbleUpload', () => {
  it("forwards the file to the channel with the stored token and records use", async () => {
    const result = await handleRumbleUpload(formData({ title: '  my video  ' }), 'user-1');
    expect(result).toEqual({
      success: true,
      results: [{ accountId: 'chan-1', success: true, postId: 'vid-1', permalink: 'https://rumble.com/v1abcde.html' }],
    });
    expect(getSocialAccountTokens).toHaveBeenCalledWith(expect.anything(), 'user-1', 'rumble', 'chan-1');
    expect(vi.mocked(uploadRumbleVideo).mock.calls[0][0]).toMatchObject({
      accessToken: TOKEN,
      channelId: 'chan-1',
      title: 'my video',
      description: 'my description',
      filename: 'video.mp4',
      contentType: 'video/mp4',
    });
    expect(touchSocialAccount).toHaveBeenCalledWith(expect.anything(), 'user-1', 'rumble', 'chan-1');
  });

  it('keeps a MOV filename and content type', async () => {
    await handleRumbleUpload(formData({ video: new File([MP4_BYTES], 'clip.mov', { type: 'video/quicktime' }) }), 'user-1');
    expect(vi.mocked(uploadRumbleVideo).mock.calls[0][0]).toMatchObject({ filename: 'clip.mov', contentType: 'video/quicktime' });
  });

  it('omits the permalink when Rumble returned no url', async () => {
    vi.mocked(uploadRumbleVideo).mockResolvedValue({ videoId: 'vid-1', url: null });
    const result = await handleRumbleUpload(formData(), 'user-1');
    expect(result.results[0]).toEqual({ accountId: 'chan-1', success: true, postId: 'vid-1' });
  });

  it.each([
    ['no channel', { ids: [] as string[] }, 'At least one Rumble channel ID'],
    ['missing title', { title: null }, 'Title is required'],
    ['blank title', { title: '   ' }, 'Title is required'],
    ['over-long title', { title: 'a'.repeat(RUMBLE_TITLE_MAX_LENGTH + 1) }, '100-character'],
    ['missing description', { description: null }, 'Description is required'],
    ['blank description', { description: '   ' }, 'Description is required'],
    ['missing video', { video: null }, 'Video file is required'],
    ['non-video bytes', { video: new File(['not a video!'], 'x.mp4', { type: 'video/mp4' }) }, 'MP4 or MOV'],
  ])('rejects %s before calling Rumble', async (_name, overrides, message) => {
    const result = await handleRumbleUpload(formData(overrides), 'user-1');
    expect(result.success).toBe(false);
    expect(result.results[0].error).toContain(message);
    expect(result.results[0].errorCode).toBe('publish_rejected');
    expect(uploadRumbleVideo).not.toHaveBeenCalled();
  });

  it('rejects a video over the 4GB cap without buffering it', async () => {
    const oversized = new File([MP4_BYTES], 'clip.mp4', { type: 'video/mp4' });
    // A real 4GB file cannot be built in a test: shadow the size getter.
    Object.defineProperty(oversized, 'size', { value: RUMBLE_VIDEO_MAX_BYTES + 1 });
    const result = await handleRumbleUpload(formData({ video: oversized }), 'user-1');
    expect(result.success).toBe(false);
    expect(result.results[0].error).toContain('Video exceeds the Rumble 4GB limit');
    expect(uploadRumbleVideo).not.toHaveBeenCalled();
  });

  it('accepts a title exactly at the limit', async () => {
    const result = await handleRumbleUpload(formData({ title: 'a'.repeat(RUMBLE_TITLE_MAX_LENGTH) }), 'user-1');
    expect(result.success).toBe(true);
  });

  it('reports a channel without a stored token without calling Rumble', async () => {
    vi.mocked(getSocialAccountTokens).mockResolvedValue(tokens({}));
    const result = await handleRumbleUpload(formData(), 'user-1');
    expect(result).toEqual({
      success: false,
      results: [{ accountId: 'chan-1', success: false, error: 'Rumble access token not found', errorCode: 'token_missing' }],
    });
    expect(uploadRumbleVideo).not.toHaveBeenCalled();
  });

  it('emits publish_account_unauthorized when Rumble rejects the token as invalid', async () => {
    vi.mocked(uploadRumbleVideo).mockRejectedValueOnce(
      new RumbleError('invalid_token', 'RUMBLE_PUBLISH_FAILED: Invalid access token', 401),
    );
    const result = await handleRumbleUpload(formData(), 'user-1');
    expect(result.results[0]).toEqual({
      accountId: 'chan-1',
      success: false,
      error: 'RUMBLE_PUBLISH_FAILED: Invalid access token',
      errorCode: 'token_expired',
    });
    expect(trackApiEvent).toHaveBeenCalledWith('publish_account_unauthorized', {
      provider: 'rumble',
      account_id: 'chan-1',
      user_id: 'user-1',
      status: 401,
    });
  });

  it('does not emit publish_account_unauthorized when the failure is not an invalid token', async () => {
    vi.mocked(uploadRumbleVideo).mockRejectedValueOnce(new RumbleError('upload_failed', 'RUMBLE_PUBLISH_FAILED: boom', 500));
    const result = await handleRumbleUpload(formData(), 'user-1');
    expect(result.results[0].errorCode).toBe('transient');
    expect(trackApiEvent).not.toHaveBeenCalled();
  });

  it('keeps going after one channel fails and is a success if any landed', async () => {
    vi.mocked(uploadRumbleVideo).mockRejectedValueOnce(new Error('RUMBLE_PUBLISH_FAILED: boom'));
    const result = await handleRumbleUpload(formData({ ids: ['1', '2'] }), 'user-1');
    expect(result.success).toBe(true);
    expect(result.results.map((entry) => entry.success)).toEqual([false, true]);
    expect(result.results[0].error).toBe('RUMBLE_PUBLISH_FAILED: boom');
    expect(result.results[0].errorCode).toBe('transient');
    expect(touchSocialAccount).toHaveBeenCalledTimes(1);
  });

  it('fails as a whole when every channel fails, and a non-Error throw stays generic', async () => {
    vi.mocked(getSocialAccountTokens).mockRejectedValue('not an error');
    const result = await handleRumbleUpload(formData(), 'user-1');
    expect(result).toEqual({
      success: false,
      results: [{ accountId: 'chan-1', success: false, error: 'Unknown error', errorCode: 'transient' }],
    });
  });
});
