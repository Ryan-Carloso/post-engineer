// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { postBlueskyFirstComment } from '../bluesky';
import { postFacebookFirstComment } from '../facebook';
import { FirstCommentError } from '../http';
import { postInstagramFirstComment } from '../instagram';
import { postLinkedInFirstComment } from '../linkedin';
import { postThreadsFirstComment } from '../threads';
import { postYouTubeFirstComment } from '../youtube';

const fetchMock = vi.fn();

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function lastCall(index = 0): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls[index] as [string, RequestInit];
  return { url: call[0], init: call[1] };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('postYouTubeFirstComment', () => {
  it('inserts a top-level comment thread on the video with the bearer token', async () => {
    fetchMock.mockResolvedValueOnce(
      reply(200, { kind: 'youtube#commentThread', id: 'Ugx-thread-1', snippet: { videoId: 'vid-1' } }),
    );
    const id = await postYouTubeFirstComment({ accessToken: 'ya29.tok', videoId: 'vid-1', text: 'Link in bio' });
    expect(id).toBe('Ugx-thread-1');
    const { url, init } = lastCall();
    expect(url).toBe('https://www.googleapis.com/youtube/v3/commentThreads?part=snippet');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer ya29.tok');
    expect(JSON.parse(String(init.body))).toEqual({
      snippet: { videoId: 'vid-1', topLevelComment: { snippet: { textOriginal: 'Link in bio' } } },
    });
  });

  it('throws the status and the Google reason on an insufficient-scope answer', async () => {
    fetchMock.mockResolvedValueOnce(
      reply(403, {
        error: {
          code: 403,
          message: 'Request had insufficient authentication scopes.',
          errors: [{ reason: 'insufficientPermissions', domain: 'global' }],
          status: 'PERMISSION_DENIED',
        },
      }),
    );
    const error = await postYouTubeFirstComment({ accessToken: 't', videoId: 'v', text: 'x' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FirstCommentError);
    expect(error).toMatchObject({ statusCode: 403, reason: 'insufficientPermissions' });
  });
});

describe('postInstagramFirstComment', () => {
  it('posts the message on the published media id', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { id: '17900000000000001' }));
    const id = await postInstagramFirstComment({ accessToken: 'IGQ-tok', mediaId: '1790-media', text: 'Hello' });
    expect(id).toBe('17900000000000001');
    const { url, init } = lastCall();
    expect(url).toBe('https://graph.instagram.com/v23.0/1790-media/comments');
    const body = new URLSearchParams(String(init.body));
    expect(body.get('message')).toBe('Hello');
    expect(body.get('access_token')).toBe('IGQ-tok');
  });

  it('keeps the Meta error code of a permission failure', async () => {
    fetchMock.mockResolvedValueOnce(
      reply(400, { error: { message: '(#10) Application does not have permission', type: 'OAuthException', code: 10 } }),
    );
    const error = await postInstagramFirstComment({ accessToken: 't', mediaId: 'm', text: 'x' }).catch((e: unknown) => e);
    expect(error).toMatchObject({ statusCode: 400, providerCode: 10 });
  });

  it('fails when the answer has no comment id', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, {}));
    await expect(postInstagramFirstComment({ accessToken: 't', mediaId: 'm', text: 'x' })).rejects.toThrow('missing id');
  });
});

describe('postFacebookFirstComment', () => {
  it('posts the message on the Page post with the Page token', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { id: '111_222' }));
    const id = await postFacebookFirstComment({ pageAccessToken: 'page-tok', postId: '111_222', text: 'Hello' });
    expect(id).toBe('111_222');
    const { url, init } = lastCall();
    expect(url).toBe('https://graph.facebook.com/v23.0/111_222/comments');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer page-tok');
    expect(new URLSearchParams(String(init.body)).get('message')).toBe('Hello');
  });

  it('throws on a Graph error', async () => {
    fetchMock.mockResolvedValueOnce(reply(403, { error: { message: '(#200) Requires pages_manage_engagement', code: 200 } }));
    await expect(postFacebookFirstComment({ pageAccessToken: 't', postId: 'p', text: 'x' })).rejects.toMatchObject({
      statusCode: 403,
      providerCode: 200,
    });
  });
});

