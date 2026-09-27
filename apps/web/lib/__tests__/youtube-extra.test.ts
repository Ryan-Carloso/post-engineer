import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockInsert, mockList, mockGenerateAuthUrl, mockYoutube } = vi.hoisted(() => {
  const mockInsert = vi.fn();
  const mockList = vi.fn();
  const mockGenerateAuthUrl = vi.fn().mockReturnValue('https://accounts.google.com/o/oauth2/auth?state=x');
  const mockYoutube = vi.fn((opts: unknown) => ({
    __opts: opts,
    videos: { insert: mockInsert, list: mockList },
  }));
  return { mockInsert, mockList, mockGenerateAuthUrl, mockYoutube };
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
  },
}));

import { getYouTubeClient, generateGoogleAuthUrl, uploadYouTubeVideo, getYouTubeVideoInfo } from '@/lib/youtube';

const fakeAuth = { generateAuthUrl: mockGenerateAuthUrl } as never;

describe('youtube generateGoogleAuthUrl', () => {
  it('generates an auth url with consent prompt', () => {
    const url = generateGoogleAuthUrl(fakeAuth);
    expect(url).toBe('https://accounts.google.com/o/oauth2/auth?state=x');
    expect(mockGenerateAuthUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        access_type: 'offline',
        prompt: 'consent',
        scope: expect.arrayContaining(['openid', 'profile', 'email']),
      }),
    );
  });

  it('passes state through when provided', () => {
    generateGoogleAuthUrl(fakeAuth, 'my-state');
    expect(mockGenerateAuthUrl).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'my-state' }),
    );
  });
});

describe('youtube uploadYouTubeVideo with File', () => {
  beforeEach(() => {
    mockInsert.mockReset();
    mockInsert.mockResolvedValue({ data: { id: 'file-yt-id' } });
  });

  it('streams a File input', async () => {
    const streamProto = Object.getPrototypeOf(new File([], 'x')) as { stream: () => unknown };
    const originalStream = streamProto.stream;
    streamProto.stream = () =>
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.close();
        },
      });

    try {
      const file = new File([new Uint8Array([1, 2, 3])], 'video.mp4', {
        type: 'video/mp4',
      });
      const metadata = {
        snippet: { title: 'T' },
        status: { privacyStatus: 'public' as const },
      };
      const result = await uploadYouTubeVideo(fakeAuth, file, metadata);
      expect(result).toEqual({
        id: 'file-yt-id',
        url: 'https://www.youtube.com/watch?v=file-yt-id',
      });
      const insertArgs = mockInsert.mock.calls[0][0] as {
      media: { body: unknown };
    };
      expect(insertArgs.media.body).toBeDefined();
    } finally {
      streamProto.stream = originalStream;
    }
  });
});

describe('youtube getYouTubeVideoInfo', () => {
  beforeEach(() => {
    mockList.mockReset();
  });

  it('returns the first item when videos exist', async () => {
    mockList.mockResolvedValue({
      data: { items: [{ id: 'v1', snippet: {} }] },
    });
    const result = await getYouTubeVideoInfo(fakeAuth, 'v1');
    expect(result).toEqual({ id: 'v1', snippet: {} });
    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({ id: ['v1'] }),
    );
  });

  it('throws when no videos are found', async () => {
    mockList.mockResolvedValue({ data: { items: [] } });
    await expect(getYouTubeVideoInfo(fakeAuth, 'v1')).rejects.toThrow('Video not found');
  });
});

describe('youtube getYouTubeClient', () => {
  it('forwards auth to google.youtube', () => {
    const client = getYouTubeClient(fakeAuth);
    expect(client).toBeDefined();
    expect(mockYoutube).toHaveBeenCalledWith(
      expect.objectContaining({ version: 'v3', auth: fakeAuth }),
    );
  });
});
