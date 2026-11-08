import { describe, expect, it } from 'vitest';
import { noticesFromOutcomes, presentPublishRow } from '../publish-user-notice';

const EMAIL = 'Bluesky did not publish because the email on this account is not verified. This is a problem with your account. Only you can fix it: verify the email.';

describe('noticesFromOutcomes', () => {
  it('keeps a user-action failure while the other account is still retrying', () => {
    const { userNotices, providerFailures } = noticesFromOutcomes([
      {
        provider: 'bluesky',
        accountId: 'b1',
        status: 'failed',
        code: 'email_not_verified',
        requiresUser: true,
        notice: EMAIL,
      },
      { provider: 'youtube', accountId: '', status: 'retrying', code: 'transient', attempts: 1 },
    ]);
    expect(userNotices).toEqual([
      { provider: 'bluesky', accountId: 'b1', code: 'email_not_verified', requiresUser: true, notice: EMAIL },
    ]);
    expect(providerFailures).toEqual([
      { provider: 'bluesky', accountId: 'b1', code: 'email_not_verified', requiresUser: false, notice: EMAIL },
    ]);
  });

  it('lists a spent retry without the user-action sentence', () => {
    const { userNotices, providerFailures } = noticesFromOutcomes([
      {
        provider: 'youtube',
        accountId: 'chan-1',
        status: 'failed',
        code: 'retries_exhausted',
        requiresUser: false,
        notice: 'YouTube did not publish after 3 attempts.',
      },
    ]);
    expect(userNotices).toEqual([]);
    expect(providerFailures[0]?.notice).toBe('YouTube did not publish after 3 attempts.');
    expect(providerFailures[0]?.requiresUser).toBe(false);
  });

  it('drops the raw outcomes and omits empty notice lists', () => {
    expect(presentPublishRow({ id: 'slot-1', status: 'published', publish_outcomes: [] })).toEqual({
      id: 'slot-1',
      status: 'published',
    });
  });
});
