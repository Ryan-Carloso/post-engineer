import { describe, it, expect, vi } from 'vitest';
import {
  buildUploadErrorResponse,
  handleInstagramUpload,
  handleYoutubeUpload,
} from '@/lib/upload/handlers';
import { ValidationError, AuthError, UploadError, InstagramApiError } from '@/lib/errors';
import { trackApiEvent } from '@/lib/analytics';
import { markAccountNeedsReconnect } from '@/lib/account-needs-reconnect';
import { TokenDecryptError } from '@/lib/token-crypto';
import { AccountNotFoundError } from '@/lib/errors';
import { postYouTubeFirstComment } from '@/lib/first-comment/youtube';
import { postInstagramFirstComment } from '@/lib/first-comment/instagram';
import { FirstCommentError } from '@/lib/first-comment/http';

vi.mock('@/lib/analytics', () => ({ trackApiEvent: vi.fn() }));
vi.mock('@/lib/account-needs-reconnect', () => ({ markAccountNeedsReconnect: vi.fn(async () => undefined) }));

vi.mock('@/lib/logger', () => ({
  logger: {
    generateLogId: () => 'test-log-id',
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    logUploadStart: vi.fn(),
    logUploadProgress: vi.fn(),
    logUploadSuccess: vi.fn(),
    logUploadError: vi.fn(),
  },
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          encrypted_tokens: 'v1.xxx.xxx.xxx',
          user_id: 'u1',
          provider_account_id: 'acc1',
          account_name: 'Test Account',
          account_metadata: {},
          token_expires_at: null,
        },
        error: null,
      }),
      single: vi.fn().mockResolvedValue({
        data: {
          id: 'acc1',
          user_id: 'u1',
          provider: 'instagram',
          provider_account_id: 'ig-1',
          account_name: 'Test',
          account_metadata: {},
          token_expires_at: null,
        },
        error: null,
      }),
    })),
  })),
}));

vi.mock('@/lib/upload/publish-media', () => ({
  uploadPublishMedia: vi.fn(async () => 'https://acct.r2.cloudflarestorage.com/videos/publish-media/instagram/x.jpg?X-Amz-Signature=s'),
  presignPublishMedia: vi.fn(async () => 'https://acct.r2.cloudflarestorage.com/videos/u1/voiceover/task-7/final-1.mp4?X-Amz-Signature=a'),
  cleanupPublishMedia: vi.fn(async () => 0),
}));

vi.mock('@/lib/social-accounts', () => ({
  getSocialAccountTokens: vi.fn().mockResolvedValue({
    tokens: { access_token: 'ig-token', expiry_date: Date.now() + 86400000 },
    account: { id: 'acc1', userId: 'u1', provider: 'instagram' },
  }),
  touchSocialAccount: vi.fn(),
}));

vi.mock('@/lib/instagram', () => {
  return {
    InstagramService: vi.fn().mockImplementation(function () {
      return {
        publishMedia: vi.fn().mockResolvedValue({
          mediaId: 'm1',
          postId: 'p1',
          permalink: 'https://ig.com/p/abc',
        }),
      };
    }),
  };
});

vi.mock('@/lib/youtube', () => ({
  createGoogleOAuth2Client: vi.fn().mockResolvedValue({
    setCredentials: vi.fn(),
    refreshAccessToken: vi.fn().mockResolvedValue({ credentials: {} }),
  }),
  createVideoMetadata: vi.fn((opts) => ({
    snippet: {
      title: opts.title,
      description: opts.description || '',
      tags: opts.tags || [],
      categoryId: opts.categoryId || '22',
    },
    status: {
      privacyStatus: opts.privacyStatus || 'public',
      selfDeclaredMadeForKids: false,
    },
  })),
  uploadYouTubeVideo: vi.fn().mockResolvedValue({ id: 'yt-123', url: 'https://youtube.com/watch?v=yt-123' }),
}));

vi.mock('@/lib/first-comment/youtube', () => ({ postYouTubeFirstComment: vi.fn() }));
vi.mock('@/lib/first-comment/instagram', () => ({ postInstagramFirstComment: vi.fn() }));

vi.mock('@/lib/timeout', () => ({
  withUploadTimeout: vi.fn((p: Promise<unknown>) => p),
}));

vi.mock('@/lib/media/upload-schema', async (importOriginal) => ({
  MAX_FILE_SIZE: (await importOriginal<typeof import('@/lib/media/upload-schema')>()).MAX_FILE_SIZE,
  parseMediaUpload: vi.fn((_file: unknown, buffer: unknown) => ({
    success: true,
    detectedType: 'image/jpeg',
    buffer,
    issues: [],
  })),
}));

vi.mock('@/lib/media/magic-bytes', () => ({
  detectMagicMimeType: vi.fn(() => 'image/jpeg'),
}));

vi.mock('crypto', async () => {
  const actual = await vi.importActual<typeof import('crypto')>('crypto');
  return { ...actual, default: { ...actual, randomBytes: vi.fn(() => ({ toString: () => 'abc123' })) } };
});