describe('postThreadsFirstComment', () => {
  it('creates a reply container with reply_to_id, then publishes it', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, { id: 'container-9' }))
      .mockResolvedValueOnce(reply(200, { id: 'reply-10' }));
    const id = await postThreadsFirstComment({ accessToken: 'th-tok', userId: 'u-1', postId: 'post-5', text: 'Hello' });
    expect(id).toBe('reply-10');
    const first = lastCall(0);
    expect(first.url).toBe('https://graph.threads.com/v1.0/u-1/threads');
    const container = new URLSearchParams(String(first.init.body));
    expect(Object.fromEntries(container.entries())).toEqual({
      media_type: 'TEXT',
      text: 'Hello',
      reply_to_id: 'post-5',
      access_token: 'th-tok',
    });
    const second = lastCall(1);
    expect(second.url).toBe('https://graph.threads.com/v1.0/u-1/threads_publish');
    expect(new URLSearchParams(String(second.init.body)).get('creation_id')).toBe('container-9');
  });

  it('does not publish when the container fails', async () => {
    fetchMock.mockResolvedValueOnce(reply(400, { error: { message: 'no permission', code: 10 } }));
    await expect(postThreadsFirstComment({ accessToken: 't', userId: 'u', postId: 'p', text: 'x' })).rejects.toMatchObject({
      providerCode: 10,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('postLinkedInFirstComment', () => {
  it('posts a comment on the post URN as the actor', async () => {
    fetchMock.mockResolvedValueOnce(
      reply(201, { commentUrn: 'urn:li:comment:(urn:li:share:7000,7001)', $URN: 'urn:li:comment:(urn:li:share:7000,7001)' }),
    );
    const id = await postLinkedInFirstComment({
      accessToken: 'li-tok',
      actorUrn: 'urn:li:person:abc',
      postUrn: 'urn:li:share:7000',
      text: 'Hello',
    });
    expect(id).toBe('urn:li:comment:(urn:li:share:7000,7001)');
    const { url, init } = lastCall();
    expect(url).toBe('https://api.linkedin.com/rest/socialActions/urn%3Ali%3Ashare%3A7000/comments');
    expect(JSON.parse(String(init.body))).toEqual({ actor: 'urn:li:person:abc', message: { text: 'Hello' } });
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer li-tok');
    expect(headers['X-Restli-Protocol-Version']).toBe('2.0.0');
  });

  it('refuses the placeholder URN the publish returns when LinkedIn sent none', async () => {
    await expect(
      postLinkedInFirstComment({ accessToken: 't', actorUrn: 'urn:li:person:a', postUrn: 'urn:li:share:unknown', text: 'x' }),
    ).rejects.toThrow('no post URN');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws the 403 LinkedIn answers without the scope', async () => {
    fetchMock.mockResolvedValueOnce(reply(403, { status: 403, message: 'Not enough permissions to access: socialActions.CREATE' }));
    await expect(
      postLinkedInFirstComment({ accessToken: 't', actorUrn: 'urn:li:person:a', postUrn: 'urn:li:share:1', text: 'x' }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('postBlueskyFirstComment', () => {
  const post = { uri: 'at://did:plc:abc/app.bsky.feed.post/3k44', cid: 'bafyreib2rxk3rybk3aobmv5cjuql3bm2twh4jo5uxgf5kpqcsgz7soitae' };

  it('creates a self-reply with the published post as root and parent', async () => {
    fetchMock.mockResolvedValueOnce(
      reply(200, { uri: 'at://did:plc:abc/app.bsky.feed.post/3k45', cid: 'bafyreic', commit: { rev: 'r', cid: 'c' } }),
    );
    const uri = await postBlueskyFirstComment({ accessJwt: 'jwt', did: 'did:plc:abc', post, text: 'Hello' });
    expect(uri).toBe('at://did:plc:abc/app.bsky.feed.post/3k45');
    const { url, init } = lastCall();
    expect(url).toBe('https://bsky.social/xrpc/com.atproto.repo.createRecord');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt');
    const payload = JSON.parse(String(init.body)) as { repo: string; collection: string; record: Record<string, unknown> };
    expect(payload.repo).toBe('did:plc:abc');
    expect(payload.collection).toBe('app.bsky.feed.post');
    expect(payload.record).toMatchObject({
      $type: 'app.bsky.feed.post',
      text: 'Hello',
      reply: { root: post, parent: post },
    });
  });

  it('fails before any request when the publish returned no cid', async () => {
    await expect(
      postBlueskyFirstComment({ accessJwt: 'jwt', did: 'did:plc:abc', post: { uri: post.uri, cid: '' }, text: 'x' }),
    ).rejects.toThrow('no cid');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('transport failures', () => {
  it('describes a non-JSON error body by its status', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>bad gateway</html>', { status: 502 }));
    await expect(postFacebookFirstComment({ pageAccessToken: 't', postId: 'p', text: 'x' })).rejects.toThrow('status 502');
  });
});
