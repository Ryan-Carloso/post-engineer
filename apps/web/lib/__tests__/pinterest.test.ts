// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PINTEREST_DESCRIPTION_MAX_CHARS,
  PINTEREST_SCOPES,
  PINTEREST_TITLE_MAX_CHARS,
  PINTEREST_VIDEO_MAX_BYTES,
  MAX_BOARD_LIST_PAGES,
  buildPinterestAuthorizationUrl,
  exchangePinterestCodeForToken,
  fetchPinterestBoards,
  fetchPinterestUserProfile,
  publishPinterestVideo,
  refreshPinterestAccessToken,
} from '@/lib/pinterest';
import { PinterestError } from '@/lib/errors';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function call(index: number): { url: URL; init: RequestInit } {
  const [url, init] = mockFetch.mock.calls[index] as [string, RequestInit];
  return { url: new URL(url), init };
}

function authHeader(init: RequestInit): string | undefined {
  const headers = init.headers as Record<string, string> | undefined;
  return headers?.Authorization;
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubEnv('PINTEREST_CLIENT_ID', 'pin-cid');
  vi.stubEnv('PINTEREST_CLIENT_SECRET', 'pin-secret');
  vi.stubEnv('PINTEREST_REDIRECT_URI', 'https://app.example/pin/cb');
});

describe('buildPinterestAuthorizationUrl', () => {
  it('requests the v5 scopes with the Pinterest app id and the state', () => {
    const url = new URL(buildPinterestAuthorizationUrl('st-1'));
    expect(`${url.origin}${url.pathname}`).toBe('https://www.pinterest.com/oauth/');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('pin-cid');
    expect(url.searchParams.get('state')).toBe('st-1');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example/pin/cb');
    expect(url.searchParams.get('scope')).toBe('boards:read,boards:write,pins:read,pins:write,user_accounts:read');
    expect(PINTEREST_SCOPES).toContain('pins:write');
  });

  it('uses the redirect override when given', () => {
    const url = new URL(buildPinterestAuthorizationUrl('st-1', 'http://localhost:3434/api/pinterest-auth/callback'));
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3434/api/pinterest-auth/callback');
  });

  it('fails explicitly when the client id is missing or empty', () => {
    vi.stubEnv('PINTEREST_CLIENT_ID', undefined);
    expect(() => buildPinterestAuthorizationUrl('st-1')).toThrow('PINTEREST_ENV_MISSING: PINTEREST_CLIENT_ID');
    vi.stubEnv('PINTEREST_CLIENT_ID', '');
    expect(() => buildPinterestAuthorizationUrl('st-1')).toThrow(PinterestError);
  });
});

describe('exchangePinterestCodeForToken', () => {
  it('swaps the code for tokens with HTTP Basic auth (client id:secret)', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 2592000, token_type: 'Bearer' }),
    );

    const token = await exchangePinterestCodeForToken('code-1');
    expect(token).toEqual({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 2592000, token_type: 'Bearer' });

    const first = call(0);
    expect(`${first.url.origin}${first.url.pathname}`).toBe('https://api.pinterest.com/v5/oauth/token');
    expect(first.init.method).toBe('POST');
    expect(authHeader(first.init)).toBe(`Basic ${Buffer.from('pin-cid:pin-secret').toString('base64')}`);
    const body = new URLSearchParams(String(first.init.body));
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('code-1');
    expect(body.get('redirect_uri')).toBe('https://app.example/pin/cb');
  });

  it('throws the Pinterest status when the exchange fails', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ code: 400, message: 'bad code' }, 400));
    await expect(exchangePinterestCodeForToken('code-1')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('throws when the response carries no access token', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ refresh_token: 'rt-1' }));
    await expect(exchangePinterestCodeForToken('code-1')).rejects.toThrow('missing access_token');
  });
});

describe('refreshPinterestAccessToken', () => {
  it('exchanges the refresh token for a new pair', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ access_token: 'at-2', refresh_token: 'rt-2', expires_in: 2592000, token_type: 'Bearer' }),
    );
    const token = await refreshPinterestAccessToken('rt-1');
    expect(token.access_token).toBe('at-2');
    expect(token.refresh_token).toBe('rt-2');
    const body = new URLSearchParams(String(call(0).init.body));
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('rt-1');
  });
});

describe('fetchPinterestUserProfile', () => {
  it('reads the v5 user_account id, username and profile image', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ id: 'user-1', username: 'maker', profile_image: 'https://i.pinimg.com/p.jpg' }),
    );
    await expect(fetchPinterestUserProfile('at-1')).resolves.toEqual({
      id: 'user-1',
      username: 'maker',
      profileImage: 'https://i.pinimg.com/p.jpg',
    });
    const first = call(0);
    expect(`${first.url.origin}${first.url.pathname}`).toBe('https://api.pinterest.com/v5/user_account');
    expect(authHeader(first.init)).toBe('Bearer at-1');
  });

  it('throws when the profile carries no id', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ username: 'maker' }));
    await expect(fetchPinterestUserProfile('at-1')).rejects.toThrow('missing id');
  });
});

describe('fetchPinterestBoards', () => {
  it('pages with the bookmark cursor and skips entries without an id', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ items: [{ id: 'b1', name: 'Board One' }, { name: 'no id' }], bookmark: 'bm-1' }))
      .mockResolvedValueOnce(jsonResponse({ items: [{ id: 'b2', name: 'Board Two', description: 'd' }] }));
    await expect(fetchPinterestBoards('at-1')).resolves.toEqual([
      { id: 'b1', name: 'Board One', description: null },
      { id: 'b2', name: 'Board Two', description: 'd' },
    ]);
    expect(call(0).url.searchParams.get('page_size')).toBe('100');
    expect(call(0).url.searchParams.get('bookmark')).toBeNull();
    expect(call(1).url.searchParams.get('bookmark')).toBe('bm-1');
    expect(MAX_BOARD_LIST_PAGES).toBe(5);
  });
});

