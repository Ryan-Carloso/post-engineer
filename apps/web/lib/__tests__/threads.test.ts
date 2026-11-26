// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  THREADS_TEXT_MAX_CHARS,
  buildThreadsAuthorizationUrl,
  exchangeThreadsCodeForToken,
  fetchThreadsProfile,
  getThreadsInsights,
  publishThreadsMedia,
  refreshThreadsToken,
} from '@/lib/threads';
import { ThreadsError } from '@/lib/errors';
import { findRepoRoot } from '@/test/repo-root';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const noSleep = vi.fn(async () => undefined);
const input = { accessToken: 'tok-secret', userId: '42', media: { kind: 'video' as const, url: 'https://s.example/v.mp4' }, text: 'hello', sleep: noSleep };

beforeEach(() => {
  mockFetch.mockReset();
  noSleep.mockClear();
  vi.stubEnv('INSTAGRAM_CLIENT_ID', 'ig-cid');
  vi.stubEnv('INSTAGRAM_CLIENT_SECRET', 'ig-csecret');
  vi.stubEnv('THREADS_CLIENT_ID', 'tcid');
  vi.stubEnv('THREADS_CLIENT_SECRET', 'tcsecret');
  vi.stubEnv('THREADS_REDIRECT_URI', 'https://app.example/cb');
});

describe('buildThreadsAuthorizationUrl', () => {
  it('requests the publish and insights scopes with the Threads app id', () => {
    const url = new URL(buildThreadsAuthorizationUrl('st-1'));
    expect(url.origin).toBe('https://threads.com');
    expect(url.searchParams.get('client_id')).toBe('tcid');
    expect(url.searchParams.get('state')).toBe('st-1');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example/cb');
    expect(url.searchParams.get('scope')).toBe('threads_basic,threads_content_publish,threads_manage_insights');
  });

  it('fails when the Threads client id is missing and ignores a leftover Instagram client id', () => {
    vi.stubEnv('THREADS_CLIENT_ID', undefined);
    expect(() => buildThreadsAuthorizationUrl('st-1')).toThrow('THREADS_CLIENT_ID');
  });
});

describe('exchangeThreadsCodeForToken', () => {
  it('swaps the short-lived token for the long-lived one and returns only that', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ access_token: 'short', user_id: 42 }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'long', expires_in: 100 }));
    await expect(exchangeThreadsCodeForToken('code-1')).resolves.toEqual({ access_token: 'long', expires_in: 100 });
    expect(String(mockFetch.mock.calls[0][0])).toBe('https://graph.threads.com/oauth/access_token');
    const tokenBody = new URLSearchParams(String((mockFetch.mock.calls[0][1] as RequestInit).body));
    expect(tokenBody.get('client_id')).toBe('tcid');
    expect(tokenBody.get('client_secret')).toBe('tcsecret');
    const exchangeUrl = new URL(String(mockFetch.mock.calls[1][0]));
    expect(exchangeUrl.origin + exchangeUrl.pathname).toBe('https://graph.threads.com/access_token');
    expect(exchangeUrl.searchParams.get('grant_type')).toBe('th_exchange_token');
    expect(exchangeUrl.searchParams.get('client_secret')).toBe('tcsecret');
    expect(exchangeUrl.searchParams.get('access_token')).toBe('short');
  });

  it('throws on a 200 without a token', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}));
    await expect(exchangeThreadsCodeForToken('code-1')).rejects.toThrow('missing access_token');
  });
});

describe('fetchThreadsProfile', () => {
  it('throws on a non-JSON body instead of crashing on parse', async () => {
    mockFetch.mockResolvedValueOnce(new Response('<html>', { status: 502 }));
    await expect(fetchThreadsProfile('tok')).rejects.toThrow('THREADS_PROFILE_FAILED: status 502');
  });
});

