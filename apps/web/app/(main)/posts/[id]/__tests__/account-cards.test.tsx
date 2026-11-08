import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const mockQueries = vi.hoisted(() => ({
  youtube: { data: undefined as undefined | { accounts: unknown[] } },
  instagram: { data: undefined as undefined | { accounts: unknown[] } },
  linkedin: { data: undefined as undefined | { accounts: unknown[] } },
  bluesky: { data: undefined as undefined | { accounts: unknown[] } },
  threads: { data: undefined as undefined | { accounts: unknown[] } },
  facebook: { data: undefined as undefined | { accounts: unknown[] } },
}));

vi.mock('@/lib/api', () => ({
  useYouTubeAccountsQuery: () => mockQueries.youtube,
  useInstagramAccountsQuery: () => mockQueries.instagram,
  useLinkedinAccountsQuery: () => mockQueries.linkedin,
  useBlueskyAccountsQuery: () => mockQueries.bluesky,
  useThreadsAccountsQuery: () => mockQueries.threads,
  useFacebookAccountsQuery: () => mockQueries.facebook,
}));

import { usePostAccountCards } from '../account-cards';

describe('usePostAccountCards', () => {
  beforeEach(() => {
    for (const key of Object.keys(mockQueries) as (keyof typeof mockQueries)[]) {
      mockQueries[key] = { data: undefined };
    }
  });

  it('returns no cards while every account query is still empty', () => {
    const { result } = renderHook(() => usePostAccountCards());
    expect(result.current).toEqual([]);
  });

  it('maps every provider to the shared card props with its own id field', () => {
    mockQueries.youtube = { data: { accounts: [{ channelId: 'UC-1', channelName: 'Chan', email: 'a@b.c', thumbnail: 'https://yt/t.png' }] } };
    mockQueries.instagram = { data: { accounts: [{ igUserId: 'ig-1', username: 'insta', profilePictureUrl: 'https://ig/p.png' }] } };
    mockQueries.linkedin = { data: { accounts: [{ providerAccountId: 'li-1', accountName: null }] } };
    mockQueries.bluesky = { data: { accounts: [{ did: 'did:plc:1', handle: 'me.bsky.social' }] } };
    mockQueries.threads = { data: { accounts: [{ providerAccountId: 'th-1', accountName: 'thr', profilePictureUrl: 'https://th/p.png' }] } };
    mockQueries.facebook = {
      data: {
        accounts: [
          { providerAccountId: 'fb-1', accountName: 'My Page', profilePictureUrl: 'https://fb/p.png' },
          { providerAccountId: 'fb-2', accountName: null },
        ],
      },
    };

    const { result } = renderHook(() => usePostAccountCards());

    expect(result.current).toEqual([
      { id: 'UC-1', type: 'youtube', name: 'Chan', email: 'a@b.c', thumbnail: 'https://yt/t.png' },
      { id: 'ig-1', type: 'instagram', name: '@insta', thumbnail: 'https://ig/p.png' },
      { id: 'li-1', type: 'linkedin', name: 'li-1' },
      { id: 'did:plc:1', type: 'bluesky', name: 'me.bsky.social', handle: '@me.bsky.social' },
      { id: 'th-1', type: 'threads', name: 'thr', thumbnail: 'https://th/p.png' },
      { id: 'fb-1', type: 'facebook', name: 'My Page', thumbnail: 'https://fb/p.png' },
      { id: 'fb-2', type: 'facebook', name: 'fb-2', thumbnail: undefined },
    ]);
  });

  it('keeps the same array while the query data is unchanged', () => {
    mockQueries.facebook = { data: { accounts: [{ providerAccountId: 'fb-1', accountName: 'Page' }] } };
    const { result, rerender } = renderHook(() => usePostAccountCards());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
