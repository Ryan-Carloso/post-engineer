import { describe, it, expect } from 'vitest';
import { accountOption, scheduleAccountIds } from '@/lib/account-options';
import { resolvePublishLinks } from '@/lib/publish-links';
import { threadsCounters } from '@/lib/metrics/provider-counters';

describe('Threads across the shared surfaces', () => {
  it('maps replies to comments and leaves saves unknown', () => {
    expect(threadsCounters({ views: 10, likes: 3, replies: 2 })).toEqual({ views: 10, likes: 3, comments: 2, saves: null });
  });

  it('links the permalink and drops a failed publish', () => {
    const permalink = 'https://www.threads.net/@a/post/x';
    expect(resolvePublishLinks([{ provider: 'threads', permalink, postId: 'p1' }])).toEqual([{ provider: 'threads', url: permalink }]);
    expect(resolvePublishLinks([{ provider: 'threads', permalink, status: 'failed' }])).toEqual([]);
  });

  it('labels accounts with the handle and counts them on the schedule', () => {
    const base = { provider: 'threads' as const, recordId: 'r', providerAccountId: '42', connectedAt: 0, lastUsed: 0 };
    expect(accountOption({ ...base, accountName: 'ana' }).label).toBe('@ana');
    expect(accountOption({ ...base, accountName: null }).label).toBe('42');
    expect(scheduleAccountIds({ threadsAccountIds: ['42'] })).toEqual(['42']);
  });
});
