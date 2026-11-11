import type { SocialAccountRecord } from '@/lib/social-accounts';
import type { AccountData, InstagramAccountData } from '@/lib/types';

//---------------
// Provider Registry — SINGLE SOURCE of the supported social networks list.
// Adding a new provider = adding the member to SOCIAL_PROVIDERS and the
// corresponding entry to PROVIDER_REGISTRY (the `satisfies` breaks the
// typecheck/CI if either becomes incomplete). The /api/account mappers,
// client guards and the OAuth union all derive from here.
//---------------

export const SOCIAL_PROVIDERS = ['youtube', 'instagram', 'bluesky', 'linkedin', 'threads', 'facebook', 'pinterest', '3speak', 'rumble', 'fanvue'] as const;

export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

// Stored/shown when Instagram returned no username for the account.
export const INSTAGRAM_USERNAME_FALLBACK = 'instagram_user';
export const YOUTUBE_CHANNEL_NAME_FALLBACK = 'YouTube Account';
// Channel id stored by the old callback when the channel read failed. No
// connect writes it anymore; legacy rows are repaired through the grant.
export const YOUTUBE_PLACEHOLDER_ACCOUNT_ID = 'unknown';

//---------------
// Public shapes (no tokens) per provider — what /api/account returns
//---------------

export interface BlueskyAccountData {
  provider: 'bluesky';
  recordId: string;
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
  connectedAt: number;
  lastUsed: number;
}

export interface LinkedinAccountData {
  provider: 'linkedin';
  recordId: string;
  providerAccountId: string;
  accountName: string | null;
  accountMetadata?: { kind?: 'member' | 'organization'; name?: string | null };
  profilePictureUrl?: string;
  connectedAt: number;
  lastUsed: number;
}

export interface ThreadsAccountData {
  provider: 'threads';
  recordId: string;
  providerAccountId: string;
  accountName: string | null;
  profilePictureUrl?: string;
  connectedAt: number;
  lastUsed: number;
}

export interface FacebookAccountData {
  provider: 'facebook';
  recordId: string;
  providerAccountId: string;
  accountName: string | null;
  profilePictureUrl?: string;
  category?: string;
  followersCount?: number;
  connectedAt: number;
  lastUsed: number;
}

export interface PinterestAccountData {
  provider: 'pinterest';
  recordId: string;
  providerAccountId: string;
  accountName: string | null;
  profilePictureUrl?: string;
  connectedAt: number;
  lastUsed: number;
}

export interface ThreespeakAccountData {
  provider: '3speak';
  recordId: string;
  providerAccountId: string;
  accountName: string | null;
  connectedAt: number;
  lastUsed: number;
}

export interface RumbleAccountData {
  provider: 'rumble';
  recordId: string;
  providerAccountId: string;
  accountName: string | null;
  connectedAt: number;
  lastUsed: number;
}

export interface FanvueAccountData {
  provider: 'fanvue';
  recordId: string;
  providerAccountId: string;
  accountName: string | null;
  profilePictureUrl?: string;
  connectedAt: number;
  lastUsed: number;
}

export type PublicAccountItem =
  | AccountData
  | InstagramAccountData
  | BlueskyAccountData
  | LinkedinAccountData
  | ThreadsAccountData
  | FacebookAccountData
  | PinterestAccountData
  | ThreespeakAccountData
  | RumbleAccountData
  | FanvueAccountData;

//---------------
// ProviderDef — contract every provider must implement.
// supportsOAuthCallback marks who has an OAuth flow (bluesky uses app
// password and rumble a manual access token, not OAuth).
//---------------

interface ProviderDef<OAuth extends boolean = boolean> {
  supportsOAuthCallback: OAuth;
  toPublicAccount(record: SocialAccountRecord): PublicAccountItem;
}

//---------------
// Narrowing helpers for metadata (jsonb = unknown)
//---------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function asStatistics(value: unknown): AccountData['statistics'] {
  if (!isRecord(value)) return undefined;
  return {
    subscriberCount: asOptionalString(value.subscriberCount),
    viewCount: asOptionalString(value.viewCount),
    videoCount: asOptionalString(value.videoCount),
    hiddenSubscriberCount:
      typeof value.hiddenSubscriberCount === 'boolean'
        ? value.hiddenSubscriberCount
        : undefined,
  };
}

