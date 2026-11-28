import { describe, it, expect } from 'vitest';
import { PROVIDER_LABELS, accountOption, scheduleAccountIds } from '@/lib/account-options';
import { resolvePublishLinks } from '@/lib/publish-links';
import { COUNTER_FETCHERS } from '@/lib/metrics/provider-counters';
import { DIRECT_CONNECT_PROVIDERS, IMAGE_PROVIDERS, OAUTH_CONNECT_PROVIDERS } from '@/lib/contracts/providers';
import { PROVIDER_REGISTRY } from '@/lib/providers/registry';
import type { SocialAccountRecord } from '@/lib/social-accounts';

const CTX = { window: '7d' as const, now: new Date('2026-11-07T12:00:00Z') };

function record(accountMetadata: Record<string, unknown>): SocialAccountRecord {
  return {
    id: 'rec-1',
    userId: 'u',
    provider: 'telegram',
    providerAccountId: '-1001',
    accountName: 'News',
    accountMetadata,
    tokenExpiresAt: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    lastUsedAt: null,
    needsReconnect: false,
  };
}

describe('Telegram across the shared surfaces', () => {
  it('has no per-message counters in the Bot API, so every counter stays unknown', async () => {
    expect(
      await COUNTER_FETCHERS.telegram('user-1', { provider: 'telegram', accountId: '-1001', externalId: '9' }, CTX),
    ).toEqual({ views: null, likes: null, comments: null, saves: null });
  });

  it('links only the permalink the handler supplies (a public chat), never a guess from the message id', () => {
    const permalink = 'https://t.me/news/9';
    expect(resolvePublishLinks([{ provider: 'telegram', permalink, postId: '9' }])).toEqual([{ provider: 'telegram', url: permalink }]);
    expect(resolvePublishLinks([{ provider: 'telegram', postId: '9' }])).toEqual([]);
  });

  it('labels a chat with its stored title or its id and counts it on the schedule', () => {
    const base = { provider: 'telegram' as const, recordId: 'r', providerAccountId: '-1001', connectedAt: 0, lastUsed: 0 };
    expect(accountOption({ ...base, accountName: 'News' })).toEqual({ id: '-1001', provider: 'telegram', label: 'News' });
    expect(accountOption({ ...base, accountName: null }).label).toBe('-1001');
    expect(scheduleAccountIds({ telegramAccountIds: ['-1001'], threadsAccountIds: ['42'] })).toEqual(['42', '-1001']);
    expect(PROVIDER_LABELS.telegram).toBe('Telegram');
  });

  it('connects with a bot token, not OAuth, and publishes images as well as video', () => {
    expect(DIRECT_CONNECT_PROVIDERS).toContain('telegram');
    expect(OAUTH_CONNECT_PROVIDERS).not.toContain('telegram');
    expect(PROVIDER_REGISTRY.telegram.supportsOAuthCallback).toBe(false);
    expect(IMAGE_PROVIDERS).toContain('telegram');
  });

  it('exposes the stored chat kind, username and bot on the public account', () => {
    expect(PROVIDER_REGISTRY.telegram.toPublicAccount(record({ chatType: 'channel', username: 'news', botUsername: 'pe_bot' }))).toMatchObject({
      provider: 'telegram',
      recordId: 'rec-1',
      providerAccountId: '-1001',
      accountName: 'News',
      chatType: 'channel',
      username: 'news',
      botUsername: 'pe_bot',
    });
  });

  it('drops an unknown stored chat kind instead of passing it through', () => {
    const account = PROVIDER_REGISTRY.telegram.toPublicAccount(record({ chatType: 'private' }));
    expect(account).toMatchObject({ provider: 'telegram' });
    expect('chatType' in account ? account.chatType : undefined).toBeUndefined();
  });
});
