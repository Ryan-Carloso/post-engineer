// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { PUBLISH_NETWORKS, checkPublish } from '@/lib/draft-scoring';
import { PROVIDER_LABELS, accountOption, scheduleAccountIds } from '@/lib/account-options';
import { resolvePublishLinks } from '@/lib/publish-links';
import { COUNTER_FETCHERS } from '@/lib/metrics/provider-counters';
import { RUMBLE_TITLE_MAX_LENGTH } from '@/lib/rumble';
import { OAUTH_CONNECT_PROVIDERS } from '@/lib/oauth-connect';
import { PROVIDER_REGISTRY } from '@/lib/providers/registry';
import { findRepoRoot } from '@/test/repo-root';
import type { SocialAccountRecord } from '@/lib/social-accounts';

const repoRoot = findRepoRoot(import.meta.url);
const CTX = { window: '7d' as const, now: new Date('2026-11-07T12:00:00Z') };

describe('Rumble across the shared surfaces', () => {
  it('has no metrics API, so every counter stays unknown', async () => {
    expect(
      await COUNTER_FETCHERS.rumble('user-1', { provider: 'rumble', accountId: '111', externalId: 'vid-1' }, CTX),
    ).toEqual({ views: null, likes: null, comments: null, saves: null });
  });

  it('passes the publish check with no ceiling (only the title limit, enforced at publish time)', () => {
    expect(PUBLISH_NETWORKS).toContain('rumble');
    expect(RUMBLE_TITLE_MAX_LENGTH).toBe(100);
    expect(checkPublish('a'.repeat(100000), 'rumble').failures).toEqual([]);
  });

  it('pins the title ceiling to the engine publisher and its request model', () => {
    const publisher = readFileSync(join(repoRoot, 'apps/engine/app/services/publish_rumble.py'), 'utf8');
    expect(publisher).toContain(`RUMBLE_TITLE_MAX_LENGTH: int = ${RUMBLE_TITLE_MAX_LENGTH}`);
    const models = readFileSync(join(repoRoot, 'apps/engine/app/models/publish.py'), 'utf8');
    const rumbleModel = models.slice(models.indexOf('class RumblePublish'), models.indexOf('class PublishParams'));
    expect(rumbleModel).toContain(`max_length=${RUMBLE_TITLE_MAX_LENGTH}`);
  });

  it('links the https permalink and drops a failed publish or a non-https link', () => {
    const permalink = 'https://rumble.com/v1abcde-my-video.html';
    expect(resolvePublishLinks([{ provider: 'rumble', permalink, postId: 'vid-1' }])).toEqual([{ provider: 'rumble', url: permalink }]);
    expect(resolvePublishLinks([{ provider: 'rumble', permalink, status: 'failed' }])).toEqual([]);
    expect(resolvePublishLinks([{ provider: 'rumble', permalink: 'javascript:alert(1)' }])).toEqual([]);
  });

  it('labels a channel with its stored name or its id and counts it on the schedule', () => {
    const base = { provider: 'rumble' as const, recordId: 'r', providerAccountId: 'chan-1', connectedAt: 0, lastUsed: 0 };
    expect(accountOption({ ...base, accountName: 'My Channel' })).toEqual({ id: 'chan-1', provider: 'rumble', label: 'My Channel' });
    expect(accountOption({ ...base, accountName: null }).label).toBe('chan-1');
    expect(scheduleAccountIds({ rumbleAccountIds: ['chan-1'], threadsAccountIds: ['42'] })).toEqual(['42', 'chan-1']);
    expect(PROVIDER_LABELS.rumble).toBe('Rumble');
  });

  it('connects with a manual access token, not OAuth', () => {
    expect(OAUTH_CONNECT_PROVIDERS).not.toContain('rumble');
    expect(PROVIDER_REGISTRY.rumble.supportsOAuthCallback).toBe(false);
  });

  it('exposes the stored channel id on the public account', () => {
    const record: SocialAccountRecord = {
      id: 'rec-1',
      userId: 'u',
      provider: 'rumble',
      providerAccountId: 'chan-1',
      accountName: 'chan-1',
      accountMetadata: {},
      tokenExpiresAt: null,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
      lastUsedAt: null,
    };
    expect(PROVIDER_REGISTRY.rumble.toPublicAccount(record)).toMatchObject({
      provider: 'rumble',
      recordId: 'rec-1',
      providerAccountId: 'chan-1',
      accountName: 'chan-1',
    });
  });
});
