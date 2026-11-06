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
  publishThreadsVideo,
} from '@/lib/threads';
import { findRepoRoot } from '@/test/repo-root';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const noSleep = vi.fn(async () => undefined);
const input = { accessToken: 'tok-secret', userId: '42', videoUrl: 'https://s.example/v.mp4', text: 'hello', sleep: noSleep };

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

describe('publishThreadsVideo', () => {
  it('waits for FINISHED before publishing and returns the permalink', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ id: 'c1' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'IN_PROGRESS' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'FINISHED' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'p1' }))
      .mockResolvedValueOnce(jsonResponse({ permalink: 'https://www.threads.net/@a/post/x' }));
    await expect(publishThreadsVideo(input)).resolves.toEqual({ postId: 'p1', permalink: 'https://www.threads.net/@a/post/x' });
    expect(noSleep).toHaveBeenCalledTimes(1);
    expect(String(mockFetch.mock.calls[3][0])).toContain('/42/threads_publish');
    const containerBody = new URLSearchParams(String((mockFetch.mock.calls[0][1] as RequestInit).body));
    expect(containerBody.get('media_type')).toBe('VIDEO');
    expect(containerBody.get('video_url')).toBe(input.videoUrl);
  });

  it('never publishes a container that errored, and surfaces Meta\'s reason', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ id: 'c1' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'ERROR', error_message: 'bad codec' }));
    await expect(publishThreadsVideo(input)).rejects.toThrow('THREADS_CONTAINER_FAILED: bad codec');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('gives up after the poll budget without publishing', async () => {
    mockFetch.mockImplementation(async (url: string) =>
      jsonResponse(String(url).endsWith('/threads') ? { id: 'c1' } : { status: 'IN_PROGRESS' }));
    await expect(publishThreadsVideo(input)).rejects.toThrow('THREADS_CONTAINER_TIMEOUT');
    expect(mockFetch.mock.calls.some(([url]) => String(url).includes('threads_publish'))).toBe(false);
  });

  it('keeps a live post a success when the permalink read fails, and reports the failure', async () => {
    const onPermalinkError = vi.fn();
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ id: 'c1' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'FINISHED' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'p1' }))
      .mockResolvedValueOnce(jsonResponse({}, 500));
    await expect(publishThreadsVideo({ ...input, onPermalinkError })).resolves.toEqual({ postId: 'p1', permalink: null });
    expect(onPermalinkError).toHaveBeenCalledTimes(1);
  });

  it('does not put the access token in a raised message', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}, 500));
    const error = await publishThreadsVideo(input).catch((caught: Error) => caught);
    expect(String(error)).not.toContain('tok-secret');
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
    const model = readFileSync(join(root, 'apps/engine/app/models/publish.py'), 'utf8');
    expect(model).toContain(`caption: str = Field(min_length=1, max_length=${THREADS_TEXT_MAX_CHARS})`);
  });

  it('adds the account column and the metrics provider in the migration', () => {
    const root = findRepoRoot(import.meta.url);
    const migration = readFileSync(join(root, 'supabase/migrations/034_threads-provider.sql'), 'utf8');
    expect(migration).toContain("'linkedin', 'threads'");
    expect(migration).toContain('threads_account_ids');
  });
});