function createdAtTimestamp(record: SocialAccountRecord): number {
  return new Date(record.createdAt).getTime();
}

function lastUsedTimestamp(record: SocialAccountRecord): number {
  return record.lastUsedAt
    ? new Date(record.lastUsedAt).getTime()
    : createdAtTimestamp(record);
}

//---------------
// Per-provider definitions
//---------------

const youtubeDef: ProviderDef<true> = {
  supportsOAuthCallback: true,
  toPublicAccount(record) {
    const metadata = record.accountMetadata;
    const statistics = asStatistics(metadata.statistics);
    return {
      provider: 'youtube',
      recordId: record.id,
      channelId: record.providerAccountId,
      channelName: record.accountName || YOUTUBE_CHANNEL_NAME_FALLBACK,
      email: '',
      thumbnail: asOptionalString(metadata.thumbnail),
      customUrl: asOptionalString(metadata.customUrl),
      statistics,
      connectedAt: createdAtTimestamp(record),
      lastUsed: lastUsedTimestamp(record),
    };
  },
};

const instagramDef: ProviderDef<true> = {
  supportsOAuthCallback: true,
  toPublicAccount(record) {
    const metadata = record.accountMetadata;
    return {
      provider: 'instagram',
      recordId: record.id,
      igUserId: record.providerAccountId,
      username: record.accountName || INSTAGRAM_USERNAME_FALLBACK,
      name: asOptionalString(metadata.name) ?? '',
      profilePictureUrl: asOptionalString(metadata.profilePictureUrl),
      followersCount: asOptionalNumber(metadata.followersCount),
      mediaCount: asOptionalNumber(metadata.mediaCount),
      connectedAt: createdAtTimestamp(record),
      lastUsed: lastUsedTimestamp(record),
    };
  },
};

const blueskyDef: ProviderDef<false> = {
  supportsOAuthCallback: false,
  toPublicAccount(record) {
    return {
      provider: 'bluesky',
      recordId: record.id,
      did: record.providerAccountId,
      handle: record.accountName ?? 'bluesky.user',
      displayName: asOptionalString(record.accountMetadata.displayName),
      avatar: asOptionalString(record.accountMetadata.avatar),
      connectedAt: createdAtTimestamp(record),
      lastUsed: lastUsedTimestamp(record),
    };
  },
};

const linkedinDef: ProviderDef<true> = {
  supportsOAuthCallback: true,
  toPublicAccount(record) {
    const metadata = record.accountMetadata;
    const kind =
      metadata.kind === 'member' || metadata.kind === 'organization'
        ? metadata.kind
        : undefined;
    return {
      provider: 'linkedin',
      recordId: record.id,
      providerAccountId: record.providerAccountId,
      accountName: record.accountName,
      accountMetadata: {
        kind,
        name: asOptionalString(metadata.name),
      },
      profilePictureUrl: asOptionalString(metadata.picture),
      connectedAt: createdAtTimestamp(record),
      lastUsed: lastUsedTimestamp(record),
    };
  },
};

const threadsDef: ProviderDef<true> = {
  supportsOAuthCallback: true,
  toPublicAccount(record) {
    return {
      provider: 'threads',
      recordId: record.id,
      providerAccountId: record.providerAccountId,
      accountName: record.accountName,
      profilePictureUrl: asOptionalString(record.accountMetadata.profilePictureUrl),
      connectedAt: createdAtTimestamp(record),
      lastUsed: lastUsedTimestamp(record),
    };
  },
};

const facebookDef: ProviderDef<true> = {
  supportsOAuthCallback: true,
  toPublicAccount(record) {
    return {
      provider: 'facebook',
      recordId: record.id,
      providerAccountId: record.providerAccountId,
      accountName: record.accountName,
      profilePictureUrl: asOptionalString(record.accountMetadata.profilePictureUrl),
      category: asOptionalString(record.accountMetadata.category),
      followersCount: asOptionalNumber(record.accountMetadata.followersCount),
      connectedAt: createdAtTimestamp(record),
      lastUsed: lastUsedTimestamp(record),
    };
  },
};

