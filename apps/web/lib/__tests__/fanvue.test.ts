// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  FANVUE_API_VERSION,
  FANVUE_SCOPES,
  FANVUE_UPLOAD_TIMEOUT_MS,
  buildFanvueAuthUrl,
  completeFanvueUploadSession,
  createFanvuePost,
  createFanvueUploadSession,
  exchangeFanvueCode,
  fanvueCodeChallenge,
  fetchFanvueProfile,
  generateFanvueCodeVerifier,
  refreshFanvueAccessToken,
  uploadFanvueUploadPart,
  uploadVideoToFanvueVault,
} from '@/lib/fanvue';
import { FanvueError } from '@/lib/errors';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function call(index: number): { url: URL; init: RequestInit } {
  const [url, init] = mockFetch.mock.calls[index] as [string, RequestInit];
  return { url: new URL(url), init };
}

function headersOf(init: RequestInit): Record<string, string> {
  return (init.headers ?? {}) as Record<string, string>;
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubEnv('FANVUE_CLIENT_ID', 'fan-cid');
  vi.stubEnv('FANVUE_CLIENT_SECRET', 'fan-secret');
  vi.stubEnv('FANVUE_REDIRECT_URI', 'https://app.example/fan/cb');
});

describe('PKCE helpers', () => {
  it('generates a 43-char base64url verifier and the S256 challenge for it', () => {
    const verifier = generateFanvueCodeVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(fanvueCodeChallenge(verifier)).toBe(
      createHash('sha256').update(verifier, 'utf8').digest('base64url'),
    );
    expect(fanvueCodeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
});

describe('buildFanvueAuthUrl', () => {
  it('requests the Fanvue scopes with PKCE S256 and the app id, state and redirect', () => {
    const { authUrl, codeVerifier } = buildFanvueAuthUrl('st-1');
    const url = new URL(authUrl);
    expect(`${url.origin}${url.pathname}`).toBe('https://auth.fanvue.com/oauth2/auth');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('fan-cid');
    expect(url.searchParams.get('state')).toBe('st-1');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example/fan/cb');
    expect(url.searchParams.get('scope')).toBe(
      'read:self read:post write:post read:media write:media offline_access',
    );
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe(fanvueCodeChallenge(codeVerifier));
    expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(FANVUE_SCOPES).toContain('offline_access');
    expect(FANVUE_SCOPES).toContain('write:media');
  });

  it('uses the redirect override when given', () => {
    const { authUrl } = buildFanvueAuthUrl('st-1', 'http://localhost:3434/api/fanvue-auth/callback');
    expect(new URL(authUrl).searchParams.get('redirect_uri')).toBe(
      'http://localhost:3434/api/fanvue-auth/callback',
    );
  });

  it('fails explicitly when the client id is missing or empty', () => {
    vi.stubEnv('FANVUE_CLIENT_ID', undefined);
    expect(() => buildFanvueAuthUrl('st-1')).toThrow('FANVUE_ENV_MISSING: FANVUE_CLIENT_ID');
    vi.stubEnv('FANVUE_CLIENT_ID', '');
    expect(() => buildFanvueAuthUrl('st-1')).toThrow(FanvueError);
  });
});

describe('exchangeFanvueCode', () => {
  it('swaps the code + PKCE verifier for tokens with HTTP Basic auth', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600, token_type: 'Bearer' }),
    );

    const token = await exchangeFanvueCode('code-1', 'verifier-1');
    expect(token).toEqual({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600, token_type: 'Bearer' });

    const first = call(0);
    expect(`${first.url.origin}${first.url.pathname}`).toBe('https://auth.fanvue.com/oauth2/token');
    expect(first.init.method).toBe('POST');
    expect(headersOf(first.init).Authorization).toBe(`Basic ${Buffer.from('fan-cid:fan-secret').toString('base64')}`);
    const body = new URLSearchParams(String(first.init.body));
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('code-1');
    expect(body.get('code_verifier')).toBe('verifier-1');
    expect(body.get('redirect_uri')).toBe('https://app.example/fan/cb');
  });

  it('defaults a missing expires_in to one hour', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ access_token: 'at-1', refresh_token: null }));
    const token = await exchangeFanvueCode('code-1', 'verifier-1');
    expect(token.expires_in).toBe(3600);
    expect(token.refresh_token).toBeNull();
  });

  it('throws the Fanvue status when the exchange fails', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'invalid_grant', error_description: 'bad code' }, 400));
    await expect(exchangeFanvueCode('code-1', 'verifier-1')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('throws when the response carries no access token', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ refresh_token: 'rt-1' }));
    await expect(exchangeFanvueCode('code-1', 'verifier-1')).rejects.toThrow('missing access_token');
  });
});

