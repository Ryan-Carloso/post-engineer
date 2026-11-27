// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { PROVIDER_LABELS, accountOption, scheduleAccountIds } from '@/lib/account-options';
import { resolvePublishLinks } from '@/lib/publish-links';
import { facebookCounters } from '@/lib/metrics/provider-counters';
import { FACEBOOK_TEXT_MAX_CHARS } from '@/lib/facebook';
import { OAUTH_CONNECT_PROVIDERS } from '@/lib/oauth-connect';
import { PROVIDER_REGISTRY } from '@/lib/providers/registry';
import { findRepoRoot } from '@/test/repo-root';
import type { SocialAccountRecord } from '@/lib/social-accounts';

const repoRoot = findRepoRoot(import.meta.url);

describe('Facebook Pages across the shared surfaces', () => {
  it('maps total views, likes and comments and leaves saves unknown', () => {
    expect(facebookCounters({ total_video_views: 10, likes: 3, comments: 2 })).toEqual({ views: 10, likes: 3, comments: 2, saves: null });
    expect(facebookCounters({})).toEqual({ views: null, likes: null, comments: null, saves: null });
  });

  it('pins the caption ceiling to the publisher plan', () => {
    expect(FACEBOOK_TEXT_MAX_CHARS).toBe(63206);
    const plan = readFileSync(join(repoRoot, 'apps/web/lib/publisher/plan.ts'), 'utf8');
    expect(plan).toContain('truncateChars(ctx.copy, FACEBOOK_TEXT_MAX_CHARS)');
  });

  it('links the https permalink and drops a failed publish or a non-https link', () => {
    const permalink = 'https://www.facebook.com/111/videos/vid-1/';
    expect(resolvePublishLinks([{ provider: 'facebook', permalink, postId: 'vid-1' }])).toEqual([{ provider: 'facebook', url: permalink }]);
    expect(resolvePublishLinks([{ provider: 'facebook', permalink, status: 'failed' }])).toEqual([]);
    expect(resolvePublishLinks([{ provider: 'facebook', permalink: 'javascript:alert(1)' }])).toEqual([]);
  });

  it('labels a Page with its name or its id and counts it on the schedule', () => {
    const base = { provider: 'facebook' as const, recordId: 'r', providerAccountId: '111', connectedAt: 0, lastUsed: 0 };
    expect(accountOption({ ...base, accountName: 'My Page' })).toEqual({ id: '111', provider: 'facebook', label: 'My Page' });
    expect(accountOption({ ...base, accountName: null }).label).toBe('111');
    expect(scheduleAccountIds({ facebookAccountIds: ['111'], threadsAccountIds: ['42'] })).toEqual(['42', '111']);
    expect(PROVIDER_LABELS.facebook).toBe('Facebook');
  });

  it('connects through OAuth from both the web and the MCP connect-url flow', () => {
    expect(OAUTH_CONNECT_PROVIDERS).toContain('facebook');
    expect(PROVIDER_REGISTRY.facebook.supportsOAuthCallback).toBe(true);
  });

  it('exposes the stored Page metadata on the public account, dropping malformed values', () => {
    const record: SocialAccountRecord = {
      id: 'rec-1',
      userId: 'u',
      provider: 'facebook',
      providerAccountId: '111',
      accountName: 'My Page',
      accountMetadata: { profilePictureUrl: 'https://scontent.xx.fbcdn.net/p.jpg', category: 'Brand', followersCount: 'many' },
      tokenExpiresAt: null,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
      lastUsedAt: null,
      needsReconnect: false,
    };
    const account = PROVIDER_REGISTRY.facebook.toPublicAccount(record);
    expect(account).toMatchObject({
      provider: 'facebook',
      recordId: 'rec-1',
      providerAccountId: '111',
      accountName: 'My Page',
      profilePictureUrl: 'https://scontent.xx.fbcdn.net/p.jpg',
      category: 'Brand',
    });
    expect(account).toHaveProperty('followersCount', undefined);
  });
});