describe('buildUploadErrorResponse', () => {
  const startTime = Date.now() - 1000;

  it('returns 400 for ValidationError with a field', async () => {
    const error = new ValidationError('Title is required', 'title');
    const response = buildUploadErrorResponse(error, 'log-1', startTime);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Title is required');
    expect(body.suggestions).toContain('Field "title" is invalid');
  });

  it('returns 400 for ValidationError without a field', async () => {
    const error = new ValidationError('No video file was sent');
    const response = buildUploadErrorResponse(error, 'log-1', startTime);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('No video file was sent');
    expect(body.suggestions).toContain('Check the submitted data');
  });

  it('returns 401 for AuthError (original message preserved)', async () => {
    const error = new AuthError('Token expired', 'invalid_token');
    const response = buildUploadErrorResponse(error, 'log-1', startTime);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Token expired');
    expect(body.suggestions).toContain('Start the OAuth flow again via /api/google-oauth/start');
  });

  it('returns 500 for UploadError', async () => {
    const error = new UploadError('Connection timeout', 'upload');
    const response = buildUploadErrorResponse(error, 'log-1', startTime);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Upload processing failed. Please try again.');
    expect(body.suggestions).toContain('Try again on a faster connection');
  });

  it('returns 500 for a generic error', async () => {
    const error = new Error('Something unexpected');
    const response = buildUploadErrorResponse(error, 'log-1', startTime);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Upload processing failed. Please try again.');
    expect(body.errorType).toBe('Error');
    expect(body.suggestions).toContain('Try again');
  });

  it('returns 500 for a non-Error thrown value (string/undefined)', async () => {
    const response = buildUploadErrorResponse('raw string error', 'log-1', startTime);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.errorType).toBe('UNKNOWN_ERROR');
  });

  it('includes logId and metadata.duration in the response', async () => {
    const error = new Error('test');
    const response = buildUploadErrorResponse(error, 'my-log-id', startTime);
    const body = await response.json();

    expect(body.logId).toBe('my-log-id');
    expect(body.metadata).toBeDefined();
    expect(typeof body.metadata.duration).toBe('number');
  });
});