describe('refreshFanvueAccessToken', () => {
  it('exchanges the refresh token for a new pair', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ access_token: 'at-2', refresh_token: 'rt-2', expires_in: 3600, token_type: 'Bearer' }),
    );
    const token = await refreshFanvueAccessToken('rt-1');
    expect(token.access_token).toBe('at-2');
    expect(token.refresh_token).toBe('rt-2');
    const body = new URLSearchParams(String(call(0).init.body));
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('rt-1');
  });
});

describe('fetchFanvueProfile', () => {
  it('reads the /users/me uuid, username, display name, avatar and creator flag', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        uuid: 'user-1',
        username: 'maker',
        displayName: 'Maker',
        email: 'maker@example.com',
        avatarUrl: 'https://cdn.fanvue.com/a.jpg',
        isCreator: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    );
    await expect(fetchFanvueProfile('at-1')).resolves.toEqual({
      uuid: 'user-1',
      username: 'maker',
      displayName: 'Maker',
      email: 'maker@example.com',
      avatarUrl: 'https://cdn.fanvue.com/a.jpg',
      isCreator: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const first = call(0);
    expect(`${first.url.origin}${first.url.pathname}`).toBe('https://api.fanvue.com/users/me');
    expect(headersOf(first.init).Authorization).toBe('Bearer at-1');
    expect(headersOf(first.init)['X-Fanvue-API-Version']).toBe(FANVUE_API_VERSION);
    expect(FANVUE_API_VERSION).toBe('2025-06-26');
  });

  it('throws when the profile carries no uuid', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ username: 'maker' }));
    await expect(fetchFanvueProfile('at-1')).rejects.toThrow('missing uuid');
  });

  it('throws a Fanvue error with the API status on a non-2xx profile read', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ message: 'unauthorized' }, 401));
    await expect(fetchFanvueProfile('bad')).rejects.toMatchObject({ statusCode: 401 });
  });

  it('throws on a non-JSON profile body', async () => {
    mockFetch.mockResolvedValueOnce(new Response('<html>proxy error</html>', { status: 200 }));
    await expect(fetchFanvueProfile('at-1')).rejects.toThrow('invalid response body');
  });
});

describe('vault upload steps', () => {
  const video = Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]);

  it('createFanvueUploadSession posts filename, contentType and fileSize and reads the session', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        uploadSessionId: 'sess-1',
        uploadUrls: [{ partNumber: 1, url: 'https://up.example/part-1' }],
      }),
    );
    const session = await createFanvueUploadSession('at-1', {
      filename: 'clip.mp4',
      contentType: 'video/mp4',
      fileSize: 123,
    });
    expect(session).toEqual({
      uploadSessionId: 'sess-1',
      uploadUrls: [{ partNumber: 1, url: 'https://up.example/part-1' }],
    });
    const first = call(0);
    expect(`${first.url.origin}${first.url.pathname}`).toBe('https://api.fanvue.com/media/create-upload-session');
    expect(JSON.parse(String(first.init.body))).toEqual({
      filename: 'clip.mp4',
      contentType: 'video/mp4',
      fileSize: 123,
    });
    expect(headersOf(first.init)['X-Fanvue-API-Version']).toBe('2025-06-26');
  });

  it('createFanvueUploadSession accepts a single uploadUrl as part 1', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ uploadSessionId: 'sess-1', uploadUrl: 'https://up.example/only' }));
    const session = await createFanvueUploadSession('at-1', {
      filename: 'clip.mp4',
      contentType: 'video/mp4',
      fileSize: 1,
    });
    expect(session.uploadUrls).toEqual([{ partNumber: 1, url: 'https://up.example/only' }]);
  });

  it('createFanvueUploadSession throws when no upload URL comes back', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ uploadSessionId: 'sess-1', uploadUrls: [] }));
    await expect(
      createFanvueUploadSession('at-1', { filename: 'clip.mp4', contentType: 'video/mp4', fileSize: 1 }),
    ).rejects.toThrow('missing uploadUrl');
  });

  it('uploadFanvueUploadPart PUTs the bytes without a Bearer header and returns the etag', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(null, { status: 200, headers: { etag: '"etag-1"' } }),
    );
    const etag = await uploadFanvueUploadPart('https://up.example/part-1', video, 'video/mp4');
    expect(etag).toBe('"etag-1"');
    const first = call(0);
    expect(first.url.href).toBe('https://up.example/part-1');
    expect(first.init.method).toBe('PUT');
    expect(headersOf(first.init).Authorization).toBeUndefined();
    const body = first.init.body as Blob;
    expect(body.type).toBe('video/mp4');
    expect(await body.arrayBuffer()).toEqual(video.buffer.slice(video.byteOffset, video.byteOffset + video.byteLength));
  });

  it('uploadFanvueUploadPart throws when the presigned upload is rejected', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 403 }));
    await expect(uploadFanvueUploadPart('https://up.example/part-1', video, 'video/mp4')).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('uploadFanvueUploadPart throws when the response carries no etag', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));
    await expect(uploadFanvueUploadPart('https://up.example/part-1', video, 'video/mp4')).rejects.toThrow(
      'missing etag',
    );
  });

  it('completeFanvueUploadSession PATCHes the session with the parts and returns the media id', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ mediaId: 'media-1' }));
    const mediaId = await completeFanvueUploadSession('at-1', 'sess-1', [{ partNumber: 1, etag: '"etag-1"' }]);
    expect(mediaId).toBe('media-1');
    const first = call(0);
    expect(`${first.url.origin}${first.url.pathname}`).toBe('https://api.fanvue.com/media/complete-upload-session');
    expect(first.init.method).toBe('PATCH');
    expect(JSON.parse(String(first.init.body))).toEqual({
      uploadSessionId: 'sess-1',
      parts: [{ partNumber: 1, etag: '"etag-1"' }],
    });
  });

  it('completeFanvueUploadSession throws when no media id comes back', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}));
    await expect(
      completeFanvueUploadSession('at-1', 'sess-1', [{ partNumber: 1, etag: '"etag-1"' }]),
    ).rejects.toThrow('missing mediaId');
  });
});

