// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/social-accounts', () => ({ getSocialAccountTokens: vi.fn(), touchSocialAccount: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: vi.fn(() => ({ __mock: 'service-client' })) }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/analytics', () => ({ trackApiEvent: vi.fn() }));
vi.mock('@/lib/threespeak', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/threespeak')>()),
  publishThreespeakVideo: vi.fn(),
}));

import { trackApiEvent } from '@/lib/analytics';
import { ThreespeakError } from '@/lib/threespeak';
import { handleThreespeakUpload } from '@/lib/upload/threespeak-handler';
import { getSocialAccountTokens, touchSocialAccount } from '@/lib/social-accounts';
import { publishThreespeakVideo } from '@/lib/threespeak';

const MP4_BYTES = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);

function formData(overrides: { caption?: string | null; video?: File | null; ids?: string[] } = {}): FormData {
  const fd = new FormData();
  const video = overrides.video === undefined ? new File([MP4_BYTES], 'clip.mp4', { type: 'video/mp4' }) : overrides.video;
  if (video !== null) fd.append('video', video);
  const caption = overrides.caption === undefined ? 'my post' : overrides.caption;
  if (caption !== null) fd.append('caption', caption);
  for (const id of overrides.ids ?? ['alice']) fd.append('threespeakAccountIds', id);
  return fd;
}

function tokens(value: Record<string, unknown>): never {
  return { tokens: value } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSocialAccountTokens).mockResolvedValue(tokens({ access_token: '5Kpostingkey', handle: 'alice' }));
  vi.mocked(publishThreespeakVideo).mockResolvedValue({ videoId: 'video-1', permalink: 'https://3speak.tv/watch?v=alice/my-video' });
});

describe('handleThreespeakUpload', () => {
  it("publishes the stored video to the owner's Hive account and records use", async () => {
    const result = await handleThreespeakUpload(formData({ caption: '  my post  ' }), 'user-1');
    expect(result).toEqual({
      success: true,
      results: [{ accountId: 'alice', success: true, postId: 'video-1', permalink: 'https://3speak.tv/watch?v=alice/my-video' }],
    });
    expect(getSocialAccountTokens).toHaveBeenCalledWith(expect.anything(), 'user-1', '3speak', 'alice');
    expect(vi.mocked(publishThreespeakVideo).mock.calls[0][0]).toMatchObject({
      username: 'alice',
      postingKey: '5Kpostingkey',
      filename: 'clip.mp4',
      contentType: 'video/mp4',
      caption: 'my post',
    });
    expect(touchSocialAccount).toHaveBeenCalledWith(expect.anything(), 'user-1', '3speak', 'alice');
  });

  it('omits the permalink when 3Speak returned no permlink', async () => {
    vi.mocked(publishThreespeakVideo).mockResolvedValue({ videoId: 'video-1', permalink: null });
    const result = await handleThreespeakUpload(formData(), 'user-1');
    expect(result.results[0]).toEqual({ accountId: 'alice', success: true, postId: 'video-1' });
  });

  it.each([
    ['no account', { ids: [] as string[] }, 'At least one 3Speak account is required'],
    ['missing caption', { caption: null }, 'Caption is required'],
    ['blank caption', { caption: '   ' }, 'Caption is required'],
    ['missing video', { video: null }, 'Video file is required'],
    ['non-video bytes', { video: new File(['not a video!'], 'x.mp4', { type: 'video/mp4' }) }, 'MP4 or MOV'],
  ])('rejects %s before calling 3Speak', async (_name, overrides, message) => {
    const result = await handleThreespeakUpload(formData(overrides), 'user-1');
    expect(result.success).toBe(false);
    expect(result.results[0].error).toContain(message);
    expect(publishThreespeakVideo).not.toHaveBeenCalled();
  });

  it('reports an account without a stored posting key without calling 3Speak', async () => {
    vi.mocked(getSocialAccountTokens).mockResolvedValue(tokens({}));
    const result = await handleThreespeakUpload(formData(), 'user-1');
    expect(result).toEqual({ success: false, results: [{ accountId: 'alice', success: false, error: '3Speak posting key not found' }] });
    expect(publishThreespeakVideo).not.toHaveBeenCalled();
  });

  it('reports an account without a stored Hive username without calling 3Speak', async () => {
    vi.mocked(getSocialAccountTokens).mockResolvedValue(tokens({ access_token: '5Kpostingkey' }));
    const result = await handleThreespeakUpload(formData(), 'user-1');
    expect(result).toEqual({ success: false, results: [{ accountId: 'alice', success: false, error: '3Speak Hive username not found' }] });
    expect(publishThreespeakVideo).not.toHaveBeenCalled();
  });

  it('emits publish_account_unauthorized when the stored posting key is dead', async () => {
    vi.mocked(publishThreespeakVideo).mockRejectedValueOnce(
      new ThreespeakError('invalid_credentials', 'Could not decrypt the 3Speak login memo with this posting key.'),
    );
    const result = await handleThreespeakUpload(formData(), 'user-1');
    expect(result.results[0]).toEqual({
      accountId: 'alice',
      success: false,
      error: 'Could not decrypt the 3Speak login memo with this posting key.',
    });
    expect(trackApiEvent).toHaveBeenCalledWith('publish_account_unauthorized', {
      provider: '3speak',
      account_id: 'alice',
      user_id: 'user-1',
      status: 401,
    });
  });

  it('continues with the remaining accounts after one fails', async () => {
    vi.mocked(publishThreespeakVideo)
      .mockRejectedValueOnce(new Error('upload failed'))
      .mockResolvedValueOnce({ videoId: 'video-2', permalink: null });
    const result = await handleThreespeakUpload(formData({ ids: ['alice', 'bob'] }), 'user-1');
    expect(result.success).toBe(true);
    expect(result.results).toEqual([
      { accountId: 'alice', success: false, error: 'upload failed' },
      { accountId: 'bob', success: true, postId: 'video-2' },
    ]);
  });
});
