import type { SocialAccountRecord } from '@/lib/social-accounts';
import type { AccountData, InstagramAccountData } from '@/lib/types';

//---------------
// Provider Registry — SINGLE SOURCE of the supported social networks list.
// Adding a new provider = adding the member to SOCIAL_PROVIDERS and the
// corresponding entry to PROVIDER_REGISTRY (the `satisfies` breaks the
// typecheck/CI if either becomes incomplete). The /api/account mappers,
// client guards and the OAuth union all derive from here.
//---------------

export const SOCIAL_PROVIDERS = ['youtube', 'instagram', 'bluesky', 'linkedin'] as const;

export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

//---------------
// Public shapes (no tokens) per provider — what /api/account returns
//---------------

export interface BlueskyAccountData {
  provider: 'bluesky';
  recordId: string;
  did: string;
  handle: string;
  connectedAt: number;
  lastUsed: number;
}

export interface LinkedinAccountData {
  provider: 'linkedin';
  recordId: string;
  providerAccountId: string;
  accountName: string | null;
  accountMetadata?: { kind?: 'member' | 'organization'; name?: string | null };
  connectedAt: number;
  lastUsed: number;
}

export type PublicAccountItem =
  | AccountData
  | InstagramAccountData
  | BlueskyAccountData
  | LinkedinAccountData;

//---------------
// ProviderDef — contract every provider must implement.
// supportsOAuthCallback marks who has an OAuth flow (bluesky uses app
// password, not OAuth).
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
      channelName: record.accountName || 'YouTube Account',
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
      username: record.accountName || 'instagram_user',
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
