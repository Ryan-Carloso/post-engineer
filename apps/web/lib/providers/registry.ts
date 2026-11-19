import type { SocialAccountRecord } from '@/lib/social-accounts';
import type { AccountData, AccountSyncStatus, InstagramAccountData } from '@/lib/types';

import { SOCIAL_PROVIDERS, isSocialProvider, type SocialProvider } from '@/lib/contracts/providers';

export { SOCIAL_PROVIDERS, isSocialProvider, type SocialProvider };

export const INSTAGRAM_USERNAME_FALLBACK = 'instagram_user';
export const YOUTUBE_CHANNEL_NAME_FALLBACK = 'YouTube Account';
export const YOUTUBE_PLACEHOLDER_ACCOUNT_ID = 'unknown';

export interface BlueskyAccountData {
  provider: 'bluesky';
  recordId: string;
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
  connectedAt: number;
  lastUsed: number;
  status?: AccountSyncStatus;
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
  status?: AccountSyncStatus;
}

export interface ThreadsAccountData {
  provider: 'threads';
  recordId: string;
  providerAccountId: string;
  accountName: string | null;
  profilePictureUrl?: string;
  connectedAt: number;
  lastUsed: number;
  status?: AccountSyncStatus;
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
  status?: AccountSyncStatus;
}

export interface PinterestAccountData {
  provider: 'pinterest';
  recordId: string;
  providerAccountId: string;
  accountName: string | null;
  profilePictureUrl?: string;
  connectedAt: number;
  lastUsed: number;
  status?: AccountSyncStatus;
}

export interface ThreespeakAccountData {
  provider: '3speak';
  recordId: string;
  providerAccountId: string;
  accountName: string | null;
  connectedAt: number;
  lastUsed: number;
  status?: AccountSyncStatus;
}

export interface RumbleAccountData {
  provider: 'rumble';
  recordId: string;
  providerAccountId: string;
  accountName: string | null;
  connectedAt: number;
  lastUsed: number;
  status?: AccountSyncStatus;
}

export interface TelegramAccountData {
  provider: 'telegram';
  recordId: string;
  providerAccountId: string;
  accountName: string | null;
  chatType?: 'channel' | 'group' | 'supergroup';
  username?: string;
  botUsername?: string;
  connectedAt: number;
  lastUsed: number;
  status?: AccountSyncStatus;
}

export interface FanvueAccountData {
  provider: 'fanvue';
  recordId: string;
  providerAccountId: string;
  accountName: string | null;
  profilePictureUrl?: string;
  connectedAt: number;
  lastUsed: number;
  status?: AccountSyncStatus;
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
  | FanvueAccountData
  | TelegramAccountData;

interface ProviderDef<OAuth extends boolean = boolean> {
  supportsOAuthCallback: OAuth;
  toPublicAccount(record: SocialAccountRecord): PublicAccountItem;
}

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

const telegramDef: ProviderDef<false> = {
  supportsOAuthCallback: false,
  toPublicAccount(record) {
    const metadata = record.accountMetadata;
    const chatType =
      metadata.chatType === 'channel' || metadata.chatType === 'group' || metadata.chatType === 'supergroup'
        ? metadata.chatType
        : undefined;
    return {
      provider: 'telegram',
      recordId: record.id,
      providerAccountId: record.providerAccountId,
      accountName: record.accountName,
      chatType,
      username: asOptionalString(metadata.username),
      botUsername: asOptionalString(metadata.botUsername),
      connectedAt: createdAtTimestamp(record),
      lastUsed: lastUsedTimestamp(record),
    };
  },
};

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
  telegram: telegramDef,
} satisfies Record<SocialProvider, ProviderDef>;

export type OAuthProvider = {
  [K in SocialProvider]: (typeof PROVIDER_REGISTRY)[K]['supportsOAuthCallback'] extends true
    ? K
    : never;
}[SocialProvider];

export function isOAuthProvider(value: unknown): value is OAuthProvider {
  return isSocialProvider(value) && PROVIDER_REGISTRY[value].supportsOAuthCallback;
}

export function toPublicAccount(record: SocialAccountRecord, status: AccountSyncStatus = 'ok'): PublicAccountItem {
  if (!isSocialProvider(record.provider)) {
    throw new Error(`Unknown social provider: ${String(record.provider)}`);
  }
  return { ...PROVIDER_REGISTRY[record.provider].toPublicAccount(record), status };
}

export function toPublicAccountSafe(record: SocialAccountRecord, status: AccountSyncStatus = 'ok'): PublicAccountItem | null {
  if (!isSocialProvider(record.provider)) return null;
  return { ...PROVIDER_REGISTRY[record.provider].toPublicAccount(record), status };
}
