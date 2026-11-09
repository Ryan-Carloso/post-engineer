import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/social-accounts', () => ({ getSocialAccountTokens: vi.fn() }));
const { getProfile } = vi.hoisted(() => ({ getProfile: vi.fn() }));
vi.mock('@/lib/instagram', () => ({
  InstagramService: vi.fn().mockImplementation(function InstagramServiceMock() {
    return { getProfile };
  }),
}));
vi.mock('@/lib/threads', () => ({ fetchThreadsProfile: vi.fn() }));
vi.mock('@/lib/facebook', () => ({ fetchFacebookPageProfile: vi.fn() }));
vi.mock('@/lib/linkedin', () => ({ fetchLinkedInMemberProfile: vi.fn() }));
vi.mock('@/lib/bluesky-profile', () => ({ fetchBlueskyPublicProfile: vi.fn() }));
vi.mock('@/lib/youtube', () => ({ createGoogleOAuth2Client: vi.fn() }));
vi.mock('@/lib/youtube-channel', () => ({ fetchYouTubeChannel: vi.fn() }));

import { PROFILE_SOURCES } from '@/lib/account-profile-sources';
import { getSocialAccountTokens, type SocialAccountRecord } from '@/lib/social-accounts';
import { fetchThreadsProfile } from '@/lib/threads';
import { fetchFacebookPageProfile } from '@/lib/facebook';
import { fetchLinkedInMemberProfile } from '@/lib/linkedin';
import { fetchBlueskyPublicProfile } from '@/lib/bluesky-profile';
import { createGoogleOAuth2Client } from '@/lib/youtube';
import { fetchYouTubeChannel } from '@/lib/youtube-channel';
import { SOCIAL_PROVIDERS, YOUTUBE_PLACEHOLDER_ACCOUNT_ID } from '@/lib/providers/registry';

const supabase = {} as never;

function record(provider: SocialAccountRecord['provider'], providerAccountId: string, metadata: Record<string, unknown> = {}): SocialAccountRecord {
  return {
    id: 'r', userId: 'u1', provider, providerAccountId, accountName: 'stored', accountMetadata: metadata,
    tokenExpiresAt: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', lastUsedAt: null,
  };
}