describe('handleInstagramUpload', () => {
  const logId = 'ig-log-1';
  const startTime = Date.now() - 500;
  const OWNER_USER_ID = 'u1';

  function makeFormData(fields: Record<string, string>, file?: File, accountId = 'ig-user-1'): FormData {
    const fd = new FormData();
    fd.set('igAccountIds', accountId);
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    if (file) fd.set('file', file);
    return fd;
  }

  it('returns success with permalink on valid image upload', async () => {
    const file = new File([new Uint8Array(100)], 'photo.jpg', { type: 'image/jpeg' });
    const formData = makeFormData({ caption: 'Nice photo' }, file);

    const response = await handleInstagramUpload(formData, OWNER_USER_ID, logId, startTime);

    expect(response.success).toBe(true);
    if (response.success) {
      expect(response.provider).toBe('instagram');
      expect(response.results).toHaveLength(1);
      expect(response.results[0].success).toBe(true);
      expect(response.results[0].permalink).toBe('https://ig.com/p/abc');
    }
  });

  it('rejects a file above the size cap without copying it into memory', async () => {
    const { MAX_FILE_SIZE, parseMediaUpload } = await vi.importActual<
      typeof import('@/lib/media/upload-schema')
        >('@/lib/media/upload-schema');
    const file = new File([new Uint8Array(10)], 'big.jpg', { type: 'image/jpeg' });
    Object.defineProperty(file, 'size', { value: MAX_FILE_SIZE + 1 });
    const arrayBuffer = vi.spyOn(file, 'arrayBuffer');
    const mocked = await import('@/lib/media/upload-schema');
    vi.mocked(mocked.parseMediaUpload).mockImplementationOnce(parseMediaUpload);

    await expect(
      handleInstagramUpload(makeFormData({ caption: 'x' }, file), OWNER_USER_ID, logId, startTime),
    ).rejects.toThrow(ValidationError);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('throws ValidationError when caption is missing', async () => {
    const file = new File([new Uint8Array(10)], 'img.jpg', { type: 'image/jpeg' });
    const fd = new FormData();
    fd.set('igAccountIds', 'ig-user-1');
    fd.set('file', file);

    await expect(handleInstagramUpload(fd, OWNER_USER_ID, logId, startTime)).rejects.toThrow(
      ValidationError,
    );
  });

  it('throws ValidationError when no igAccountIds', async () => {
    const fd = new FormData();
    fd.set('caption', 'Test');
    fd.set('file', new File([new Uint8Array(10)], 'f.jpg', { type: 'image/jpeg' }));

    await expect(handleInstagramUpload(fd, OWNER_USER_ID, logId, startTime)).rejects.toThrow(
      ValidationError,
    );
  });

  it('throws ValidationError when file is invalid', async () => {
    const { parseMediaUpload } = await import('@/lib/media/upload-schema');
    vi.mocked(parseMediaUpload).mockReturnValueOnce({
      success: false,
      issues: [{ code: 'FILE_EMPTY', message: 'empty', path: ['file'] }],
    } as never);

    const fd = new FormData();
    fd.set('igAccountIds', 'ig-1');
    fd.set('caption', 'Test');
    fd.set('file', new File([], 'empty.jpg', { type: 'image/jpeg' }));

    await expect(handleInstagramUpload(fd, OWNER_USER_ID, logId, startTime)).rejects.toThrow(
      ValidationError,
    );

    vi.mocked(parseMediaUpload).mockReturnValue({
      success: true,
      detectedType: 'image/jpeg',
      buffer: Buffer.alloc(100),
      issues: [],
    } as never);
  });

  it('returns error result when the account does not belong to the owner (does not throw)', async () => {
    const { getSocialAccountTokens } = await import('@/lib/social-accounts');
    vi.mocked(getSocialAccountTokens).mockRejectedValueOnce(new AuthError('Account ig-user-1 not found', 'account_not_found'));

    const file = new File([new Uint8Array(50)], 'img.jpg', { type: 'image/jpeg' });
    const fd = makeFormData({ caption: 'Test' }, file);

    const response = await handleInstagramUpload(fd, OWNER_USER_ID, logId, startTime);

    expect(response.success).toBe(true);
    if (response.success) {
      expect(response.results[0].success).toBe(false);
      expect(response.results[0].error).toContain('not found');
    }

    vi.mocked(getSocialAccountTokens).mockResolvedValue({
      tokens: { access_token: 'ig-token', expiry_date: Date.now() + 86400000 },
      account: {
        id: 'acc1',
        userId: 'u1',
        provider: 'instagram',
        providerAccountId: 'ig-1',
        accountName: 'Test',
        accountMetadata: {},
        tokenExpiresAt: null,
        createdAt: '',
        updatedAt: '',
        lastUsedAt: null,
      } as never,
    });
  });

  it('returns error result when publishMedia fails (does not throw)', async () => {
    const { InstagramService } = await import('@/lib/instagram');
    vi.mocked(InstagramService).mockImplementationOnce(function () {
      return {
        publishMedia: vi.fn().mockRejectedValue(new InstagramApiError('Publish failed', 400)),
      } as never;
    });

    const file = new File([new Uint8Array(50)], 'img.jpg', { type: 'image/jpeg' });
    const fd = makeFormData({ caption: 'Test' }, file);

    const response = await handleInstagramUpload(fd, OWNER_USER_ID, logId, startTime);

    expect(response.success).toBe(true);
    if (response.success) {
      expect(response.results[0].success).toBe(false);
      expect(response.results[0].error).toContain('Publish failed');
    }
  });

  it('emits publish_account_unauthorized for the instagram account the provider rejected with 401', async () => {
    const { InstagramService } = await import('@/lib/instagram');
    vi.mocked(trackApiEvent).mockClear();
    vi.mocked(InstagramService).mockImplementationOnce(function () {
      return {
        publishMedia: vi.fn().mockRejectedValue(new InstagramApiError('Invalid OAuth access token', 401)),
      } as never;
    });
    const file = new File([new Uint8Array(50)], 'img.jpg', { type: 'image/jpeg' });

    await handleInstagramUpload(makeFormData({ caption: 'Test' }, file), OWNER_USER_ID, logId, startTime);

    expect(trackApiEvent).toHaveBeenCalledWith('publish_account_unauthorized', {
      provider: 'instagram',
      account_id: expect.any(String),
      user_id: OWNER_USER_ID,
      status: 401,
    });
  });

  it('does not emit publish_account_unauthorized when the instagram failure is not a 401', async () => {
    const { InstagramService } = await import('@/lib/instagram');
    vi.mocked(trackApiEvent).mockClear();
    vi.mocked(InstagramService).mockImplementationOnce(function () {
      return {
        publishMedia: vi.fn().mockRejectedValue(new InstagramApiError('Publish failed', 400)),
      } as never;
    });
    const file = new File([new Uint8Array(50)], 'img.jpg', { type: 'image/jpeg' });

    await handleInstagramUpload(makeFormData({ caption: 'Test' }, file), OWNER_USER_ID, logId, startTime);

    expect(trackApiEvent).not.toHaveBeenCalled();
  });

  it('handles multiple account IDs', async () => {
    const { InstagramService } = await import('@/lib/instagram');
    const publishMedia = vi.fn().mockResolvedValue({
      mediaId: 'm1',
      postId: 'p1',
      permalink: 'https://ig.com/p/1',
    });
    vi.mocked(InstagramService).mockImplementationOnce(function () {
      return { publishMedia } as never;
    });

    const file = new File([new Uint8Array(50)], 'img.jpg', { type: 'image/jpeg' });
    const fd = new FormData();
    fd.set('caption', 'Test');
    fd.set('file', file);
    fd.append('igAccountIds', 'ig-1');
    fd.append('igAccountIds', 'ig-2');

    const response = await handleInstagramUpload(fd, OWNER_USER_ID, logId, startTime);

    expect(response.success).toBe(true);
    if (response.success) {
      expect(response.results).toHaveLength(2);
      expect(response.results.every((r) => r.success)).toBe(true);
    }
  });

  it('stores the media on R2, hands Instagram the presigned URL and cleans up old instagram media', async () => {
    const { uploadPublishMedia, cleanupPublishMedia } = await import('@/lib/upload/publish-media');
    const { InstagramService } = await import('@/lib/instagram');
    const publishMedia = vi.fn(async (..._args: unknown[]) => ({ postId: 'p1', mediaId: 'm1', permalink: 'https://instagram.com/p/1' }));
    vi.mocked(InstagramService).mockImplementationOnce(function () {
      return { publishMedia } as never;
    });
    vi.mocked(uploadPublishMedia).mockClear();
    vi.mocked(cleanupPublishMedia).mockClear();

    const file = new File([new Uint8Array(50)], 'img.jpg', { type: 'image/jpeg' });
    await handleInstagramUpload(makeFormData({ caption: 'Test' }, file), OWNER_USER_ID, logId, startTime);

    expect(vi.mocked(uploadPublishMedia).mock.calls[0][1]).toMatch(/^instagram\/\d+_abc123\.jpg$/);
    expect(publishMedia.mock.calls[0][3]).toBe(
      'https://acct.r2.cloudflarestorage.com/videos/publish-media/instagram/x.jpg?X-Amz-Signature=s',
    );
    expect(cleanupPublishMedia).toHaveBeenCalledWith('instagram');
  });

  it('presigns the engine archive instead of uploading a copy', async () => {
    const { uploadPublishMedia, cleanupPublishMedia, presignPublishMedia } = await import('@/lib/upload/publish-media');
    const { InstagramService } = await import('@/lib/instagram');
    const publishMedia = vi.fn(async (..._args: unknown[]) => ({ postId: 'p1', mediaId: 'm1', permalink: 'https://instagram.com/p/1' }));
    vi.mocked(InstagramService).mockImplementationOnce(function () {
      return { publishMedia } as never;
    });
    vi.mocked(uploadPublishMedia).mockClear();
    vi.mocked(cleanupPublishMedia).mockClear();
    vi.mocked(presignPublishMedia).mockClear();

    const fd = makeFormData({ caption: 'Test', videoStoragePath: 'u1/voiceover/task-7/final-1.mp4' });
    const response = await handleInstagramUpload(fd, OWNER_USER_ID, logId, startTime);

    expect(response.success).toBe(true);
    expect(presignPublishMedia).toHaveBeenCalledWith('u1/voiceover/task-7/final-1.mp4');
    expect(uploadPublishMedia).not.toHaveBeenCalled();
    expect(cleanupPublishMedia).not.toHaveBeenCalled();
    expect(publishMedia.mock.calls[0][3]).toBe(
      'https://acct.r2.cloudflarestorage.com/videos/u1/voiceover/task-7/final-1.mp4?X-Amz-Signature=a',
    );
  });

  it('rejects an archive key that belongs to another user', async () => {
    const { presignPublishMedia } = await import('@/lib/upload/publish-media');
    vi.mocked(presignPublishMedia).mockClear();
    const fd = makeFormData({ caption: 'Test', videoStoragePath: 'other/voiceover/task-7/final-1.mp4' });
    await expect(handleInstagramUpload(fd, OWNER_USER_ID, logId, startTime)).rejects.toThrow(ValidationError);
    expect(presignPublishMedia).not.toHaveBeenCalled();
  });

  it('rejects a request that sends both a file and an archive key', async () => {
    const file = new File([new Uint8Array(50)], 'clip.mp4', { type: 'video/mp4' });
    const fd = makeFormData({ caption: 'Test', videoStoragePath: 'u1/voiceover/task-7/final-1.mp4' }, file);
    await expect(handleInstagramUpload(fd, OWNER_USER_ID, logId, startTime)).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError for an aiLabel that is not true or false', async () => {
    const file = new File([new Uint8Array(50)], 'img.jpg', { type: 'image/jpeg' });
    const fd = makeFormData({ caption: 'Test', aiLabel: 'yes' }, file);
    await expect(handleInstagramUpload(fd, OWNER_USER_ID, logId, startTime)).rejects.toThrow(
      'Invalid aiLabel. Use "true" or "false"',
    );
  });

  it('passes aiLabel through to Instagram publishMedia', async () => {
    const { InstagramService } = await import('@/lib/instagram');
    const publishMedia = vi.fn(async (..._args: unknown[]) => ({ postId: 'p1', mediaId: 'm1', permalink: 'https://instagram.com/p/1' }));
    vi.mocked(InstagramService).mockImplementationOnce(function () {
      return { publishMedia } as never;
    });
    const file = new File([new Uint8Array(50)], 'img.jpg', { type: 'image/jpeg' });
    await handleInstagramUpload(makeFormData({ caption: 'Test', aiLabel: 'true' }, file), OWNER_USER_ID, logId, startTime);
    expect(publishMedia.mock.calls[0][5]).toBe(true);
  });

  it('passes aiLabel false when the form omits it', async () => {
    const { InstagramService } = await import('@/lib/instagram');
    const publishMedia = vi.fn(async (..._args: unknown[]) => ({ postId: 'p1', mediaId: 'm1', permalink: 'https://instagram.com/p/1' }));
    vi.mocked(InstagramService).mockImplementationOnce(function () {
      return { publishMedia } as never;
    });
    const file = new File([new Uint8Array(50)], 'img.jpg', { type: 'image/jpeg' });
    await handleInstagramUpload(makeFormData({ caption: 'Test' }, file), OWNER_USER_ID, logId, startTime);
    expect(publishMedia.mock.calls[0][5]).toBe(false);
  });
});

describe('handleYoutubeUpload', () => {
  const logId = 'yt-log-1';
  const startTime = Date.now() - 500;
  const OWNER_USER_ID = 'u1';

  function makeVideoFormData(fields: Record<string, string>, file?: File): FormData {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    if (file) fd.set('video', file);
    return fd;
  }

  const validFields = {
    title: 'My Video',
    description: 'A description',
    tags: 'tag1, tag2',
    privacyStatus: 'public',
  };

  it('returns success with video results', async () => {
    const file = new File([new Uint8Array(100)], 'video.mp4', { type: 'video/mp4' });
    const fd = makeVideoFormData({ ...validFields, accountIds: 'ch-1' }, file);

    const response = await handleYoutubeUpload(fd, OWNER_USER_ID, logId, startTime);

    expect(response.success).toBe(true);
    if (response.success) {
      expect(response.provider).toBe('youtube');
      expect(response.results).toHaveLength(1);
      expect(response.results[0].success).toBe(true);
      expect(response.results[0].videoId).toBe('yt-123');
      expect(response.results[0].videoUrl).toBe('https://youtube.com/watch?v=yt-123');
    }
  });

  it('emits publish_account_unauthorized with the real channel id when YouTube answers Unauthorized', async () => {
    const { uploadYouTubeVideo } = await import('@/lib/youtube');
    vi.mocked(trackApiEvent).mockClear();
    vi.mocked(uploadYouTubeVideo).mockRejectedValueOnce(new Error('Unauthorized'));
    const file = new File([new Uint8Array(100)], 'video.mp4', { type: 'video/mp4' });
    const fd = makeVideoFormData({ ...validFields, accountIds: 'UC-real-channel' }, file);

    const response = await handleYoutubeUpload(fd, OWNER_USER_ID, logId, startTime);

    expect(response.success && response.results[0].success).toBe(false);
    expect(trackApiEvent).toHaveBeenCalledWith('publish_account_unauthorized', {
      provider: 'youtube',
      account_id: 'UC-real-channel',
      user_id: OWNER_USER_ID,
      status: 401,
    });
  });


  describe('youtube media type', () => {
    it('rejects an image: YouTube takes video only', async () => {
      const { uploadYouTubeVideo } = await import('@/lib/youtube');
      vi.mocked(uploadYouTubeVideo).mockClear();
      const image = new File([new Uint8Array(10)], 'image.jpg', { type: 'image/jpeg' });

      await expect(
        handleYoutubeUpload(makeVideoFormData({ ...validFields, accountIds: 'ch-1' }, image), OWNER_USER_ID, logId, startTime),
      ).rejects.toThrow('Invalid file. Must be a video');
      expect(uploadYouTubeVideo).not.toHaveBeenCalled();
    });
  });

  describe('dead login before the upload', () => {
    async function upload() {
      const file = new File([new Uint8Array(100)], 'video.mp4', { type: 'video/mp4' });
      return handleYoutubeUpload(makeVideoFormData({ ...validFields, accountIds: 'UC-dead' }, file), OWNER_USER_ID, logId, startTime);
    }

    async function expiredTokenRefreshRejects(error: unknown) {
      const { getSocialAccountTokens } = await import('@/lib/social-accounts');
      const { createGoogleOAuth2Client } = await import('@/lib/youtube');
      vi.mocked(getSocialAccountTokens).mockResolvedValueOnce({
        tokens: { access_token: 'old', refresh_token: 'r', expiry_date: Date.now() - 1000 },
        account: { id: 'acc1', userId: OWNER_USER_ID, provider: 'youtube' },
      } as never);
      vi.mocked(createGoogleOAuth2Client).mockResolvedValueOnce({
        setCredentials: vi.fn(),
        refreshAccessToken: vi.fn().mockRejectedValue(error),
      } as never);
    }

    it('flags an undecryptable stored token', async () => {
      vi.mocked(markAccountNeedsReconnect).mockClear();
      const { getSocialAccountTokens } = await import('@/lib/social-accounts');
      vi.mocked(getSocialAccountTokens).mockRejectedValueOnce(new TokenDecryptError('bad ciphertext'));
      const response = await upload();
      expect(response.success && response.results[0].success).toBe(false);
      expect(markAccountNeedsReconnect).toHaveBeenCalledWith(OWNER_USER_ID, 'youtube', 'UC-dead');
    });

    it('does not flag an account row that is gone', async () => {
      vi.mocked(markAccountNeedsReconnect).mockClear();
      const { getSocialAccountTokens } = await import('@/lib/social-accounts');
      vi.mocked(getSocialAccountTokens).mockRejectedValueOnce(new AccountNotFoundError('gone'));
      await upload();
      expect(markAccountNeedsReconnect).not.toHaveBeenCalled();
    });

    it('flags a refresh Google rejects with invalid_grant', async () => {
      vi.mocked(markAccountNeedsReconnect).mockClear();
      await expiredTokenRefreshRejects(
        Object.assign(new Error('invalid_grant'), { response: { status: 400, data: { error: 'invalid_grant' } } }),
      );
      await upload();
      expect(markAccountNeedsReconnect).toHaveBeenCalledWith(OWNER_USER_ID, 'youtube', 'UC-dead');
    });

    it('flags a refresh Google answers with 401', async () => {
      vi.mocked(markAccountNeedsReconnect).mockClear();
      await expiredTokenRefreshRejects(Object.assign(new Error('unauthorized'), { response: { status: 401 } }));
      await upload();
      expect(markAccountNeedsReconnect).toHaveBeenCalledWith(OWNER_USER_ID, 'youtube', 'UC-dead');
    });

    it.each([
      ['a 503', Object.assign(new Error('backend error'), { response: { status: 503 } })],
      ['a network error', new Error('socket hang up')],
      ['a 400 with another error code', Object.assign(new Error('bad request'), { response: { status: 400, data: { error: 'invalid_request' } } })],
      ['a 400 with no response body', Object.assign(new Error('bad request'), { response: { status: 400 } })],
    ])('does not flag a refresh that failed with %s', async (_name, error) => {
      vi.mocked(markAccountNeedsReconnect).mockClear();
      await expiredTokenRefreshRejects(error);
      await upload();
      expect(markAccountNeedsReconnect).not.toHaveBeenCalled();
    });
  });

  it('throws ValidationError when no accountIds', async () => {
    const file = new File([new Uint8Array(100)], 'v.mp4', { type: 'video/mp4' });
    const fd = makeVideoFormData(validFields, file);

    await expect(handleYoutubeUpload(fd, OWNER_USER_ID, logId, startTime)).rejects.toThrow(
      ValidationError,
    );
  });

  it('throws ValidationError when no video file', async () => {
    const fd = new FormData();
    fd.set('accountIds', 'ch-1');
    fd.set('title', 'T');
    fd.set('description', 'D');
    fd.set('tags', 'tag');
    fd.set('privacyStatus', 'public');

    await expect(handleYoutubeUpload(fd, OWNER_USER_ID, logId, startTime)).rejects.toThrow(
      ValidationError,
    );
  });

  it('throws ValidationError when title is missing', async () => {
    const file = new File([new Uint8Array(100)], 'v.mp4', { type: 'video/mp4' });
    const fd = new FormData();
    fd.set('accountIds', 'ch-1');
    fd.set('video', file);
    fd.set('description', 'desc');
    fd.set('tags', 'tag');
    fd.set('privacyStatus', 'public');

    await expect(handleYoutubeUpload(fd, OWNER_USER_ID, logId, startTime)).rejects.toThrow(
      ValidationError,
    );
  });

  it('throws ValidationError when description is missing', async () => {
    const file = new File([new Uint8Array(100)], 'v.mp4', { type: 'video/mp4' });
    const fd = new FormData();
    fd.set('accountIds', 'ch-1');
    fd.set('video', file);
    fd.set('title', 'T');
    fd.set('tags', 'tag');
    fd.set('privacyStatus', 'public');

    await expect(handleYoutubeUpload(fd, OWNER_USER_ID, logId, startTime)).rejects.toThrow(
      ValidationError,
    );
  });

  it('throws ValidationError when tags are missing', async () => {
    const file = new File([new Uint8Array(100)], 'v.mp4', { type: 'video/mp4' });
    const fd = new FormData();
    fd.set('accountIds', 'ch-1');
    fd.set('video', file);
    fd.set('title', 'T');
    fd.set('description', 'D');
    fd.set('privacyStatus', 'public');

    await expect(handleYoutubeUpload(fd, OWNER_USER_ID, logId, startTime)).rejects.toThrow(
      ValidationError,
    );
  });

  it('throws ValidationError when privacyStatus is invalid', async () => {
    const file = new File([new Uint8Array(100)], 'v.mp4', { type: 'video/mp4' });
    const fd = new FormData();
    fd.set('accountIds', 'ch-1');
    fd.set('video', file);
    fd.set('title', 'T');
    fd.set('description', 'D');
    fd.set('tags', 'tag');
    fd.set('privacyStatus', 'invalid');

    await expect(handleYoutubeUpload(fd, OWNER_USER_ID, logId, startTime)).rejects.toThrow(
      ValidationError,
    );
  });

  it('throws ValidationError when tags string is empty after parsing', async () => {
    const file = new File([new Uint8Array(100)], 'v.mp4', { type: 'video/mp4' });
    const fd = new FormData();
    fd.set('accountIds', 'ch-1');
    fd.set('video', file);
    fd.set('title', 'T');
    fd.set('description', 'D');
    fd.set('tags', '  ,  ');
    fd.set('privacyStatus', 'public');

    await expect(handleYoutubeUpload(fd, OWNER_USER_ID, logId, startTime)).rejects.toThrow(
      ValidationError,
    );
  });

  it('returns error result when the account does not belong to the owner', async () => {
    const { getSocialAccountTokens } = await import('@/lib/social-accounts');
    vi.mocked(getSocialAccountTokens).mockRejectedValueOnce(new AuthError('Account ch-1 not found', 'account_not_found'));

    const file = new File([new Uint8Array(100)], 'v.mp4', { type: 'video/mp4' });
    const fd = makeVideoFormData({ ...validFields, accountIds: 'ch-1' }, file);

    const response = await handleYoutubeUpload(fd, OWNER_USER_ID, logId, startTime);

    expect(response.success).toBe(true);
    if (response.success) {
      expect(response.results[0].success).toBe(false);
      expect(response.results[0].error).toContain('not found');
    }

    vi.mocked(getSocialAccountTokens).mockResolvedValue({
      tokens: { access_token: 'ig-token', expiry_date: Date.now() + 86400000 },
      account: {
        id: 'acc1',
        userId: 'u1',
        provider: 'instagram',
        providerAccountId: 'ig-1',
        accountName: 'Test',
        accountMetadata: {},
        tokenExpiresAt: null,
        createdAt: '',
        updatedAt: '',
        lastUsedAt: null,
      } as never,
    });
  });

  it('returns error result when upload fails (does not throw)', async () => {
    const { uploadYouTubeVideo } = await import('@/lib/youtube');
    vi.mocked(uploadYouTubeVideo).mockRejectedValueOnce(new Error('Quota exceeded'));

    const file = new File([new Uint8Array(100)], 'v.mp4', { type: 'video/mp4' });
    const fd = makeVideoFormData({ ...validFields, accountIds: 'ch-1' }, file);

    const response = await handleYoutubeUpload(fd, OWNER_USER_ID, logId, startTime);

    expect(response.success).toBe(true);
    if (response.success) {
      expect(response.results[0].success).toBe(false);
      expect(response.results[0].error).toContain('Quota exceeded');
    }

    vi.mocked(uploadYouTubeVideo).mockResolvedValue({ id: 'yt-123', url: 'https://youtube.com/watch?v=yt-123' });
  });

  it('handles multiple account IDs', async () => {
    const file = new File([new Uint8Array(100)], 'v.mp4', { type: 'video/mp4' });
    const fd = new FormData();
    fd.set('video', file);
    fd.set('title', 'T');
    fd.set('description', 'D');
    fd.set('tags', 'tag');
    fd.set('privacyStatus', 'public');
    fd.append('accountIds', 'ch-1');
    fd.append('accountIds', 'ch-2');

    const response = await handleYoutubeUpload(fd, OWNER_USER_ID, logId, startTime);

    expect(response.success).toBe(true);
    if (response.success) {
      expect(response.results).toHaveLength(2);
      expect(response.results.every((r) => r.success)).toBe(true);
    }
  });

  it('always fetches account tokens scoped to the owner (userId)', async () => {
    const { getSocialAccountTokens } = await import('@/lib/social-accounts');

    const file = new File([new Uint8Array(100)], 'v.mp4', { type: 'video/mp4' });
    const fd = makeVideoFormData({ ...validFields, accountIds: 'ch-1' }, file);

    await handleYoutubeUpload(fd, OWNER_USER_ID, logId, startTime);

    expect(getSocialAccountTokens).toHaveBeenCalledWith(
      expect.anything(),
      OWNER_USER_ID,
      'youtube',
      'ch-1',
    );
  });

  it('throws ValidationError for an aiLabel that is not true or false', async () => {
    const file = new File([new Uint8Array(100)], 'v.mp4', { type: 'video/mp4' });
    const fd = makeVideoFormData({ ...validFields, accountIds: 'ch-1', aiLabel: 'yes' }, file);

    await expect(handleYoutubeUpload(fd, OWNER_USER_ID, logId, startTime)).rejects.toThrow(
      'Invalid aiLabel. Use "true" or "false"',
    );
  });

  it('marks the video metadata as AI-labelled when aiLabel is true', async () => {
    const { createVideoMetadata } = await import('@/lib/youtube');
    vi.mocked(createVideoMetadata).mockClear();
    const file = new File([new Uint8Array(100)], 'v.mp4', { type: 'video/mp4' });
    const fd = makeVideoFormData({ ...validFields, accountIds: 'ch-1', aiLabel: 'true' }, file);

    const response = await handleYoutubeUpload(fd, OWNER_USER_ID, logId, startTime);

    expect(response.success).toBe(true);
    expect(vi.mocked(createVideoMetadata).mock.calls[0][0]).toMatchObject({ aiLabel: true });
  });

  it('marks the video metadata as not AI-labelled when aiLabel is absent', async () => {
    const { createVideoMetadata } = await import('@/lib/youtube');
    vi.mocked(createVideoMetadata).mockClear();
    const file = new File([new Uint8Array(100)], 'v.mp4', { type: 'video/mp4' });
    const fd = makeVideoFormData({ ...validFields, accountIds: 'ch-1' }, file);

    const response = await handleYoutubeUpload(fd, OWNER_USER_ID, logId, startTime);

    expect(response.success).toBe(true);
    expect(vi.mocked(createVideoMetadata).mock.calls[0][0]).toMatchObject({ aiLabel: false });
  });

});

describe('first comment on YouTube and Instagram', () => {
  const OWNER_USER_ID = 'u1';

  function youtubeForm(extra: Record<string, string> = {}): FormData {
    const fd = new FormData();
    for (const [k, v] of Object.entries({ title: 'My Video', description: 'A description', tags: 'tag1', privacyStatus: 'public', accountIds: 'ch-1', ...extra })) fd.set(k, v);
    fd.set('video', new File([new Uint8Array(100)], 'video.mp4', { type: 'video/mp4' }));
    return fd;
  }

  function instagramForm(extra: Record<string, string> = {}): FormData {
    const fd = new FormData();
    fd.set('igAccountIds', 'ig-user-1');
    fd.set('caption', 'Nice photo');
    for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    fd.set('file', new File([new Uint8Array(100)], 'photo.jpg', { type: 'image/jpeg' }));
    return fd;
  }

  async function withAccessToken(token: string | null | undefined): Promise<void> {
    const { createGoogleOAuth2Client } = await import('@/lib/youtube');
    vi.mocked(createGoogleOAuth2Client).mockResolvedValueOnce({
      setCredentials: vi.fn(),
      refreshAccessToken: vi.fn(),
      getAccessToken: vi.fn().mockResolvedValue({ token }),
    } as never);
  }

  it('YouTube: comments on the uploaded video with the account token', async () => {
    vi.mocked(postYouTubeFirstComment).mockClear().mockResolvedValue('thread-1');
    await withAccessToken('ya29.tok');
    const response = await handleYoutubeUpload(youtubeForm({ firstComment: '  Link in bio ' }), OWNER_USER_ID, 'l', Date.now());
    expect(postYouTubeFirstComment).toHaveBeenCalledWith({ accessToken: 'ya29.tok', videoId: 'yt-123', text: 'Link in bio' });
    expect(response.success && response.results[0].warnings).toBeUndefined();
  });

  it('YouTube: does not comment without a first comment', async () => {
    vi.mocked(postYouTubeFirstComment).mockClear();
    await handleYoutubeUpload(youtubeForm(), OWNER_USER_ID, 'l', Date.now());
    expect(postYouTubeFirstComment).not.toHaveBeenCalled();
  });

  it('YouTube: a 403 on the comment keeps the upload and asks to reconnect, not an unauthorized report', async () => {
    vi.mocked(trackApiEvent).mockClear();
    vi.mocked(postYouTubeFirstComment).mockClear().mockRejectedValue(
      new FirstCommentError('YOUTUBE_COMMENT_FAILED: insufficient scopes', 403, { reason: 'insufficientPermissions' }),
    );
    await withAccessToken('ya29.tok');
    const response = await handleYoutubeUpload(youtubeForm({ firstComment: 'Link in bio' }), OWNER_USER_ID, 'l', Date.now());
    expect(response.success && response.results[0]).toMatchObject({
      success: true,
      videoId: 'yt-123',
      warnings: ['FIRST_COMMENT_RECONNECT_REQUIRED'],
    });
    expect(trackApiEvent).not.toHaveBeenCalled();
  });

  it('YouTube: a missing access token is a comment failure, not an upload failure', async () => {
    vi.mocked(postYouTubeFirstComment).mockClear();
    await withAccessToken(undefined);
    const response = await handleYoutubeUpload(youtubeForm({ firstComment: 'Link in bio' }), OWNER_USER_ID, 'l', Date.now());
    expect(response.success && response.results[0]).toMatchObject({ success: true, warnings: ['FIRST_COMMENT_FAILED'] });
    expect(postYouTubeFirstComment).not.toHaveBeenCalled();
  });

  it('YouTube: rejects an over-length first comment before uploading', async () => {
    const { uploadYouTubeVideo } = await import('@/lib/youtube');
    vi.mocked(uploadYouTubeVideo).mockClear();
    await expect(
      handleYoutubeUpload(youtubeForm({ firstComment: 'x'.repeat(1001) }), OWNER_USER_ID, 'l', Date.now()),
    ).rejects.toThrow('firstComment');
    expect(uploadYouTubeVideo).not.toHaveBeenCalled();
  });

  it('Instagram: comments on the published media id', async () => {
    vi.mocked(postInstagramFirstComment).mockClear().mockResolvedValue('c1');
    const response = await handleInstagramUpload(instagramForm({ firstComment: 'Link in bio' }), OWNER_USER_ID, 'l', Date.now());
    expect(postInstagramFirstComment).toHaveBeenCalledWith({ accessToken: 'ig-token', mediaId: 'p1', text: 'Link in bio' });
    expect(response.success && response.results[0].warnings).toBeUndefined();
  });

  it('Instagram: a failed comment keeps the post and warns', async () => {
    vi.mocked(postInstagramFirstComment).mockClear().mockRejectedValue(new FirstCommentError('INSTAGRAM_COMMENT_FAILED: boom', 500));
    const response = await handleInstagramUpload(instagramForm({ firstComment: 'Link in bio' }), OWNER_USER_ID, 'l', Date.now());
    expect(response.success && response.results[0]).toMatchObject({ success: true, postId: 'p1', warnings: ['FIRST_COMMENT_FAILED'] });
  });

  it('Instagram: does not comment without a first comment', async () => {
    vi.mocked(postInstagramFirstComment).mockClear();
    await handleInstagramUpload(instagramForm(), OWNER_USER_ID, 'l', Date.now());
    expect(postInstagramFirstComment).not.toHaveBeenCalled();
  });

  it('Instagram: rejects an over-length first comment', async () => {
    await expect(
      handleInstagramUpload(instagramForm({ firstComment: 'x'.repeat(1001) }), OWNER_USER_ID, 'l', Date.now()),
    ).rejects.toThrow('firstComment');
  });
});