const pinterestDef: ProviderDef<true> = {
  supportsOAuthCallback: true,
  toPublicAccount(record) {
    return {
      provider: 'pinterest',
      recordId: record.id,
      providerAccountId: record.providerAccountId,
      accountName: record.accountName,
      profilePictureUrl: asOptionalString(record.accountMetadata.profilePictureUrl),
      connectedAt: createdAtTimestamp(record),
      lastUsed: lastUsedTimestamp(record),
    };
  },
};

// 3Speak has no OAuth: the Hive posting key connects the account (like the
// Bluesky app password), and the provider_account_id is the Hive username.
const threespeakDef: ProviderDef<false> = {
  supportsOAuthCallback: false,
  toPublicAccount(record) {
    return {
      provider: '3speak',
      recordId: record.id,
      providerAccountId: record.providerAccountId,
      accountName: record.accountName,
      connectedAt: createdAtTimestamp(record),
      lastUsed: lastUsedTimestamp(record),
    };
  },
};

// Rumble has no OAuth and no profile API: the account is the channel id
// the user typed at connect, and the card shows that id.
const rumbleDef: ProviderDef<false> = {
  supportsOAuthCallback: false,
  toPublicAccount(record) {
    return {
      provider: 'rumble',
      recordId: record.id,
      providerAccountId: record.providerAccountId,
      accountName: record.accountName,
      connectedAt: createdAtTimestamp(record),
      lastUsed: lastUsedTimestamp(record),
    };
  },
};

// Fanvue connects via OAuth 2.0 + PKCE; the uuid from GET /users/me is
// the provider account id. Avatar/cover/bio are not managed (no
// endpoints), so the card shows only the name and the avatar Fanvue
// returned at connect time.
const fanvueDef: ProviderDef<true> = {
  supportsOAuthCallback: true,
  toPublicAccount(record) {
    return {
      provider: 'fanvue',
      recordId: record.id,
      providerAccountId: record.providerAccountId,
      accountName: record.accountName,
      profilePictureUrl: asOptionalString(record.accountMetadata.profilePictureUrl),
      connectedAt: createdAtTimestamp(record),
      lastUsed: lastUsedTimestamp(record),
    };
  },
};

//---------------
// PROVIDER_REGISTRY — exhaustive by construction: a provider in the union without
// an entry here (or vice versa) = compile error.
//---------------

export const PROVIDER_REGISTRY = {
  youtube: youtubeDef,
  instagram: instagramDef,
  bluesky: blueskyDef,
  linkedin: linkedinDef,
  threads: threadsDef,
  facebook: facebookDef,
  pinterest: pinterestDef,
  '3speak': threespeakDef,
  rumble: rumbleDef,
  fanvue: fanvueDef,
} satisfies Record<SocialProvider, ProviderDef>;

// OAuthProvider — derived from the registry: whoever has supportsOAuthCallback: true.
// A new OAuth provider automatically joins this union.

export type OAuthProvider = {
  [K in SocialProvider]: (typeof PROVIDER_REGISTRY)[K]['supportsOAuthCallback'] extends true
    ? K
    : never;
}[SocialProvider];

//---------------
// Type guards
//---------------

export function isSocialProvider(value: unknown): value is SocialProvider {
  return typeof value === 'string' && (SOCIAL_PROVIDERS as readonly string[]).includes(value);
}

export function isOAuthProvider(value: unknown): value is OAuthProvider {
  return isSocialProvider(value) && PROVIDER_REGISTRY[value].supportsOAuthCallback;
}

//---------------
// toPublicAccount — the single mapper used by /api/account. Fails loudly on
// an unknown provider (never falls back silently).
//---------------

export function toPublicAccount(record: SocialAccountRecord): PublicAccountItem {
  if (!isSocialProvider(record.provider)) {
    throw new Error(`Unknown social provider: ${String(record.provider)}`);
  }
  return PROVIDER_REGISTRY[record.provider].toPublicAccount(record);
}

//---------------
// toPublicAccountSafe — listing variant: an unknown provider
// returns null (the route filters and logs) instead of dropping the whole list.
//---------------

export function toPublicAccountSafe(record: SocialAccountRecord): PublicAccountItem | null {
  if (!isSocialProvider(record.provider)) return null;
  return PROVIDER_REGISTRY[record.provider].toPublicAccount(record);
}