describe('PROFILE_SOURCES', () => {
  beforeEach(() => {
    vi.mocked(getSocialAccountTokens).mockReset();
    vi.mocked(getSocialAccountTokens).mockResolvedValue({ tokens: { access_token: 'tok', refresh_token: 'rt' } } as never);
  });

  it('covers every provider', () => {
    expect(Object.keys(PROFILE_SOURCES).sort()).toEqual([...SOCIAL_PROVIDERS].sort());
  });

  it('instagram reads with the stored token and drops the fallback username', async () => {
    getProfile.mockResolvedValue({ userdId: 'ig', username: 'instagram_user', name: 'N', profilePictureUrl: 'https://p', followersCount: 1, mediaCount: 2 });
    const fetched = await PROFILE_SOURCES.instagram.fetch(supabase, 'u1', record('instagram', 'ig'));
    expect(getSocialAccountTokens).toHaveBeenCalledWith(supabase, 'u1', 'instagram', 'ig');
    expect(getProfile).toHaveBeenCalledWith('tok');
    expect(fetched).toEqual({
      accountName: null,
      pictureUrl: 'https://p',
      metadata: { username: undefined, name: 'N', profilePictureUrl: 'https://p', followersCount: 1, mediaCount: 2 },
    });
    expect(PROFILE_SOURCES.instagram.pictureKey).toBe('profilePictureUrl');
  });

  it('instagram keeps a real username and maps a missing picture to null', async () => {
    getProfile.mockResolvedValue({ userdId: 'ig', username: 'real' });
    const fetched = await PROFILE_SOURCES.instagram.fetch(supabase, 'u1', record('instagram', 'ig'));
    expect(fetched.accountName).toBe('real');
    expect(fetched.pictureUrl).toBeNull();
    expect(fetched.metadata.username).toBe('real');
  });

  it('threads reads username and picture with the stored token', async () => {
    vi.mocked(fetchThreadsProfile).mockResolvedValue({ id: 't', username: 'th', profilePictureUrl: 'https://tp' });
    const fetched = await PROFILE_SOURCES.threads.fetch(supabase, 'u1', record('threads', 't'));
    expect(fetchThreadsProfile).toHaveBeenCalledWith('tok');
    expect(fetched).toEqual({ accountName: 'th', pictureUrl: 'https://tp', metadata: { profilePictureUrl: 'https://tp' } });
  });

  it('facebook reads its Page profile by id with the stored Page token', async () => {
    vi.mocked(fetchFacebookPageProfile).mockResolvedValue({ id: '111', name: 'My Page', category: 'Brand', pictureUrl: 'https://fp', followersCount: 9 });
    const fetched = await PROFILE_SOURCES.facebook.fetch(supabase, 'u1', record('facebook', '111'));
    expect(getSocialAccountTokens).toHaveBeenCalledWith(supabase, 'u1', 'facebook', '111');
    expect(fetchFacebookPageProfile).toHaveBeenCalledWith('111', 'tok');
    expect(fetched).toEqual({
      accountName: 'My Page',
      pictureUrl: 'https://fp',
      metadata: { name: 'My Page', category: 'Brand', profilePictureUrl: 'https://fp', followersCount: 9 },
    });
    expect(PROFILE_SOURCES.facebook.pictureKey).toBe('profilePictureUrl');
  });

  it('facebook drops an unknown follower count instead of storing null', async () => {
    vi.mocked(fetchFacebookPageProfile).mockResolvedValue({ id: '111', name: null, category: null, pictureUrl: null, followersCount: null });
    const fetched = await PROFILE_SOURCES.facebook.fetch(supabase, 'u1', record('facebook', '111'));
    expect(fetched.accountName).toBeNull();
    expect(fetched.metadata.followersCount).toBeUndefined();
  });

  it('youtube reads its own channel by id with the stored credentials', async () => {
    const setCredentials = vi.fn();
    vi.mocked(createGoogleOAuth2Client).mockResolvedValue({ setCredentials } as never);
    vi.mocked(fetchYouTubeChannel).mockResolvedValue({
      id: 'UC1', title: 'Chan', thumbnail: 'https://yt', customUrl: '@c', statistics: null,
    });
    const fetched = await PROFILE_SOURCES.youtube.fetch(supabase, 'u1', record('youtube', 'UC1'));
    expect(setCredentials).toHaveBeenCalledWith({ access_token: 'tok', refresh_token: 'rt' });
    expect(fetchYouTubeChannel).toHaveBeenCalledWith({ setCredentials }, { id: 'UC1' });
    expect(fetched).toEqual({
      accountName: 'Chan',
      pictureUrl: 'https://yt',
      metadata: { thumbnail: 'https://yt', customUrl: '@c', statistics: null },
    });
    expect(PROFILE_SOURCES.youtube.pictureKey).toBe('thumbnail');
  });

  it('youtube throws a coded error when the channel is gone', async () => {
    vi.mocked(createGoogleOAuth2Client).mockResolvedValue({ setCredentials: vi.fn() } as never);
    vi.mocked(fetchYouTubeChannel).mockResolvedValue(null);
    await expect(PROFILE_SOURCES.youtube.fetch(supabase, 'u1', record('youtube', 'UC1'))).rejects.toThrow('YOUTUBE_CHANNEL_NOT_FOUND');
    expect(PROFILE_SOURCES.youtube.applies(record('youtube', 'UC1'))).toBe(true);
  });

  it('youtube rereads a legacy placeholder row through the grant (mine) since it has no channel id', async () => {
    const setCredentials = vi.fn();
    vi.mocked(createGoogleOAuth2Client).mockResolvedValue({ setCredentials } as never);
    vi.mocked(fetchYouTubeChannel).mockResolvedValue({
      id: 'UC9', title: 'Real Channel', thumbnail: 'https://yt9', customUrl: '@real', statistics: null,
    });
    expect(PROFILE_SOURCES.youtube.applies(record('youtube', YOUTUBE_PLACEHOLDER_ACCOUNT_ID))).toBe(true);
    const fetched = await PROFILE_SOURCES.youtube.fetch(supabase, 'u1', record('youtube', YOUTUBE_PLACEHOLDER_ACCOUNT_ID));
    expect(fetchYouTubeChannel).toHaveBeenCalledWith({ setCredentials }, { mine: true });
    expect(fetched.accountName).toBe('Real Channel');
    expect(fetched.pictureUrl).toBe('https://yt9');
    expect(fetched.metadata).toEqual({ thumbnail: 'https://yt9', customUrl: '@real', statistics: null });
  });

  it('bluesky reads the public profile by DID without credentials', async () => {
    vi.mocked(fetchBlueskyPublicProfile).mockResolvedValue({ did: 'did:plc:x', handle: 'h.bsky.social', displayName: 'H', avatar: 'https://cdn.bsky.app/a' });
    const fetched = await PROFILE_SOURCES.bluesky.fetch(supabase, 'u1', record('bluesky', 'did:plc:x'));
    expect(fetchBlueskyPublicProfile).toHaveBeenCalledWith('did:plc:x');
    expect(getSocialAccountTokens).not.toHaveBeenCalled();
    expect(fetched).toEqual({
      accountName: 'h.bsky.social',
      pictureUrl: 'https://cdn.bsky.app/a',
      metadata: { displayName: 'H', avatar: 'https://cdn.bsky.app/a' },
    });
    expect(PROFILE_SOURCES.bluesky.pictureKey).toBe('avatar');
  });

  it('linkedin resyncs only the member row', async () => {
    vi.mocked(fetchLinkedInMemberProfile).mockResolvedValue({ id: 'm', name: 'Me', picture: 'https://media.licdn.com/p' });
    expect(PROFILE_SOURCES.linkedin.applies(record('linkedin', 'm', { kind: 'member' }))).toBe(true);
    expect(PROFILE_SOURCES.linkedin.applies(record('linkedin', 'urn:li:organization:1', { kind: 'organization' }))).toBe(false);
    const fetched = await PROFILE_SOURCES.linkedin.fetch(supabase, 'u1', record('linkedin', 'm', { kind: 'member' }));
    expect(fetchLinkedInMemberProfile).toHaveBeenCalledWith('tok');
    expect(fetched).toEqual({
      accountName: 'Me',
      pictureUrl: 'https://media.licdn.com/p',
      metadata: { name: 'Me', picture: 'https://media.licdn.com/p' },
    });
    expect(PROFILE_SOURCES.linkedin.pictureKey).toBe('picture');
  });

  it('rumble never resyncs: there is no profile API, so the stored channel id stands', async () => {
    expect(PROFILE_SOURCES.rumble.applies(record('rumble', 'chan-1'))).toBe(false);
    await expect(PROFILE_SOURCES.rumble.fetch(supabase, 'u1', record('rumble', 'chan-1'))).rejects.toThrow(
      'RUMBLE_PROFILE_UNAVAILABLE',
    );
    expect(getSocialAccountTokens).not.toHaveBeenCalled();
  });
});
