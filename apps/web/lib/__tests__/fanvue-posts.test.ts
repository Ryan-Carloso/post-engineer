// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FANVUE_POST_TEXT_MAX_LENGTH, createFanvuePost } from '@/lib/fanvue-posts';
import { FANVUE_API_VERSION } from '@/lib/fanvue-http';

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
});

describe('createFanvuePost', () => {
  it('posts subscribers-only with the media uuid and returns the new post uuid', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ uuid: 'post-1' }, 201));

    const result = await createFanvuePost({
      accessToken: 'at-1',
      mediaUuid: 'media-1',
      text: 'My post\n\nThe description',
    });
    expect(result).toEqual({ postId: 'post-1' });

    const first = call(0);
    expect(`${first.url.origin}${first.url.pathname}`).toBe('https://api.fanvue.com/posts');
    expect(first.init.method).toBe('POST');
    expect(headersOf(first.init).Authorization).toBe('Bearer at-1');
    expect(headersOf(first.init)['X-Fanvue-API-Version']).toBe(FANVUE_API_VERSION);
    expect(JSON.parse(String(first.init.body))).toEqual({
      text: 'My post\n\nThe description',
      mediaUuids: ['media-1'],
      audience: 'subscribers',
    });
  });

  it('rejects an over-length text instead of truncating it', async () => {
    await expect(
      createFanvuePost({
        accessToken: 'at-1',
        mediaUuid: 'media-1',
        text: 'a'.repeat(FANVUE_POST_TEXT_MAX_LENGTH + 1),
      }),
    ).rejects.toThrow(`text exceeds ${FANVUE_POST_TEXT_MAX_LENGTH} characters`);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('accepts text exactly at the ceiling', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ uuid: 'post-1' }, 201));
    await expect(
      createFanvuePost({
        accessToken: 'at-1',
        mediaUuid: 'media-1',
        text: 'a'.repeat(FANVUE_POST_TEXT_MAX_LENGTH),
      }),
    ).resolves.toEqual({ postId: 'post-1' });
  });

  it('throws when the created post carries no uuid', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}));
    await expect(
      createFanvuePost({ accessToken: 'at-1', mediaUuid: 'media-1', text: 'x' }),
    ).rejects.toThrow('missing uuid');
  });

  it('throws the Fanvue status when the post creation fails', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ message: 'forbidden' }, 403));
    await expect(
      createFanvuePost({ accessToken: 'at-1', mediaUuid: 'media-1', text: 'x' }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
