// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  FACEBOOK_SCOPES,
  MAX_PAGE_LIST_PAGES,
  buildFacebookAuthorizationUrl,
  exchangeFacebookCodeForToken,
  fetchFacebookPageProfile,
  fetchFacebookPages,
  getFacebookVideoInsights,
  publishFacebookVideo,
} from '@/lib/facebook';
import { FacebookError } from '@/lib/errors';

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
  vi.stubEnv('FACEBOOK_CLIENT_ID', 'fb-cid');
  vi.stubEnv('FACEBOOK_CLIENT_SECRET', 'fb-secret');
  vi.stubEnv('FACEBOOK_REDIRECT_URI', 'https://app.example/fb/cb');
});

describe('buildFacebookAuthorizationUrl', () => {
  it('requests the Pages scopes with the Facebook app id and the state', () => {
    const url = new URL(buildFacebookAuthorizationUrl('st-1'));
    expect(`${url.origin}${url.pathname}`).toBe('https://www.facebook.com/v23.0/dialog/oauth');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('fb-cid');
    expect(url.searchParams.get('state')).toBe('st-1');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example/fb/cb');
    expect(url.searchParams.get('scope')).toBe('public_profile,pages_show_list,pages_read_engagement,pages_manage_posts');
    expect(FACEBOOK_SCOPES).toContain('pages_manage_posts');
  });

  it('uses the redirect override when given', () => {
    const url = new URL(buildFacebookAuthorizationUrl('st-1', 'http://localhost:3434/api/facebook-auth/callback'));
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3434/api/facebook-auth/callback');
  });

  it('fails explicitly when the client id is missing or empty', () => {
    vi.stubEnv('FACEBOOK_CLIENT_ID', undefined);
    expect(() => buildFacebookAuthorizationUrl('st-1')).toThrow('FACEBOOK_ENV_MISSING: FACEBOOK_CLIENT_ID');
    vi.stubEnv('FACEBOOK_CLIENT_ID', '');
    expect(() => buildFacebookAuthorizationUrl('st-1')).toThrow(FacebookError);
  });
});