describe('publishPinterestVideo', () => {
  const video = Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]);

  function registerResponse(): Record<string, unknown> {
    return {
      media_id: 'm-1',
      upload_url: 'https://s3.example/upload',
      upload_parameters: { key: 'k-1', 'x-amz-algorithm': 'AWS4-HMAC-SHA256', policy: 'pol' },
    };
  }

  function queueSuccess(options: { coverImageUrl?: string } = {}): void {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(registerResponse()))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse({ media_id: 'm-1', status: 'registered' }))
      .mockResolvedValueOnce(jsonResponse({ media_id: 'm-1', status: 'processing' }))
      .mockResolvedValueOnce(jsonResponse({ media_id: 'm-1', status: 'succeeded' }))
      .mockResolvedValueOnce(jsonResponse({ id: '123456789' }));
  }

  it('runs the four steps and returns the pin id and permalink', async () => {
    queueSuccess();
    const sleep = vi.fn(async () => {});
    const result = await publishPinterestVideo({
      accessToken: 'at-1',
      boardId: 'b1',
      video,
      filename: 'clip.mp4',
      contentType: 'video/mp4',
      title: 'My pin',
      description: 'The description',
      sleep,
    });
    expect(result).toEqual({ pinId: '123456789', permalink: 'https://www.pinterest.com/pin/123456789/' });

    const register = call(0);
    expect(register.init.method).toBe('POST');
    expect(JSON.parse(String(register.init.body))).toEqual({ media_type: 'video' });

    const upload = call(1);
    expect(upload.url.href).toBe('https://s3.example/upload');
    const form = upload.init.body as FormData;
    expect(form.get('key')).toBe('k-1');
    expect(form.get('policy')).toBe('pol');
    const file = form.get('file');
    expect(file).toBeInstanceOf(Blob);
    expect((file as File).name).toBe('clip.mp4');
    expect((file as File).type).toBe('video/mp4');

    const poll = call(3);
    expect(`${poll.url.origin}${poll.url.pathname}`).toBe('https://api.pinterest.com/v5/media/m-1');
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(5000);

    const pin = call(5);
    expect(`${pin.url.origin}${pin.url.pathname}`).toBe('https://api.pinterest.com/v5/pins');
    expect(JSON.parse(String(pin.init.body))).toEqual({
      board_id: 'b1',
      media_source: { source_type: 'video_id', media_id: 'm-1' },
      title: 'My pin',
      description: 'The description',
      cover_image_key_frame_time: 0,
    });
  });

  it('sends a caller cover image instead of the first-frame keyframe', async () => {
    queueSuccess();
    await publishPinterestVideo({
      accessToken: 'at-1',
      boardId: 'b1',
      video,
      filename: 'clip.mp4',
      contentType: 'video/mp4',
      coverImageUrl: 'https://cdn.example/frame.jpg',
      sleep: async () => {},
    });
    const pin = call(5);
    const body = JSON.parse(String(pin.init.body)) as Record<string, unknown>;
    expect(body.cover_image_url).toBe('https://cdn.example/frame.jpg');
    expect(body).not.toHaveProperty('cover_image_key_frame_time');
  });

  it('throws when media processing fails', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(registerResponse()))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse({ media_id: 'm-1', status: 'failed' }));
    await expect(
      publishPinterestVideo({ accessToken: 'at-1', boardId: 'b1', video, filename: 'clip.mp4', contentType: 'video/mp4', sleep: async () => {} }),
    ).rejects.toThrow('media processing failed');
  });

  it('times out when the poll budget runs out', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(registerResponse()))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse({ media_id: 'm-1', status: 'processing' }))
      .mockResolvedValueOnce(jsonResponse({ media_id: 'm-1', status: 'processing' }));
    const sleep = vi.fn(async () => {});
    await expect(
      publishPinterestVideo({
        accessToken: 'at-1',
        boardId: 'b1',
        video,
        filename: 'clip.mp4',
        contentType: 'video/mp4',
        maxPolls: 2,
        sleep,
      }),
    ).rejects.toMatchObject({ statusCode: 504 });
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('throws when the S3 upload is rejected', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(registerResponse()))
      .mockResolvedValueOnce(new Response(null, { status: 403 }));
    await expect(
      publishPinterestVideo({ accessToken: 'at-1', boardId: 'b1', video, filename: 'clip.mp4', contentType: 'video/mp4', sleep: async () => {} }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('throws when the register step carries no media id', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ upload_url: 'https://s3.example/upload', upload_parameters: {} }));
    await expect(
      publishPinterestVideo({ accessToken: 'at-1', boardId: 'b1', video, filename: 'clip.mp4', contentType: 'video/mp4', sleep: async () => {} }),
    ).rejects.toThrow('missing media_id');
  });
});

describe('Pinterest limits', () => {
  it('pins the title, description and video ceilings', () => {
    expect(PINTEREST_TITLE_MAX_CHARS).toBe(100);
    expect(PINTEREST_DESCRIPTION_MAX_CHARS).toBe(800);
    expect(PINTEREST_VIDEO_MAX_BYTES).toBe(2 * 1024 * 1024 * 1024);
  });
});