describe('uploadVideoToFanvueVault', () => {
  const video = Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]);

  function queueSuccess(): void {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          uploadSessionId: 'sess-1',
          uploadUrls: [{ partNumber: 1, url: 'https://up.example/part-1' }],
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { etag: '"etag-1"' } }))
      .mockResolvedValueOnce(jsonResponse({ mediaId: 'media-1' }));
  }

  it('runs create session -> single-part upload -> complete and returns the media id', async () => {
    queueSuccess();
    const mediaId = await uploadVideoToFanvueVault({
      accessToken: 'at-1',
      video,
      filename: 'clip.mp4',
      contentType: 'video/mp4',
    });
    expect(mediaId).toBe('media-1');
    expect(mockFetch).toHaveBeenCalledTimes(3);
    const complete = call(2);
    expect(JSON.parse(String(complete.init.body))).toEqual({
      uploadSessionId: 'sess-1',
      parts: [{ partNumber: 1, etag: '"etag-1"' }],
    });
  });

  it('uses the part-1 URL when several part URLs come back', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          uploadSessionId: 'sess-1',
          uploadUrls: [
            { partNumber: 2, url: 'https://up.example/part-2' },
            { partNumber: 1, url: 'https://up.example/part-1' },
          ],
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { etag: '"etag-1"' } }))
      .mockResolvedValueOnce(jsonResponse({ mediaId: 'media-1' }));
    await expect(
      uploadVideoToFanvueVault({ accessToken: 'at-1', video, filename: 'clip.mp4', contentType: 'video/mp4' }),
    ).resolves.toBe('media-1');
    expect(call(1).url.href).toBe('https://up.example/part-1');
  });

  it('gives the vault byte upload a 10-minute budget, not the 15s JSON timeout', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          uploadSessionId: 'sess-1',
          uploadUrls: [{ partNumber: 1, url: 'https://up.example/part-1' }],
        }),
      )
      .mockImplementationOnce((_url: unknown, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
        }),
      );
    vi.useFakeTimers();
    try {
      const pending = uploadVideoToFanvueVault({
        accessToken: 'at-1',
        video,
        filename: 'clip.mp4',
        contentType: 'video/mp4',
      });
      const settled = vi.fn();
      pending.then(settled, settled);
      await vi.advanceTimersByTimeAsync(15_000);
      expect(settled).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(FANVUE_UPLOAD_TIMEOUT_MS - 15_000);
      await expect(pending).rejects.toThrow('aborted');
      expect(settled).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('createFanvuePost', () => {
  it('posts subscribers-only with the media id and returns the post id', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'post-1' }));
    const result = await createFanvuePost({
      accessToken: 'at-1',
      mediaId: 'media-1',
      content: 'My post\n\nThe description',
    });
    expect(result).toEqual({ postId: 'post-1' });
    const first = call(0);
    expect(`${first.url.origin}${first.url.pathname}`).toBe('https://api.fanvue.com/posts');
    expect(first.init.method).toBe('POST');
    expect(headersOf(first.init).Authorization).toBe('Bearer at-1');
    expect(headersOf(first.init)['X-Fanvue-API-Version']).toBe('2025-06-26');
    expect(JSON.parse(String(first.init.body))).toEqual({
      content: 'My post\n\nThe description',
      mediaIds: ['media-1'],
      isSubscribersOnly: true,
    });
  });

  it('throws when the created post carries no id', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}));
    await expect(
      createFanvuePost({ accessToken: 'at-1', mediaId: 'media-1', content: 'x' }),
    ).rejects.toThrow('missing id');
  });

  it('throws the Fanvue status when the post creation fails', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ message: 'forbidden' }, 403));
    await expect(
      createFanvuePost({ accessToken: 'at-1', mediaId: 'media-1', content: 'x' }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