describe('exchangeFacebookCodeForToken', () => {
  it('swaps the code for a short-lived token, then a long-lived one, and returns only the long-lived token', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ access_token: 'short' }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'long', expires_in: 100 }));

    await expect(exchangeFacebookCodeForToken('code-1')).resolves.toBe('long');

    const first = call(0);
    expect(`${first.url.origin}${first.url.pathname}`).toBe('https://graph.facebook.com/v23.0/oauth/access_token');
    expect(first.url.search).toBe('');
    expect(first.init.method).toBe('POST');
    const firstBody = new URLSearchParams(String(first.init.body));
    expect(firstBody.get('client_id')).toBe('fb-cid');
    expect(firstBody.get('client_secret')).toBe('fb-secret');
    expect(firstBody.get('code')).toBe('code-1');
    expect(firstBody.get('redirect_uri')).toBe('https://app.example/fb/cb');

    const second = call(1);
    expect(second.url.search).toBe('');
    const secondBody = new URLSearchParams(String(second.init.body));
    expect(secondBody.get('grant_type')).toBe('fb_exchange_token');
    expect(secondBody.get('fb_exchange_token')).toBe('short');
    expect(secondBody.get('client_secret')).toBe('fb-secret');
  });

  it('sends the redirect override used on the consent screen', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ access_token: 'short' }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'long' }));
    await exchangeFacebookCodeForToken('code-1', 'http://localhost/cb');
    expect(new URLSearchParams(String(call(0).init.body)).get('redirect_uri')).toBe('http://localhost/cb');
  });

  it("surfaces Meta's own error message with a stable code and the status", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: { message: 'Invalid verification code' } }, 400));
    const error = await exchangeFacebookCodeForToken('bad').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(FacebookError);
    expect((error as FacebookError).message).toBe('FACEBOOK_TOKEN_FAILED: Invalid verification code');
    expect((error as FacebookError).statusCode).toBe(400);
  });

  it('fails when a 200 carries no access token', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ access_token: 'short' })).mockResolvedValueOnce(jsonResponse({}));
    await expect(exchangeFacebookCodeForToken('code-1')).rejects.toThrow('FACEBOOK_TOKEN_FAILED: missing access_token');
  });

  it('treats a non-JSON body as a failure, never as success', async () => {
    mockFetch.mockResolvedValueOnce(new Response('<html>proxy</html>', { status: 200 }));
    await expect(exchangeFacebookCodeForToken('code-1')).rejects.toThrow('FACEBOOK_TOKEN_FAILED: invalid response body');
    mockFetch.mockResolvedValueOnce(new Response('<html>bad gateway</html>', { status: 502 }));
    await expect(exchangeFacebookCodeForToken('code-1')).rejects.toThrow('FACEBOOK_TOKEN_FAILED: status 502');
  });

  it('fails before any request when the secret is missing', async () => {
    vi.stubEnv('FACEBOOK_CLIENT_SECRET', undefined);
    await expect(exchangeFacebookCodeForToken('code-1')).rejects.toThrow('FACEBOOK_CLIENT_SECRET');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('fetchFacebookPages', () => {
  const page = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    name: `Page ${id}`,
    category: 'Media',
    access_token: `ptok-${id}`,
    picture: { data: { url: `https://scontent.xx.fbcdn.net/${id}.jpg` } },
    fan_count: 12,
    ...extra,
  });

  it('lists every managed Page with its Page token, sending the user token in the header only', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: [page('1'), page('2', { fan_count: 'n/a', picture: null })] }));

    await expect(fetchFacebookPages('user-tok')).resolves.toEqual([
      { id: '1', name: 'Page 1', category: 'Media', pictureUrl: 'https://scontent.xx.fbcdn.net/1.jpg', followersCount: 12, pageAccessToken: 'ptok-1' },
      { id: '2', name: 'Page 2', category: 'Media', pictureUrl: null, followersCount: null, pageAccessToken: 'ptok-2' },
    ]);
    const { url, init } = call(0);
    expect(url.pathname).toBe('/v23.0/me/accounts');
    expect(url.searchParams.get('fields')).toBe('id,name,category,picture{url},fan_count,access_token');
    expect(url.searchParams.has('access_token')).toBe(false);
    expect(authHeader(init)).toBe('Bearer user-tok');
  });

  it('skips entries without an id or a Page token instead of storing them half-formed', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: [page('1', { access_token: '' }), { name: 'no id', access_token: 'x' }, 'junk', page('3')] }));
    const pages = await fetchFacebookPages('user-tok');
    expect(pages.map((entry) => entry.id)).toEqual(['3']);
  });

  it('follows Graph paging cursors on the Graph host', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ data: [page('1')], paging: { next: 'https://graph.facebook.com/v23.0/me/accounts?after=abc' } }))
      .mockResolvedValueOnce(jsonResponse({ data: [page('2')] }));
    const pages = await fetchFacebookPages('user-tok');
    expect(pages.map((entry) => entry.id)).toEqual(['1', '2']);
    expect(call(1).url.searchParams.get('after')).toBe('abc');
    expect(authHeader(call(1).init)).toBe('Bearer user-tok');
  });

  it('never follows a cursor that leaves the Graph host', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: [page('1')], paging: { next: 'https://evil.example/steal' } }));
    await fetchFacebookPages('user-tok');
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: [page('1')], paging: { next: 'not a url' } }));
    await fetchFacebookPages('user-tok');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('stops after MAX_PAGE_LIST_PAGES Graph pages', async () => {
    mockFetch.mockImplementation(async () =>
      jsonResponse({ data: [page('x')], paging: { next: 'https://graph.facebook.com/v23.0/me/accounts?after=more' } }),
    );
    const pages = await fetchFacebookPages('user-tok');
    expect(mockFetch).toHaveBeenCalledTimes(MAX_PAGE_LIST_PAGES);
    expect(pages).toHaveLength(MAX_PAGE_LIST_PAGES);
  });

  it('returns no Pages for an account that manages none', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: [] }));
    await expect(fetchFacebookPages('user-tok')).resolves.toEqual([]);
  });

  it('throws a coded error when listing fails', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: { message: 'expired' } }, 401));
    await expect(fetchFacebookPages('user-tok')).rejects.toThrow('FACEBOOK_PAGES_FAILED: expired');
  });
});

describe('fetchFacebookPageProfile', () => {
  it('reads the Page profile with the Page token in the header', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: '111', name: 'My Page', category: 'Brand', picture: { data: { url: 'https://scontent.xx.fbcdn.net/p.jpg' } }, fan_count: 7 }));
    await expect(fetchFacebookPageProfile('111', 'ptok')).resolves.toEqual({
      id: '111',
      name: 'My Page',
      category: 'Brand',
      pictureUrl: 'https://scontent.xx.fbcdn.net/p.jpg',
      followersCount: 7,
    });
    const { url, init } = call(0);
    expect(url.pathname).toBe('/v23.0/111');
    expect(url.searchParams.has('access_token')).toBe(false);
    expect(authHeader(init)).toBe('Bearer ptok');
  });

  it('fails when the profile has no id', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ name: 'x' }));
    await expect(fetchFacebookPageProfile('111', 'ptok')).rejects.toThrow('FACEBOOK_PROFILE_FAILED: missing id');
  });

  it('encodes the Page id into the path', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'a/b' }));
    await fetchFacebookPageProfile('a/b', 'ptok');
    expect(String(mockFetch.mock.calls[0][0])).toContain('/v23.0/a%2Fb?');
  });
});

