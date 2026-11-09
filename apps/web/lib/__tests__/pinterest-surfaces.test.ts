// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { PINTEREST_DESCRIPTION_MAX_CHARS, PUBLISH_NETWORKS, checkPublish } from '@/lib/draft-scoring';
import { PROVIDER_LABELS, accountOption, scheduleAccountIds } from '@/lib/account-options';
import { resolvePublishLinks } from '@/lib/publish-links';
import { COUNTER_FETCHERS } from '@/lib/metrics/provider-counters';
import { PINTEREST_DESCRIPTION_MAX_CHARS as PINTEREST_LIB_MAX_CHARS } from '@/lib/pinterest';
import { OAUTH_CONNECT_PROVIDERS } from '@/lib/oauth-connect';
import { PROVIDER_REGISTRY } from '@/lib/providers/registry';
import { findRepoRoot } from '@/test/repo-root';
import type { SocialAccountRecord } from '@/lib/social-accounts';

const repoRoot = findRepoRoot(import.meta.url);

describe('Pinterest across the shared surfaces', () => {
  it('reports every counter as unknown: Standard access reads no per-Pin metrics', async () => {
    const counters = await COUNTER_FETCHERS.pinterest('u', { provider: 'pinterest', accountId: 'a', externalId: '1' }, { window: '7d', now: new Date() });
    expect(counters).toEqual({ views: null, likes: null, comments: null, saves: null });
  });

  it('fails the publish check only past the description ceiling', () => {
    expect(PUBLISH_NETWORKS).toContain('pinterest');
    expect(PINTEREST_DESCRIPTION_MAX_CHARS).toBe(PINTEREST_LIB_MAX_CHARS);
    expect(checkPublish('a'.repeat(PINTEREST_DESCRIPTION_MAX_CHARS), 'pinterest').failures).toEqual([]);
    expect(checkPublish('a'.repeat(PINTEREST_DESCRIPTION_MAX_CHARS + 1), 'pinterest').failures[0]).toContain('Pinterest 800-character');
  });

  it('pins the description ceiling to the engine publisher and its request model', () => {
    const publisher = readFileSync(join(repoRoot, 'apps/engine/app/services/publish_pinterest.py'), 'utf8');
    expect(publisher).toContain(`PINTEREST_DESCRIPTION_MAX_LENGTH: int = ${PINTEREST_LIB_MAX_CHARS}`);
    const models = readFileSync(join(repoRoot, 'apps/engine/app/models/publish.py'), 'utf8');
    const pinterestModel = models.slice(models.indexOf('class PinterestPublish'), models.indexOf('class PublishParams'));
    expect(pinterestModel).toContain(`max_length=${PINTEREST_LIB_MAX_CHARS}`);
  });

  it('links the pin permalink and derives it from a bare numeric pin id, dropping failed publishes', () => {
    const permalink = 'https://www.pinterest.com/pin/123456789/';
    expect(resolvePublishLinks([{ provider: 'pinterest', permalink, postId: '123456789' }])).toEqual([{ provider: 'pinterest', url: permalink }]);
    expect(resolvePublishLinks([{ provider: 'pinterest', postId: '123456789' }])).toEqual([{ provider: 'pinterest', url: permalink }]);
    expect(resolvePublishLinks([{ provider: 'pinterest', permalink, status: 'failed' }])).toEqual([]);
  });

  it('labels an account with its name or its id and counts it on the schedule', () => {
    const base = { provider: 'pinterest' as const, recordId: 'r', providerAccountId: 'user-9', connectedAt: 0, lastUsed: 0 };
    expect(accountOption({ ...base, accountName: 'Maker' })).toEqual({ id: 'user-9', provider: 'pinterest', label: 'Maker' });
    expect(accountOption({ ...base, accountName: null }).label).toBe('user-9');
    expect(scheduleAccountIds({ pinterestAccountIds: ['user-9'], threadsAccountIds: ['42'] })).toEqual(['42', 'user-9']);
    expect(PROVIDER_LABELS.pinterest).toBe('Pinterest');
  });

  it('connects through OAuth from both the web and the MCP connect-url flow', () => {
    expect(OAUTH_CONNECT_PROVIDERS).toContain('pinterest');
    expect(PROVIDER_REGISTRY.pinterest.supportsOAuthCallback).toBe(true);
  });

  it('exposes the stored profile picture on the public account, dropping malformed values', () => {
    const record: SocialAccountRecord = {
      id: 'rec-1',
      userId: 'u',
      provider: 'pinterest',
      providerAccountId: 'user-9',
      accountName: 'Maker',
      accountMetadata: { profilePictureUrl: 'https://i.pinimg.com/p.jpg', followersCount: 'many' },
      tokenExpiresAt: null,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
      lastUsedAt: null,
    };
    const account = PROVIDER_REGISTRY.pinterest.toPublicAccount(record);
    expect(account).toMatchObject({
      provider: 'pinterest',
      recordId: 'rec-1',
      providerAccountId: 'user-9',
      accountName: 'Maker',
      profilePictureUrl: 'https://i.pinimg.com/p.jpg',
    });
  });
});
