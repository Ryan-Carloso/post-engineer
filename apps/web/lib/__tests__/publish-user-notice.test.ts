import { describe, expect, it } from 'vitest';
import {
  mergeBySlotAt,
  noticesFromOutcomes,
  presentPublishRow,
  providerLabel,
  USER_NOTICE_OUTCOME_FILTER,
} from '../publish-user-notice';

const EMAIL = 'Bluesky did not publish because the email on this account is not verified. This is a problem with your account. Only you can fix it: verify the email on Bluesky.';

const emailOutcome = (video: string) => ({
  provider: 'bluesky',
  accountId: 'b1',
  video,
  status: 'failed',
  code: 'email_not_verified',
  requiresUser: true,
  notice: EMAIL,
});

describe('noticesFromOutcomes', () => {
  it('keeps a user-action failure while the other account is still retrying', () => {
    const { userNotices, providerFailures } = noticesFromOutcomes([
      emailOutcome('v1.mp4'),
      { provider: 'youtube', accountId: '', status: 'retrying', code: 'transient', attempts: 1 },
    ]);
    expect(userNotices).toEqual([
      { provider: 'bluesky', accountId: 'b1', code: 'email_not_verified', requiresUser: true, notice: EMAIL },
    ]);
    // providerFailures mirrors the stored outcome: a user failure stays requiresUser true.
    expect(providerFailures).toEqual([
      { provider: 'bluesky', accountId: 'b1', code: 'email_not_verified', requiresUser: true, notice: EMAIL },
    ]);
  });

  it('lists one notice per account when a slot has several videos', () => {
    const { userNotices, providerFailures } = noticesFromOutcomes([emailOutcome('v1.mp4'), emailOutcome('v2.mp4')]);
    expect(userNotices).toHaveLength(1);
    expect(providerFailures).toHaveLength(1);
  });

  it('surfaces a parked publish_unknown outcome as a user notice', () => {
    const notice =
      'Fanvue may already have published this video, but the publish record was lost. ' +
      'Check Fanvue before posting it again: this slot will not retry on its own and the token was not refunded.';
    const { userNotices, providerFailures } = noticesFromOutcomes([
      { provider: 'fanvue', accountId: 'f1', status: 'failed', code: 'publish_unknown', requiresUser: true, notice },
    ]);
    expect(userNotices).toEqual([
      { provider: 'fanvue', accountId: 'f1', code: 'publish_unknown', requiresUser: true, notice },
    ]);
    expect(providerFailures).toEqual([
      { provider: 'fanvue', accountId: 'f1', code: 'publish_unknown', requiresUser: true, notice },
    ]);
  });

  it('does not surface publish_unknown without the stored requiresUser flag', () => {
    const notice = 'Fanvue may already have published this video, but the publish record was lost.';
    const { userNotices, providerFailures } = noticesFromOutcomes([
      { provider: 'fanvue', accountId: 'f1', status: 'failed', code: 'publish_unknown', requiresUser: false, notice },
    ]);
    expect(userNotices).toEqual([]);
    expect(providerFailures).toEqual([
      { provider: 'fanvue', accountId: 'f1', code: 'publish_unknown', requiresUser: false, notice },
    ]);
  });

  it('does not trust requiresUser on a code that is not a user code', () => {
    const { userNotices, providerFailures } = noticesFromOutcomes([
      { provider: 'youtube', accountId: 'c1', status: 'failed', code: 'publish_rejected', requiresUser: true, notice: '' },
    ]);
    expect(userNotices).toEqual([]);
    expect(providerFailures).toEqual([
      { provider: 'youtube', accountId: 'c1', code: 'publish_rejected', requiresUser: false, notice: 'YouTube did not publish.' },
    ]);
  });

  it('lists a spent retry without the user-action sentence', () => {
    const { userNotices, providerFailures } = noticesFromOutcomes([
      { provider: 'youtube', accountId: 'chan-1', status: 'failed', code: 'retries_exhausted', requiresUser: false, notice: '' },
    ]);
    expect(userNotices).toEqual([]);
    expect(providerFailures[0]?.notice).toBe('YouTube did not publish after 3 attempts.');
    expect(providerFailures[0]?.requiresUser).toBe(false);
  });

  it('ignores non-array and non-object input', () => {
    expect(noticesFromOutcomes(null)).toEqual({ userNotices: [], providerFailures: [] });
    expect(noticesFromOutcomes([null, 'x'])).toEqual({ userNotices: [], providerFailures: [] });
  });

  it('drops the raw outcomes and omits empty notice lists', () => {
    expect(presentPublishRow({ id: 'slot-1', status: 'published', publish_outcomes: [] })).toEqual({
      id: 'slot-1',
      status: 'published',
    });
  });
});

describe('providerLabel', () => {
  it('uses the shared provider labels and falls back to the raw name', () => {
    expect(providerLabel('linkedin')).toBe('LinkedIn');
    expect(providerLabel('mastodon')).toBe('mastodon');
  });
});

describe('mergeBySlotAt', () => {
  it('sorts both lists by slot_at and caps the result', () => {
    const merged = mergeBySlotAt(
      [{ id: 'p', slot_at: '2026-09-24T10:00:00Z' }],
      [{ id: 'a', slot_at: '2026-09-24T09:00:00Z' }, { id: 'b', slot_at: '2026-09-24T11:00:00Z' }],
      2,
    );
    expect(merged.map((row) => row.id)).toEqual(['a', 'p']);
  });
});

describe('USER_NOTICE_OUTCOME_FILTER', () => {
  it('is a JSON array so postgrest sends a jsonb containment, not a {} array literal', () => {
    expect(USER_NOTICE_OUTCOME_FILTER).toBe('[{"requiresUser":true}]');
  });
});