describe('publishFacebookVideo', () => {
  const input = { pageAccessToken: 'ptok', pageId: '111', videoUrl: 'https://s.example/v.mp4', description: 'hello', onPermalinkError: vi.fn() };

  beforeEach(() => {
    input.onPermalinkError.mockClear();
  });

  it('posts the video by URL to the Page and returns the id and permalink', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ id: 'vid-1' }))
      .mockResolvedValueOnce(jsonResponse({ permalink_url: '/111/videos/vid-1/' }));

    await expect(publishFacebookVideo(input)).resolves.toEqual({
      postId: 'vid-1',
      permalink: 'https://www.facebook.com/111/videos/vid-1/',
    });
    const publish = call(0);
    expect(publish.url.toString()).toBe('https://graph-video.facebook.com/v23.0/111/videos');
    expect(publish.init.method).toBe('POST');
    expect(authHeader(publish.init)).toBe('Bearer ptok');
    const body = new URLSearchParams(String(publish.init.body));
    expect(body.get('file_url')).toBe('https://s.example/v.mp4');
    expect(body.get('description')).toBe('hello');
    expect(body.has('access_token')).toBe(false);
    expect(call(1).url.searchParams.get('fields')).toBe('permalink_url');
    expect(input.onPermalinkError).not.toHaveBeenCalled();
  });

  it('keeps an absolute permalink and prefixes a relative one without a slash', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'v' })).mockResolvedValueOnce(jsonResponse({ permalink_url: 'https://www.facebook.com/reel/1' }));
    expect((await publishFacebookVideo(input)).permalink).toBe('https://www.facebook.com/reel/1');
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'v' })).mockResolvedValueOnce(jsonResponse({ permalink_url: 'watch/?v=1' }));
    expect((await publishFacebookVideo(input)).permalink).toBe('https://www.facebook.com/watch/?v=1');
  });

  it('keeps a published video successful when the permalink read fails', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'vid-1' })).mockResolvedValueOnce(jsonResponse({ error: { message: 'nope' } }, 500));
    await expect(publishFacebookVideo(input)).resolves.toEqual({ postId: 'vid-1', permalink: null });
    expect(input.onPermalinkError).toHaveBeenCalledWith(expect.objectContaining({ message: 'FACEBOOK_PERMALINK_FAILED: nope' }));
  });

  it('returns a null permalink when Graph has none', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'vid-1' })).mockResolvedValueOnce(jsonResponse({}));
    await expect(publishFacebookVideo(input)).resolves.toEqual({ postId: 'vid-1', permalink: null });
  });

  it('throws when the publish is rejected or returns no id', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: { message: 'no permission' } }, 403));
    await expect(publishFacebookVideo(input)).rejects.toThrow('FACEBOOK_PUBLISH_FAILED: no permission');
    mockFetch.mockResolvedValueOnce(jsonResponse({ success: true }));
    await expect(publishFacebookVideo(input)).rejects.toThrow('FACEBOOK_PUBLISH_FAILED: missing id');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe('getFacebookVideoInsights', () => {
  it('reads views from video_insights and like/comment totals from the summaries', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ data: [{ name: 'total_video_views', values: [{ value: 120 }] }, { name: 'bad', values: [] }, 'junk'] }))
      .mockResolvedValueOnce(jsonResponse({ likes: { summary: { total_count: 9 } }, comments: { summary: { total_count: 2 } } }));

    await expect(getFacebookVideoInsights('ptok', 'vid-1')).resolves.toEqual({ total_video_views: 120, likes: 9, comments: 2 });
    expect(call(0).url.pathname).toBe('/v23.0/vid-1/video_insights');
    expect(call(0).url.searchParams.get('metric')).toBe('total_video_views');
    expect(authHeader(call(0).init)).toBe('Bearer ptok');
    expect(call(1).url.searchParams.get('fields')).toBe('likes.summary(true).limit(0),comments.summary(true).limit(0)');
  });

  it('leaves out counters Graph does not report', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: [] })).mockResolvedValueOnce(jsonResponse({ likes: { summary: {} } }));
    await expect(getFacebookVideoInsights('ptok', 'vid-1')).resolves.toEqual({});
  });

  it('throws on an HTTP error so the collector retries on the next run', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: { message: 'rate limited' } }, 429));
    await expect(getFacebookVideoInsights('ptok', 'vid-1')).rejects.toThrow('FACEBOOK_INSIGHTS_FAILED: rate limited');
  });
});
