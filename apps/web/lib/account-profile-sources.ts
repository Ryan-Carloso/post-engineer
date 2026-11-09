import 'server-only';

//---------------
// Per-provider profile readers for the account profile resync
// (lib/account-profile-sync.ts). Each returns the account name and the
// metadata fields the card shows, read fresh from the provider with the
// stored credentials. A field the provider did not return is null/absent,
// so the resync never overwrites stored data with a fallback.
//---------------

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSocialAccountTokens, type SocialAccountRecord } from './social-accounts';
import { INSTAGRAM_USERNAME_FALLBACK, YOUTUBE_PLACEHOLDER_ACCOUNT_ID, type SocialProvider } from './providers/registry';
import { InstagramService } from './instagram';
import { fetchThreadsProfile } from './threads';
import { fetchFacebookPageProfile } from './facebook';
import { fetchPinterestUserProfile } from './pinterest';
import { fetchLinkedInMemberProfile } from './linkedin';
import { fetchBlueskyPublicProfile } from './bluesky-profile';
import { createGoogleOAuth2Client } from './youtube';
import { fetchYouTubeChannel } from './youtube-channel';

export interface FetchedProfile {
  accountName: string | null;
  pictureUrl: string | null;
  metadata: Record<string, unknown>;
}

export interface ProfileSource {
  // Metadata key the card reads the picture from.
  pictureKey: string;
  applies(record: SocialAccountRecord): boolean;
  fetch(supabase: SupabaseClient, userId: string, record: SocialAccountRecord): Promise<FetchedProfile>;
}

async function accessToken(
  supabase: SupabaseClient,
  userId: string,
  record: SocialAccountRecord,
): Promise<string> {
  const { tokens } = await getSocialAccountTokens(supabase, userId, record.provider, record.providerAccountId);
  return String(tokens.access_token);
}

const always = (): boolean => true;

const instagram: ProfileSource = {
  pictureKey: 'profilePictureUrl',
  applies: always,
  async fetch(supabase, userId, record) {
    const profile = await new InstagramService().getProfile(await accessToken(supabase, userId, record));
    const username = profile.username === INSTAGRAM_USERNAME_FALLBACK ? null : profile.username;
    return {
      accountName: username,
      pictureUrl: profile.profilePictureUrl ?? null,
      metadata: {
        username: username ?? undefined,
        name: profile.name,
        profilePictureUrl: profile.profilePictureUrl,
        followersCount: profile.followersCount,
        mediaCount: profile.mediaCount,
      },
    };
  },
};

const threads: ProfileSource = {
  pictureKey: 'profilePictureUrl',
  applies: always,
  async fetch(supabase, userId, record) {
    const profile = await fetchThreadsProfile(await accessToken(supabase, userId, record));
    return {
      accountName: profile.username,
      pictureUrl: profile.profilePictureUrl,
      metadata: { profilePictureUrl: profile.profilePictureUrl },
    };
  },
};

const youtube: ProfileSource = {
  pictureKey: 'thumbnail',
  applies: always,
  async fetch(supabase, userId, record) {
    const { tokens } = await getSocialAccountTokens(supabase, userId, 'youtube', record.providerAccountId);
    const client = await createGoogleOAuth2Client();
    client.setCredentials(tokens);
    // Legacy rows saved before connect failed closed carry a placeholder id:
    // read the channel the stored grant belongs to instead of looking it up
    // by an id that does not exist.
    const channel = await fetchYouTubeChannel(
      client,
      record.providerAccountId === YOUTUBE_PLACEHOLDER_ACCOUNT_ID ? { mine: true } : { id: record.providerAccountId },
    );
    if (channel === null) throw new Error('YOUTUBE_CHANNEL_NOT_FOUND: channel not returned');
    return {
      accountName: channel.title,
      pictureUrl: channel.thumbnail,
      metadata: {
        thumbnail: channel.thumbnail,
        customUrl: channel.customUrl,
        statistics: channel.statistics,
      },
    };
  },
};

const bluesky: ProfileSource = {
  pictureKey: 'avatar',
  applies: always,
  async fetch(_supabase, _userId, record) {
    const profile = await fetchBlueskyPublicProfile(record.providerAccountId);
    return {
      accountName: profile.handle,
      pictureUrl: profile.avatar,
      metadata: { displayName: profile.displayName, avatar: profile.avatar },
    };
  },
};

const linkedin: ProfileSource = {
  pictureKey: 'picture',
  // Organization pages have no member userinfo; only the member row resyncs.
  applies: (record) => record.accountMetadata.kind === 'member',
  async fetch(supabase, userId, record) {
    const profile = await fetchLinkedInMemberProfile(await accessToken(supabase, userId, record));
    return {
      accountName: profile.name,
      pictureUrl: profile.picture,
      metadata: { name: profile.name, picture: profile.picture },
    };
  },
};

const facebook: ProfileSource = {
  pictureKey: 'profilePictureUrl',
  applies: always,
  async fetch(supabase, userId, record) {
    const profile = await fetchFacebookPageProfile(
      record.providerAccountId,
      await accessToken(supabase, userId, record),
    );
    return {
      accountName: profile.name,
      pictureUrl: profile.pictureUrl,
      metadata: {
        name: profile.name,
        category: profile.category,
        profilePictureUrl: profile.pictureUrl,
        followersCount: profile.followersCount ?? undefined,
      },
    };
  },
};

const pinterest: ProfileSource = {
  pictureKey: 'profilePictureUrl',
  applies: always,
  async fetch(supabase, userId, record) {
    const profile = await fetchPinterestUserProfile(await accessToken(supabase, userId, record));
    return {
      accountName: profile.username,
      pictureUrl: profile.profileImage,
      metadata: {
        name: profile.username,
        profilePictureUrl: profile.profileImage,
      },
    };
  },
};

export const PROFILE_SOURCES: Record<SocialProvider, ProfileSource> = {
  instagram,
  threads,
  youtube,
  bluesky,
  linkedin,
  facebook,
  pinterest,
};
