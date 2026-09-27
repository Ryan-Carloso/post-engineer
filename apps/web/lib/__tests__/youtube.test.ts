import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

//---------------
// Hoisted mocks (vi.mock is hoisted above variable declarations)
//---------------

const { mockInsert, mockYoutube } = vi.hoisted(() => {
  const mockInsert = vi.fn().mockResolvedValue({
    data: { id: 'yt-123', snippet: { title: 't' } },
  });
  const mockThumbSet = vi.fn().mockResolvedValue({ data: {} });
  const mockYoutube = vi.fn(() => ({
    videos: { insert: mockInsert, list: vi.fn().mockResolvedValue({ data: { items: [] } }) },
    thumbnails: { set: mockThumbSet },
  }));
  return { mockInsert, mockThumbSet, mockYoutube };
});

vi.mock('googleapis', () => ({
  google: { youtube: mockYoutube },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    generateLogId: () => 'log-1',
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    logUploadProgress: vi.fn(),
  },
}));

import {
  getYouTubeClient,
  createVideoMetadata,
  uploadYouTubeVideo,
  type YouTubeUploadOptions,
} from '@/lib/youtube';
import { logger } from '@/lib/logger';

//---------------
// YouTube module — unit tests
//---------------

describe('getYouTubeClient', () => {
  it('calls google.youtube with version v3 and the provided auth', () => {
    const fakeAuth = { setCredentials: vi.fn() } as never;
    const client = getYouTubeClient(fakeAuth);

    expect(mockYoutube).toHaveBeenCalledWith(
      expect.objectContaining({ version: 'v3', auth: fakeAuth }),
    );
    expect(client).toBeDefined();
  });

  it('returns an object with videos and thumbnails', () => {
    const fakeAuth = {} as never;
    const client = getYouTubeClient(fakeAuth);
    expect(client.videos).toBeDefined();
    expect(client.thumbnails).toBeDefined();
  });
});

describe('createGoogleOAuth2Client', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('throws when GOOGLE_CLIENT_ID is missing', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    process.env.GOOGLE_REDIRECT_URI = 'https://example.com/callback';

    const { createGoogleOAuth2Client } = await import('@/lib/youtube');
    await expect(createGoogleOAuth2Client()).rejects.toThrow(
      'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set',
    );
  });

  it('throws when GOOGLE_CLIENT_SECRET is missing', async () => {
    process.env.GOOGLE_CLIENT_ID = 'id';
    delete process.env.GOOGLE_CLIENT_SECRET;
    process.env.GOOGLE_REDIRECT_URI = 'https://example.com/callback';

    const { createGoogleOAuth2Client } = await import('@/lib/youtube');
    await expect(createGoogleOAuth2Client()).rejects.toThrow(
      'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set',
    );
  });

  it('throws when GOOGLE_REDIRECT_URI is missing', async () => {
    process.env.GOOGLE_CLIENT_ID = 'id';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    delete process.env.GOOGLE_REDIRECT_URI;

    const { createGoogleOAuth2Client } = await import('@/lib/youtube');
    await expect(createGoogleOAuth2Client()).rejects.toThrow(
      'GOOGLE_REDIRECT_URI must be set',
    );
  });

  it('returns an OAuth2Client when all env vars are present', async () => {
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    process.env.GOOGLE_REDIRECT_URI = 'https://example.com/callback';

    const { createGoogleOAuth2Client } = await import('@/lib/youtube');
    const client = await createGoogleOAuth2Client();

    expect(client).toBeDefined();
    expect(typeof client.setCredentials).toBe('function');
  });

  it('calls logger.info with diagnostic info', async () => {
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    process.env.GOOGLE_REDIRECT_URI = 'https://example.com/callback';

    const { createGoogleOAuth2Client } = await import('@/lib/youtube');
    await createGoogleOAuth2Client();

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('OAuth2Client'),
      expect.any(Object),
    );
  });
});

describe('createVideoMetadata', () => {
  it('transforms options into the correct YouTubeVideoMetadata structure', () => {
    const options: YouTubeUploadOptions = {
      title: 'My Video',
      description: 'A description',
      tags: ['tag1', 'tag2'],
      privacyStatus: 'unlisted',
      categoryId: '28',
    };

    const result = createVideoMetadata(options);

    expect(result).toEqual({
      snippet: {
        title: 'My Video',
        description: 'A description',
        tags: ['tag1', 'tag2'],
        categoryId: '28',
      },
      status: {
        privacyStatus: 'unlisted',
        selfDeclaredMadeForKids: false,
      },
    });
  });

  it('applies defaults for optional fields', () => {
    const result = createVideoMetadata({ title: 'T' });

    expect(result.snippet.description).toBe('');
    expect(result.snippet.tags).toEqual([]);
    expect(result.snippet.categoryId).toBe('22');
    expect(result.status.privacyStatus).toBe('public');
  });

  it('defaults selfDeclaredMadeForKids to false', () => {
    const result = createVideoMetadata({ title: 'Kids Video' });
    expect(result.status.selfDeclaredMadeForKids).toBe(false);
  });

  it('handles empty tags array', () => {
    const result = createVideoMetadata({ title: 'T', tags: [] });
    expect(result.snippet.tags).toEqual([]);
  });
});

describe('uploadYouTubeVideo', () => {
  beforeEach(() => {
    mockInsert.mockClear();
    mockInsert.mockResolvedValue({
      data: { id: 'yt-123', snippet: { title: 't' } },
    });
  });

  const fakeAuth = { setCredentials: vi.fn() } as never;
  const metadata = {
    snippet: { title: 'T', description: '', tags: [] },
    status: { privacyStatus: 'public' as const },
  };

  it('returns { id, url } on success', async () => {
    const buffer = Buffer.from('video-content');
    const result = await uploadYouTubeVideo(fakeAuth, buffer, metadata);

    expect(result).toEqual({
      id: 'yt-123',
      url: 'https://www.youtube.com/watch?v=yt-123',
    });
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  it('throws when the API returns no video id', async () => {
    mockInsert.mockResolvedValue({ data: {} });
    const buffer = Buffer.from('video-content');

    await expect(uploadYouTubeVideo(fakeAuth, buffer, metadata)).rejects.toThrow(
      'Failed to upload video - no video ID returned',
    );
  });

  it('throws on API error', async () => {
    mockInsert.mockRejectedValue(new Error('quota exceeded'));
    const buffer = Buffer.from('video-content');

    await expect(uploadYouTubeVideo(fakeAuth, buffer, metadata)).rejects.toThrow(
      'quota exceeded',
    );
  });

  it('passes snippet and status parts to videos.insert', async () => {
    const buffer = Buffer.from('test');
    await uploadYouTubeVideo(fakeAuth, buffer, metadata);

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        part: expect.arrayContaining(['snippet', 'status']),
        requestBody: metadata,
      }),
    );
  });
});
