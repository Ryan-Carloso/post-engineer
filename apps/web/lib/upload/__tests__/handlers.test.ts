import { describe, it, expect, vi } from 'vitest';
import {
  buildUploadErrorResponse,
  handleInstagramUpload,
  handleYoutubeUpload,
} from '@/lib/upload/handlers';
import { ValidationError, AuthError, UploadError, InstagramApiError } from '@/lib/errors';

//---------------
// Upload handlers — unit tests
//---------------

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
    storage: {
      listBuckets: vi.fn().mockResolvedValue({ data: [{ name: 'uploads' }], error: null }),
      createBucket: vi.fn().mockResolvedValue({ error: null }),
      from: vi.fn(() => ({
        upload: vi.fn().mockResolvedValue({ error: null }),
        createSignedUrl: vi.fn(async () => ({ data: { signedUrl: 'https://supabase.co/private.mp4?signed=1' }, error: null })),
        list: vi.fn().mockResolvedValue({ data: [], error: null }),
        remove: vi.fn().mockResolvedValue({ error: null }),
      })),
    },
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

vi.mock('@/lib/timeout', () => ({
  withUploadTimeout: vi.fn((p: Promise<unknown>) => p),
}));

vi.mock('@/lib/media/upload-schema', () => ({
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

//---------------
// buildUploadErrorResponse
//---------------

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

//---------------
// handleInstagramUpload
//---------------

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

  it('creates the uploads bucket as private (public: false)', async () => {
    const { createSupabaseServiceClient } = await import('@/lib/supabase/service');
    // Overrides the mock to return an empty bucket → handler enters the creation branch
    const createBucket = vi.fn(async () => ({ data: null, error: null }));
    vi.mocked(createSupabaseServiceClient).mockReturnValue({
      storage: {
        listBuckets: vi.fn(async () => ({ data: [], error: null })),
        createBucket,
        from: vi.fn(() => ({
          upload: vi.fn(async () => ({ data: {}, error: null })),
          createSignedUrl: vi.fn(async () => ({ data: { signedUrl: 'https://s.test/x' }, error: null })),
          list: vi.fn(async () => ({ data: [], error: null })),
          remove: vi.fn(async () => ({ data: null, error: null })),
        })),
      },
    } as never);

    const file = new File([new Uint8Array(50)], 'img.jpg', { type: 'image/jpeg' });
    const fd = makeFormData({ caption: 'Test' }, file);
    await handleInstagramUpload(fd, OWNER_USER_ID, logId, startTime);

    expect(createBucket).toHaveBeenCalledWith(expect.any(String), { public: false });
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

});
