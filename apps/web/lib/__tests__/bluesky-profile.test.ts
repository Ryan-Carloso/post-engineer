import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BlueskyProfileError, fetchBlueskyPublicProfile } from '@/lib/bluesky-profile';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('fetchBlueskyPublicProfile', () => {
  beforeEach(() => mockFetch.mockReset());

  it('reads the public AppView profile by actor with a timeout and no redirects', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      did: 'did:plc:abc',
      handle: 'me.bsky.social',
      displayName: 'Me',
      avatar: 'https://cdn.bsky.app/img/avatar/a.jpg',
    }), { status: 200 }));

    const profile = await fetchBlueskyPublicProfile('did:plc:abc');

    expect(profile).toEqual({
      did: 'did:plc:abc',
      handle: 'me.bsky.social',
      displayName: 'Me',
      avatar: 'https://cdn.bsky.app/img/avatar/a.jpg',
    });
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=did%3Aplc%3Aabc');
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('maps a missing or blank display name and avatar to null', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ did: 'd', handle: 'h', displayName: '  ' }), { status: 200 }));
    expect(await fetchBlueskyPublicProfile('d')).toEqual({ did: 'd', handle: 'h', displayName: null, avatar: null });
  });

  it('throws a coded error with the status on non-2xx', async () => {
    mockFetch.mockResolvedValueOnce(new Response('{}', { status: 400 }));
    const error = await fetchBlueskyPublicProfile('d').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BlueskyProfileError);
    expect((error as BlueskyProfileError).message).toBe('BLUESKY_PROFILE_FAILED: status 400');
    expect((error as BlueskyProfileError).status).toBe(400);
  });

  it('throws on a non-JSON or non-object body', async () => {
    mockFetch.mockResolvedValueOnce(new Response('<html>', { status: 200 }));
    await expect(fetchBlueskyPublicProfile('d')).rejects.toThrow('non-JSON body');
    mockFetch.mockResolvedValueOnce(new Response('null', { status: 200 }));
    await expect(fetchBlueskyPublicProfile('d')).rejects.toThrow('empty body');
  });

  it('throws when did or handle is missing', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ did: 'd' }), { status: 200 }));
    await expect(fetchBlueskyPublicProfile('d')).rejects.toThrow('missing did or handle');
  });
});