describe('publishThreadsMedia', () => {
  it('waits for FINISHED before publishing and returns the permalink', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ id: 'c1' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'IN_PROGRESS' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'FINISHED' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'p1' }))
      .mockResolvedValueOnce(jsonResponse({ permalink: 'https://www.threads.net/@a/post/x' }));
    await expect(publishThreadsMedia(input)).resolves.toEqual({ postId: 'p1', permalink: 'https://www.threads.net/@a/post/x' });
    expect(noSleep).toHaveBeenCalledTimes(1);
    expect(String(mockFetch.mock.calls[3][0])).toContain('/42/threads_publish');
    const containerBody = new URLSearchParams(String((mockFetch.mock.calls[0][1] as RequestInit).body));
    expect(containerBody.get('media_type')).toBe('VIDEO');
    expect(containerBody.get('video_url')).toBe(input.media.url);
  });

  it('marks the container as made with AI only when aiLabel is set', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ id: 'c1' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'FINISHED' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'p1' }))
      .mockResolvedValueOnce(jsonResponse({ permalink: 'https://www.threads.net/@a/post/x' }));
    await publishThreadsMedia({ ...input, aiLabel: true });
    const labelled = new URLSearchParams(String((mockFetch.mock.calls[0][1] as RequestInit).body));
    expect(labelled.get('is_made_with_ai')).toBe('true');

    mockFetch.mockClear();
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ id: 'c1' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'FINISHED' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'p1' }))
      .mockResolvedValueOnce(jsonResponse({ permalink: 'https://www.threads.net/@a/post/x' }));
    await publishThreadsMedia(input);
    const unlabelled = new URLSearchParams(String((mockFetch.mock.calls[0][1] as RequestInit).body));
    expect(unlabelled.has('is_made_with_ai')).toBe(false);
  });

  it('creates an IMAGE container with image_url for an image, and no video_url', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ id: 'c1' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'FINISHED' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'p1' }))
      .mockResolvedValueOnce(jsonResponse({ permalink: 'https://www.threads.net/@a/post/y' }));
    const image = { ...input, media: { kind: 'image' as const, url: 'https://s.example/i.jpg' } };
    await expect(publishThreadsMedia(image)).resolves.toEqual({ postId: 'p1', permalink: 'https://www.threads.net/@a/post/y' });
    const containerBody = new URLSearchParams(String((mockFetch.mock.calls[0][1] as RequestInit).body));
    expect(containerBody.get('media_type')).toBe('IMAGE');
    expect(containerBody.get('image_url')).toBe('https://s.example/i.jpg');
    expect(containerBody.has('video_url')).toBe(false);
  });

  it('never publishes a container that errored, and surfaces Meta\'s reason', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ id: 'c1' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'ERROR', error_message: 'bad codec' }));
    await expect(publishThreadsMedia(input)).rejects.toThrow('THREADS_CONTAINER_FAILED: bad codec');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('gives up after the poll budget without publishing', async () => {
    mockFetch.mockImplementation(async (url: string) =>
      jsonResponse(String(url).endsWith('/threads') ? { id: 'c1' } : { status: 'IN_PROGRESS' }));
    await expect(publishThreadsMedia(input)).rejects.toThrow('THREADS_CONTAINER_TIMEOUT');
    expect(mockFetch.mock.calls.some(([url]) => String(url).includes('threads_publish'))).toBe(false);
  });

  it('keeps a live post a success when the permalink read fails, and reports the failure', async () => {
    const onPermalinkError = vi.fn();
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ id: 'c1' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'FINISHED' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'p1' }))
      .mockResolvedValueOnce(jsonResponse({}, 500));
    await expect(publishThreadsMedia({ ...input, onPermalinkError })).resolves.toEqual({ postId: 'p1', permalink: null });
    expect(onPermalinkError).toHaveBeenCalledTimes(1);
  });

  it('does not put the access token in a raised message', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}, 500));
    const error = await publishThreadsMedia(input).catch((caught: Error) => caught);
    expect(String(error)).not.toContain('tok-secret');
  });

  it('keeps the Meta provider code when a dead token answers 400 + code 190', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: 190,
            message: 'Error validating access token: The session has been invalidated.',
            type: 'OAuthException',
          },
        },
        400,
      ),
    );
    const error = await publishThreadsMedia(input).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ThreadsError);
    expect((error as ThreadsError).statusCode).toBe(400);
    expect((error as ThreadsError).providerCode).toBe(190);
    expect((error as ThreadsError).message).toContain('Error validating access token');
  });
});

describe('getThreadsInsights', () => {
  it('maps each metric name to its value and skips malformed entries', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({
      data: [
        { name: 'views', values: [{ value: 10 }] },
        { name: 'replies', values: [{ value: 2 }] },
        { name: 'likes', values: [] },
      ],
    }));
    await expect(getThreadsInsights('tok', 'p1')).resolves.toEqual({ views: 10, replies: 2 });
  });
});

describe('literals shared with the engine and the schema', () => {
  it('pins the 500-character limit in the engine', () => {
    const root = findRepoRoot(import.meta.url);
    const publisher = readFileSync(join(root, 'apps/engine/app/services/upload_publisher.py'), 'utf8');
    expect(publisher).toContain(`THREADS_CAPTION_MAX_LENGTH: int = ${THREADS_TEXT_MAX_CHARS}`);
  });

  it('adds the account column and the metrics provider in the migration', () => {
    const root = findRepoRoot(import.meta.url);
    const migration = readFileSync(join(root, 'supabase/migrations/034_threads-provider.sql'), 'utf8');
    expect(migration).toContain("'linkedin', 'threads'");
    expect(migration).toContain('threads_account_ids');
  });
});

describe('refreshThreadsToken', () => {
  it('exchanges the long-lived token with th_refresh_token and returns the new token', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ access_token: 'fresh', token_type: 'bearer', expires_in: 5_184_000 }));

    await expect(refreshThreadsToken('old-tok')).resolves.toEqual({ access_token: 'fresh', expires_in: 5_184_000 });

    const url = new URL(String(mockFetch.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe('https://graph.threads.com/refresh_access_token');
    expect(url.searchParams.get('grant_type')).toBe('th_refresh_token');
    expect(url.searchParams.get('access_token')).toBe('old-tok');
    const init = mockFetch.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('keeps Meta code 190 so an invalidated token reads as unauthorized, without the token in the message', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ error: { message: 'Error validating access token', type: 'OAuthException', code: 190 } }, 400),
    );

    const error = await refreshThreadsToken('old-tok').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ThreadsError);
    expect((error as ThreadsError).providerCode).toBe(190);
    expect((error as ThreadsError).message).toBe('THREADS_TOKEN_REFRESH_FAILED: Error validating access token');
    expect((error as ThreadsError).message).not.toContain('old-tok');
  });

  it.each([
    ['no access token', { expires_in: 100 }, 'missing access_token'],
    ['no lifetime', { access_token: 'fresh' }, 'missing expires_in'],
    ['a zero lifetime', { access_token: 'fresh', expires_in: 0 }, 'missing expires_in'],
  ])('rejects a 200 answer with %s', async (_label, body, message) => {
    mockFetch.mockResolvedValueOnce(jsonResponse(body));
    await expect(refreshThreadsToken('old-tok')).rejects.toThrow(message);
  });
});
