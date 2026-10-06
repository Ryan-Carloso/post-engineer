import { describe, it, expect } from 'vitest';
import {
  SOCIAL_PROVIDERS,
  PROVIDER_REGISTRY,
  isSocialProvider,
  isOAuthProvider,
  toPublicAccount,
  toPublicAccountSafe,
} from '@/lib/providers/registry';
import type {
  SocialProvider,
  BlueskyAccountData,
  LinkedinAccountData,
} from '@/lib/providers/registry';
import type { SocialAccountRecord } from '@/lib/social-accounts';
import type { AccountData, InstagramAccountData } from '@/lib/types';

describe('provider registry', () => {
  it('registry is exhaustive: every provider in the union has an entry', () => {
    expect(Object.keys(PROVIDER_REGISTRY).sort()).toEqual([...SOCIAL_PROVIDERS].sort());
  });

  it('every provider exposes toPublicAccount and supportsOAuthCallback', () => {
    for (const provider of SOCIAL_PROVIDERS) {
      const def = PROVIDER_REGISTRY[provider];
      expect(typeof def.toPublicAccount).toBe('function');
      expect(typeof def.supportsOAuthCallback).toBe('boolean');
    }
  });

  it('isSocialProvider accepts known providers and rejects unknown ones', () => {
    for (const provider of SOCIAL_PROVIDERS) {
      expect(isSocialProvider(provider)).toBe(true);
    }
    expect(isSocialProvider('tiktok')).toBe(false);
    expect(isSocialProvider(42)).toBe(false);
    expect(isSocialProvider(null)).toBe(false);
  });

  it('isOAuthProvider marks who has OAuth (bluesky does not)', () => {
    expect(isOAuthProvider('youtube')).toBe(true);
    expect(isOAuthProvider('instagram')).toBe(true);
    expect(isOAuthProvider('linkedin')).toBe(true);
    expect(isOAuthProvider('bluesky')).toBe(false);
    expect(isOAuthProvider('tiktok')).toBe(false);
  });
});

//---------------
// toPublicAccount mapping tests — these pin the per-provider mappers and the
// metadata narrowing helpers (kills Stryker survivors in registry.ts).
//---------------

function makeRecord(overrides: Partial<SocialAccountRecord> = {}): SocialAccountRecord {
  return {
    id: 'rec_1',
    userId: 'user_1',
    provider: 'youtube',
    providerAccountId: 'UC123',
    accountName: 'My Channel',
    accountMetadata: {},
    tokenExpiresAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    lastUsedAt: null,
    ...overrides,
  };
}

// Narrowing helpers: toPublicAccount returns a union; assert the tag and
// narrow so field assertions typecheck without casts.
function asYoutube(record: SocialAccountRecord): AccountData {
  const result = toPublicAccount(record);
  expect(result.provider).toBe('youtube');
  if (result.provider !== 'youtube') throw new Error('expected a youtube item');
  return result;
}

function asInstagram(record: SocialAccountRecord): InstagramAccountData {
  const result = toPublicAccount(record);
  expect(result.provider).toBe('instagram');
  if (result.provider !== 'instagram') throw new Error('expected an instagram item');
  return result;
}

function asBluesky(record: SocialAccountRecord): BlueskyAccountData {
  const result = toPublicAccount(record);
  expect(result.provider).toBe('bluesky');
  if (result.provider !== 'bluesky') throw new Error('expected a bluesky item');
  return result;
}

function asLinkedin(record: SocialAccountRecord): LinkedinAccountData {
  const result = toPublicAccount(record);
  expect(result.provider).toBe('linkedin');
  if (result.provider !== 'linkedin') throw new Error('expected a linkedin item');
  return result;
}

