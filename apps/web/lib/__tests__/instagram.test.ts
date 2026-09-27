import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

//---------------
// Mocks
//---------------

const mockPost = vi.fn();
const mockGet = vi.fn();
const mockFetch = vi.fn();

vi.mock('axios', () => ({
  default: {
    post: (...args: unknown[]) => mockPost(...args),
    get: (...args: unknown[]) => mockGet(...args),
    isAxiosError: vi.fn((err: unknown) => {
      return err && typeof err === 'object' && 'isAxiosError' in err;
    }),
  },
}));

vi.stubGlobal('fetch', mockFetch);

// Re-stub for each test: vi.unstubAllGlobals() in afterEach removes the stub.
beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
});

vi.mock('@/lib/logger', () => ({
  logger: {
    generateLogId: () => 'log-1',
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    logUploadProgress: vi.fn(),
  },
}));

import { InstagramService } from '@/lib/instagram';
import { InstagramApiError } from '@/lib/errors';

//---------------
// InstagramService — unit tests
//---------------

describe('InstagramService', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    process.env.INSTAGRAM_CLIENT_ID = 'test-id';
    process.env.INSTAGRAM_CLIENT_SECRET = 'test-secret';
    process.env.INSTAGRAM_REDIRECT_URI = 'https://test.com/callback';
    mockPost.mockReset();
    mockGet.mockReset();
    mockFetch.mockReset();
  });

  afterEach(() => {
    process.env = { ...envBackup };
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('throws if INSTAGRAM_CLIENT_ID is missing', () => {
      delete process.env.INSTAGRAM_CLIENT_ID;
      expect(() => new InstagramService()).toThrow(
        'INSTAGRAM_CLIENT_ID environment variable is required',
      );
    });

    it('throws if INSTAGRAM_CLIENT_SECRET is missing', () => {
      delete process.env.INSTAGRAM_CLIENT_SECRET;
      expect(() => new InstagramService()).toThrow(
        'INSTAGRAM_CLIENT_SECRET environment variable is required',
      );
    });

    it('throws if INSTAGRAM_REDIRECT_URI is missing', () => {
      delete process.env.INSTAGRAM_REDIRECT_URI;
      expect(() => new InstagramService()).toThrow(
        'INSTAGRAM_REDIRECT_URI environment variable is required',
      );
    });

    it('succeeds with all env vars set', () => {
      expect(() => new InstagramService()).not.toThrow();
    });
  });

  describe('getApiVersion', () => {
    it('returns the API version string', () => {
      expect(InstagramService.getApiVersion()).toBe('v23.0');
    });
  });

  describe('getAuthorizationUrl', () => {
    it('returns a properly formatted URL', () => {
      const service = new InstagramService();
      const url = service.getAuthorizationUrl('state-123');

      expect(url).toContain('https://www.instagram.com/oauth/authorize');
      expect(url).toContain('client_id=test-id');
      expect(url).toContain('redirect_uri=');
      expect(url).toContain('response_type=code');
      expect(url).toContain('state=state-123');
      expect(url).toContain('scope=instagram_business');
    });
  });

  describe('exchangeCodeForLongLivedToken', () => {
    const shortLivedBody = { access_token: 'short-token', user_id: '123' };
    const longLivedBody = {
      access_token: 'long-token',
      token_type: 'bearer',
      expires_in: 5184000,
    };

    function mockSuccessfulExchange() {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(shortLivedBody), { status: 200 }),
      );
      mockGet.mockResolvedValueOnce({ data: longLivedBody });
    }

    function getTokenExchangeCall(): { url: string; init: RequestInit } {
      const [url, init] = mockFetch.mock.calls[0] as [unknown, RequestInit];
      return { url: String(url), init };
    }

    it('exchanges the code with POST + application/x-www-form-urlencoded (never GET, never JSON)', async () => {
      mockSuccessfulExchange();

      const service = new InstagramService();
      const result = await service.exchangeCodeForLongLivedToken('auth-code');

      expect(result).toEqual({
        accessToken: 'long-token',
        tokenType: 'bearer',
        expiresIn: 5184000,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const { url, init } = getTokenExchangeCall();
      expect(url).toBe('https://api.instagram.com/oauth/access_token');
      expect(init.method).toBe('POST');
      const headers = init.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
      expect(init.body).toBeInstanceOf(URLSearchParams);
      const params = init.body as URLSearchParams;
      expect(params.get('client_id')).toBe('test-id');
      expect(params.get('client_secret')).toBe('test-secret');
      expect(params.get('grant_type')).toBe('authorization_code');
      expect(params.get('redirect_uri')).toBe('https://test.com/callback');
      expect(params.get('code')).toBe('auth-code');

      // Step 2 continua sendo GET no graph.instagram.com
      expect(mockGet).toHaveBeenCalledWith(
        'https://graph.instagram.com/access_token',
        expect.objectContaining({
          params: expect.objectContaining({
            grant_type: 'ig_exchange_token',
            access_token: 'short-token',
          }),
        }),
      );
    });

    it('uses the exact Meta-registered redirect_uri in the token exchange', async () => {
      mockSuccessfulExchange();

      const service = new InstagramService(
        'https://post-engineer.com/api/instagram-auth/callback',
      );
      await service.exchangeCodeForLongLivedToken('auth-code');

      const { init } = getTokenExchangeCall();
      expect((init.body as URLSearchParams).get('redirect_uri')).toBe(
        'https://post-engineer.com/api/instagram-auth/callback',
      );
    });

    it('defaults tokenType to bearer when not provided', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'short', user_id: '1' }), {
          status: 200,
        }),
      );
      mockGet.mockResolvedValueOnce({
        data: { access_token: 'long', expires_in: 100 },
      });

      const service = new InstagramService();
      const result = await service.exchangeCodeForLongLivedToken('code');
      expect(result.tokenType).toBe('bearer');
    });

    it('throws InstagramApiError with Instagram status and body on non-OK response', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error_message: 'Invalid authorization code' }),
          { status: 400 },
        ),
      );

      const service = new InstagramService();
      const err = await service
        .exchangeCodeForLongLivedToken('bad-code')
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(InstagramApiError);
      const message = (err as Error).message;
      expect(message).toContain('400');
      expect(message).toContain('Invalid authorization code');
    });

    it('never exposes client_secret in token exchange errors', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error_message: 'Invalid client_secret: test-secret' }),
          { status: 400 },
        ),
      );

      const service = new InstagramService();
      const err = await service
        .exchangeCodeForLongLivedToken('code')
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(InstagramApiError);
      const message = (err as Error).message;
      expect(message).not.toContain('test-secret');
      expect(message).toContain('[redacted]');
    });

    it('redacts client_secret from raw (non-JSON) error bodies', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('bad request: secret=test-secret&code=x', { status: 400 }),
      );

      const service = new InstagramService();
      const err = await service
        .exchangeCodeForLongLivedToken('code')
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(InstagramApiError);
      const message = (err as Error).message;
      expect(message).not.toContain('test-secret');
      expect(message).toContain('[redacted]');
    });

    it('throws InstagramApiError when the exchange returns no access_token', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ user_id: '123' }), { status: 200 }),
      );

      const service = new InstagramService();
      await expect(service.exchangeCodeForLongLivedToken('code')).rejects.toThrow(
        InstagramApiError,
      );
    });

    it('throws InstagramApiError when the exchange request fails at network level', async () => {
      mockFetch.mockRejectedValueOnce(new Error('fetch failed'));

      const service = new InstagramService();
      await expect(service.exchangeCodeForLongLivedToken('code')).rejects.toThrow(
        InstagramApiError,
      );
    });

    it('throws InstagramApiError when the long-lived exchange fails', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(shortLivedBody), { status: 200 }),
      );
      const axiosError = Object.assign(new Error('Request failed'), {
        isAxiosError: true,
        response: { status: 400, data: { error_message: 'bad token' } },
      });
      mockGet.mockRejectedValueOnce(axiosError);

      const service = new InstagramService();
      await expect(service.exchangeCodeForLongLivedToken('code')).rejects.toThrow(
        InstagramApiError,
      );
    });
  });

  describe('getProfile', () => {
    it('returns profile data', async () => {
      mockGet.mockResolvedValueOnce({
        data: {
          id: 'ig-1',
          user_id: 'ig-user-1',
          username: 'testuser',
          name: 'Test User',
          profile_picture_url: 'https://example.com/pic.jpg',
          followers_count: 500,
          media_count: 42,
        },
      });

      const service = new InstagramService();
      const profile = await service.getProfile('token');

      expect(profile).toEqual({
        userdId: 'ig-user-1',
        username: 'testuser',
        name: 'Test User',
        profilePictureUrl: 'https://example.com/pic.jpg',
        followersCount: 500,
        mediaCount: 42,
      });
    });

    it('falls back to id when user_id is absent', async () => {
      mockGet.mockResolvedValueOnce({
        data: { id: 'ig-only-id', username: 'u' },
      });

      const service = new InstagramService();
      const profile = await service.getProfile('token');
      expect(profile.userdId).toBe('ig-only-id');
    });

    it('defaults username to instagram_user', async () => {
      mockGet.mockResolvedValueOnce({ data: { id: '1' } });

      const service = new InstagramService();
      const profile = await service.getProfile('token');
      expect(profile.username).toBe('instagram_user');
    });

    it('throws InstagramApiError on failure', async () => {
      const axiosError = Object.assign(new Error('Network'), {
        isAxiosError: true,
        response: { status: 500, data: { error_message: 'Server error' } },
      });
      mockGet.mockRejectedValueOnce(axiosError);

      const service = new InstagramService();
      await expect(service.getProfile('token')).rejects.toThrow(InstagramApiError);
    });

    it('calls the correct endpoint with access_token', async () => {
      mockGet.mockResolvedValueOnce({ data: { id: '1', username: 'u' } });

      const service = new InstagramService();
      await service.getProfile('my-token');

      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('/v23.0/me'),
        expect.objectContaining({
          params: { access_token: 'my-token' },
        }),
      );
    });
  });

  describe('publishMedia', () => {
    describe('IMAGE', () => {
      it('creates container, waits (FINISHED), publishes, returns permalink', async () => {
        mockPost
          .mockResolvedValueOnce({ data: { id: 'container-1' } })
          .mockResolvedValueOnce({ data: { id: 'post-1' } });
        mockGet
          .mockResolvedValueOnce({ data: { status_code: 'FINISHED' } })
          .mockResolvedValueOnce({ data: { permalink: 'https://ig.com/p/abc' } });

        const service = new InstagramService();
        const result = await service.publishMedia(
          'ig-user',
          'access-token',
          'Nice photo',
          'https://example.com/img.jpg',
          false,
        );

        expect(result).toEqual({
          mediaId: 'container-1',
          postId: 'post-1',
          permalink: 'https://ig.com/p/abc',
        });
      });

      it('creates container with image_url (not video_url)', async () => {
        mockPost
          .mockResolvedValueOnce({ data: { id: 'c1' } })
          .mockResolvedValueOnce({ data: { id: 'p1' } });
        mockGet
          .mockResolvedValueOnce({ data: { status_code: 'FINISHED' } })
          .mockResolvedValueOnce({ data: { permalink: 'https://ig.com/p/x' } });

        const service = new InstagramService();
        await service.publishMedia('user', 'tok', 'cap', 'https://example.com/img.jpg', false);

        expect(mockPost).toHaveBeenCalledWith(
          expect.stringContaining('/media'),
          null,
          expect.objectContaining({
            params: expect.objectContaining({ image_url: 'https://example.com/img.jpg' }),
          }),
        );
      });
    });

    describe('VIDEO', () => {
      it('creates container, polls until FINISHED, publishes, returns permalink', async () => {
        mockPost
          .mockResolvedValueOnce({ data: { id: 'vc-1' } })
          .mockResolvedValueOnce({ data: { id: 'vp-1' } });
        mockGet
          .mockResolvedValueOnce({ data: { status_code: 'PROCESSING' } })
          .mockResolvedValueOnce({ data: { status_code: 'FINISHED' } })
          .mockResolvedValueOnce({ data: { permalink: 'https://ig.com/p/vid' } });

        const service = new InstagramService();
        const result = await service.publishMedia(
          'ig-user',
          'access-token',
          'My reel',
          'https://example.com/vid.mp4',
          true,
        );

        expect(result).toEqual({
          mediaId: 'vc-1',
          postId: 'vp-1',
          permalink: 'https://ig.com/p/vid',
        });
      });

      it('creates container with media_type=REELS and video_url', async () => {
        mockPost
          .mockResolvedValueOnce({ data: { id: 'c1' } })
          .mockResolvedValueOnce({ data: { id: 'p1' } });
        mockGet
          .mockResolvedValueOnce({ data: { status_code: 'FINISHED' } })
          .mockResolvedValueOnce({ data: {} });

        const service = new InstagramService();
        await service.publishMedia('user', 'tok', 'cap', 'https://example.com/vid.mp4', true);

        expect(mockPost).toHaveBeenCalledWith(
          expect.stringContaining('/media'),
          null,
          expect.objectContaining({
            params: expect.objectContaining({ media_type: 'REELS', video_url: 'https://example.com/vid.mp4' }),
          }),
        );
      });

      it('throws InstagramApiError when container status is ERROR', async () => {
        mockPost.mockResolvedValueOnce({ data: { id: 'err-container' } });
        mockGet.mockResolvedValueOnce({ data: { status_code: 'ERROR' } });

        const service = new InstagramService();
        await expect(
          service.publishMedia('user', 'tok', 'cap', 'https://example.com/vid.mp4', true),
        ).rejects.toThrow(InstagramApiError);
      });
    });

    describe('permalink fallback', () => {
      it('returns undefined permalink when GET fails', async () => {
        mockPost
          .mockResolvedValueOnce({ data: { id: 'c1' } })
          .mockResolvedValueOnce({ data: { id: 'p1' } });
        mockGet
          .mockResolvedValueOnce({ data: { status_code: 'FINISHED' } })
          .mockRejectedValueOnce(new Error('permalink fail'));

        const service = new InstagramService();
        const result = await service.publishMedia(
          'user', 'tok', 'cap', 'https://example.com/img.jpg', false,
        );

        expect(result.postId).toBe('p1');
        expect(result.permalink).toBeUndefined();
      });
    });

    describe('error handling', () => {
      it('throws InstagramApiError on publish failure', async () => {
        const axiosError = Object.assign(new Error('Publish failed'), {
          isAxiosError: true,
          response: { status: 400, data: { error_message: 'Bad request' } },
        });
        mockPost.mockRejectedValueOnce(axiosError);

        const service = new InstagramService();
        await expect(
          service.publishMedia('user', 'tok', 'cap', 'https://example.com/img.jpg', false),
        ).rejects.toThrow(InstagramApiError);
      });
    });
  });

  describe('waitForContainer', () => {
    it('throws after maxAttempts when status never finishes', async () => {
      vi.useFakeTimers();
      mockPost
        .mockResolvedValueOnce({ data: { id: 'c1' } })
        .mockResolvedValueOnce({ data: { id: 'p1' } });

      // Return PROCESSING for all poll attempts
      mockGet.mockResolvedValue({ data: { status_code: 'PROCESSING' } });

      const service = new InstagramService();

      const pending = expect(
        service.publishMedia('user', 'tok', 'cap', 'https://example.com/img.jpg', false),
      ).rejects.toThrow();

      // waitForContainer does 30 attempts x 2000ms internal sleep
      await vi.advanceTimersByTimeAsync(30 * 30 * 2000 + 1000);

      await pending;
    });
  });
});
