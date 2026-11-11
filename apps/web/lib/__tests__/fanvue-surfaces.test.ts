// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { PUBLISH_NETWORKS, checkPublish } from '@/lib/draft-scoring';
import { PROVIDER_LABELS, accountOption, scheduleAccountIds } from '@/lib/account-options';
import { resolvePublishLinks } from '@/lib/publish-links';
import { COUNTER_FETCHERS } from '@/lib/metrics/provider-counters';
import { OAUTH_CONNECT_PROVIDERS } from '@/lib/oauth-connect';
import { PROVIDER_REGISTRY } from '@/lib/providers/registry';
import { enDictionary, ptDictionary } from '@/lib/i18n/index';
import type { SocialAccountRecord } from '@/lib/social-accounts';

describe('Fanvue across the shared surfaces', () => {
  it('reports every counter as unknown: Fanvue exposes no per-post metrics the collector can read', async () => {
    const counters = await COUNTER_FETCHERS.fanvue('u', { provider: 'fanvue', accountId: 'a', externalId: '1' }, { window: '7d', now: new Date() });
    expect(counters).toEqual({ views: null, likes: null, comments: null, saves: null });
  });

  it('joins the publish networks with no documented caption ceiling, so the default branch applies', () => {
    expect(PUBLISH_NETWORKS).toContain('fanvue');
    expect(checkPublish('a'.repeat(5000), 'fanvue').failures).toEqual([]);
  });

  it('links only the provider-supplied permalink: no Fanvue post URL can be derived from an id', () => {
    const permalink = 'https://www.fanvue.com/posts/123456789';
    expect(resolvePublishLinks([{ provider: 'fanvue', permalink, postId: '123456789' }])).toEqual([{ provider: 'fanvue', url: permalink }]);
    expect(resolvePublishLinks([{ provider: 'fanvue', postId: '123456789' }])).toEqual([]);
    expect(resolvePublishLinks([{ provider: 'fanvue', permalink, status: 'failed' }])).toEqual([]);
  });

  it('labels an account with its name or its id and counts it on the schedule', () => {
    const base = { provider: 'fanvue' as const, recordId: 'r', providerAccountId: 'user-9', connectedAt: 0, lastUsed: 0 };
    expect(accountOption({ ...base, accountName: 'Maker' })).toEqual({ id: 'user-9', provider: 'fanvue', label: 'Maker' });
    expect(accountOption({ ...base, accountName: null }).label).toBe('user-9');
    expect(scheduleAccountIds({ fanvueAccountIds: ['user-9'], threadsAccountIds: ['42'] })).toEqual(['42', 'user-9']);
    expect(PROVIDER_LABELS.fanvue).toBe('Fanvue');
  });

  it('connects through OAuth from both the web and the MCP connect-url flow', () => {
    expect(OAUTH_CONNECT_PROVIDERS).toContain('fanvue');
    expect(PROVIDER_REGISTRY.fanvue.supportsOAuthCallback).toBe(true);
  });

  it('exposes the stored account on the public account', () => {
    const record: SocialAccountRecord = {
      id: 'rec-1',
      userId: 'u',
      provider: 'fanvue',
      providerAccountId: 'user-9',
      accountName: 'Maker',
      accountMetadata: {},
      tokenExpiresAt: null,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
      lastUsedAt: null,
    };
    const account = PROVIDER_REGISTRY.fanvue.toPublicAccount(record);
    expect(account).toMatchObject({
      provider: 'fanvue',
      recordId: 'rec-1',
      providerAccountId: 'user-9',
      accountName: 'Maker',
    });
  });

  it('translates the accounts section label and description in both locales', () => {
    expect(enDictionary.accounts.fanvueLabel).toBe('Fanvue');
    expect(enDictionary.accounts.fanvueDescription).toBe('Publish videos to your Fanvue account.');
    expect(ptDictionary.accounts.fanvueLabel).toBe('Fanvue');
    expect(ptDictionary.accounts.fanvueDescription).toBe('Publique vídeos na sua conta do Fanvue.');
  });
});