describe('toPublicAccount (youtube)', () => {
  it('maps channel fields and falls back to "YouTube Account"', () => {
    expect(asYoutube(makeRecord({ accountName: 'My Channel' })).channelName).toBe('My Channel');
    expect(asYoutube(makeRecord({ accountName: null })).channelName).toBe('YouTube Account');
    expect(asYoutube(makeRecord({ accountName: '' })).channelName).toBe('YouTube Account');
  });

  it('keeps email as an empty string', () => {
    expect(asYoutube(makeRecord()).email).toBe('');
  });

  it('maps statistics and drops non-string values', () => {
    const result = asYoutube(
      makeRecord({
        accountMetadata: {
          statistics: {
            subscriberCount: '1000',
            viewCount: 500, // wrong type on purpose
            videoCount: '42',
            hiddenSubscriberCount: true,
          },
          thumbnail: 'https://img',
        },
      }),
    );
    expect(result.statistics?.subscriberCount).toBe('1000');
    expect(result.statistics?.viewCount).toBeUndefined();
    expect(result.statistics?.videoCount).toBe('42');
    expect(result.statistics?.hiddenSubscriberCount).toBe(true);
    expect(result.thumbnail).toBe('https://img');
  });

  it('drops a non-boolean hiddenSubscriberCount', () => {
    const result = asYoutube(
      makeRecord({ accountMetadata: { statistics: { hiddenSubscriberCount: 'yes' } } }),
    );
    expect(result.statistics?.hiddenSubscriberCount).toBeUndefined();
  });

  it('returns undefined statistics when metadata.statistics is not a record', () => {
    for (const statistics of ['nope', 42, null, [1, 2]]) {
      const result = asYoutube(makeRecord({ accountMetadata: { statistics } }));
      expect(result.statistics).toBeUndefined();
    }
  });

  it('drops a non-string thumbnail', () => {
    expect(asYoutube(makeRecord({ accountMetadata: { thumbnail: 42 } })).thumbnail).toBeUndefined();
  });

  it('falls back lastUsed to createdAt when lastUsedAt is missing', () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z').getTime();
    const fallback = asYoutube(makeRecord({ lastUsedAt: null }));
    expect(fallback.connectedAt).toBe(createdAt);
    expect(fallback.lastUsed).toBe(createdAt);
    const used = asYoutube(makeRecord({ lastUsedAt: '2026-02-01T00:00:00.000Z' }));
    expect(used.lastUsed).toBe(new Date('2026-02-01T00:00:00.000Z').getTime());
  });
});

describe('toPublicAccount (instagram)', () => {
  const instagramRecord = (accountMetadata: Record<string, unknown>) =>
    makeRecord({ provider: 'instagram', providerAccountId: 'ig_1', accountName: 'u', accountMetadata });

  it('maps counts and drops non-numeric values', () => {
    const result = asInstagram(instagramRecord({ followersCount: 100, mediaCount: 'lots' }));
    expect(result.followersCount).toBe(100);
    expect(result.mediaCount).toBeUndefined();
    expect(result.username).toBe('u');
  });

  it('falls back name to empty string when missing', () => {
    expect(asInstagram(instagramRecord({ name: 'Ana' })).name).toBe('Ana');
    expect(asInstagram(instagramRecord({})).name).toBe('');
  });
});

describe('toPublicAccount (bluesky)', () => {
  it('maps handle and falls back to "bluesky.user"', () => {
    const withHandle = asBluesky(
      makeRecord({ provider: 'bluesky', providerAccountId: 'did:plc:1', accountName: 'ana.bsky.social' }),
    );
    expect(withHandle.handle).toBe('ana.bsky.social');
    expect(withHandle.did).toBe('did:plc:1');
    const withoutHandle = asBluesky(
      makeRecord({ provider: 'bluesky', providerAccountId: 'did:plc:1', accountName: null }),
    );
    expect(withoutHandle.handle).toBe('bluesky.user');
  });
});

describe('toPublicAccount (linkedin)', () => {
  it('keeps member/organization kind and drops anything else', () => {
    for (const kind of ['member', 'organization'] as const) {
      const result = asLinkedin(makeRecord({ provider: 'linkedin', accountMetadata: { kind, name: 'Ana' } }));
      expect(result.accountMetadata?.kind).toBe(kind);
      expect(result.accountMetadata?.name).toBe('Ana');
    }
    for (const kind of ['weird', undefined]) {
      const result = asLinkedin(makeRecord({ provider: 'linkedin', accountMetadata: { kind } }));
      expect(result.accountMetadata?.kind).toBeUndefined();
    }
  });
});

describe('toPublicAccount / toPublicAccountSafe', () => {
  // The cast below is intentional: it feeds an invalid provider to prove the
  // loud failure / safe null contract.
  const unknownProvider = (provider: string): SocialAccountRecord =>
    makeRecord({ provider: provider as unknown as SocialProvider });

  it('throws loudly on unknown provider', () => {
    expect(() => toPublicAccount(unknownProvider('tiktok'))).toThrow(
      'Unknown social provider: tiktok',
    );
  });

  it('safe variant returns null on unknown provider and maps known ones', () => {
    expect(toPublicAccountSafe(unknownProvider('tiktok'))).toBeNull();
    const result = toPublicAccountSafe(makeRecord());
    expect(result?.provider).toBe('youtube');
  });
});
