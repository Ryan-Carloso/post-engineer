import { describe, expect, it } from 'vitest';
import {
  blankOutcome,
  classifyFailure,
  exhaustOutcome,
  failOutcome,
  hasLiveOutcome,
  indexOutcomes,
  isDue,
  isTerminal,
  leaseIso,
  nextDelaySeconds,
  outcomeKey,
  priorAttempts,
  publishOutcome,
  upsertOutcome,
  userNotice,
} from '@/lib/publisher/outcomes';
import { NOW } from './helpers';

function outcome(overrides = {}) {
  return { ...blankOutcome('youtube', 'yt-1', 'clip.mp4', 1), ...overrides };
}

describe('nextDelaySeconds and leaseIso', () => {
  it('backs off 30 s then 2 min and never schedules a third delay', () => {
    expect(nextDelaySeconds(1)).toBe(30);
    expect(nextDelaySeconds(2)).toBe(120);
    expect(nextDelaySeconds(3)).toBeNull();
    expect(nextDelaySeconds(9)).toBeNull();
    expect(nextDelaySeconds(0)).toBe(30);
  });

  it('parks a 30 minute attempt lease', () => {
    expect(leaseIso(NOW)).toBe('2026-11-27T12:30:00.000Z');
  });
});

describe('userNotice', () => {
  it('names the provider in every user-fixable notice', () => {
    expect(userNotice('instagram', 'email_not_verified')).toContain('verify the email on Instagram');
    for (const [provider, label] of [
      ['facebook', 'Facebook'],
      ['pinterest', 'Pinterest'],
      ['rumble', 'Rumble'],
      ['fanvue', 'Fanvue'],
      ['youtube', 'YouTube'],
    ] as const) {
      expect(userNotice(provider, 'token_expired')).toBe(
        `${label} did not publish because the account needs to be reconnected. This is a problem with your account. Only you can fix it: reconnect ${label}.`,
      );
    }
    for (const code of ['token_missing', 'disconnected']) {
      expect(userNotice('bluesky', code)).toContain('reconnect Bluesky');
    }
  });

  it('warns that an unknown publish may already be live', () => {
    expect(userNotice('youtube', 'publish_unknown')).toContain('Check YouTube before posting it again');
  });

  it('has no user notice for non-user codes', () => {
    expect(userNotice('youtube', 'transient')).toBeNull();
    expect(userNotice('youtube', 'publish_rejected')).toBeNull();
  });
});

describe('classifyFailure', () => {
  it('trusts the code, never the text', () => {
    expect(classifyFailure('token_expired')).toEqual({ code: 'token_expired', requiresUser: true });
    expect(classifyFailure('publish_unknown')).toEqual({ code: 'publish_unknown', requiresUser: true });
    expect(classifyFailure('publish_rejected')).toEqual({ code: 'publish_rejected', requiresUser: false });
    expect(classifyFailure('publish_in_progress')).toEqual({ code: 'publish_in_progress', requiresUser: false });
    expect(classifyFailure(' transient ')).toEqual({ code: 'transient', requiresUser: false });
  });

  it('treats a missing or unknown code as transient', () => {
    expect(classifyFailure(null)).toEqual({ code: 'transient', requiresUser: false });
    expect(classifyFailure('something_new')).toEqual({ code: 'transient', requiresUser: false });
  });
});

describe('failOutcome', () => {
  it('a transient failure under the cap waits with the backoff', () => {
    const item = outcome({ attempts: 1 });
    failOutcome(item, 'upstream 503', 'transient', NOW);
    expect(item).toMatchObject({ status: 'retrying', code: 'transient', requiresUser: false, notice: null });
    expect(item.retryAt).toBe('2026-11-27T12:00:30.000Z');
  });

  it('a transient failure at the cap is exhausted with the attempt count in the notice', () => {
    const item = outcome({ attempts: 3 });
    failOutcome(item, 'upstream 503', 'transient', NOW);
    expect(item).toMatchObject({ status: 'failed', code: 'retries_exhausted', requiresUser: false, retryAt: null });
    expect(item.notice).toBe('YouTube did not publish after 3 attempts.');
  });

  it('a user code fails at once with the user notice', () => {
    const item = outcome({ attempts: 1 });
    failOutcome(item, 'token revoked', 'token_expired', NOW);
    expect(item).toMatchObject({ status: 'failed', code: 'token_expired', requiresUser: true, retryAt: null });
    expect(item.notice).toContain('reconnect YouTube');
  });

  it('a rejection fails at once without a user sentence', () => {
    const item = outcome({ attempts: 1 });
    failOutcome(item, 'bad media', 'publish_rejected', NOW);
    expect(item).toMatchObject({ status: 'failed', code: 'publish_rejected', requiresUser: false });
    expect(item.notice).toBe('YouTube did not publish.');
  });

  it('in progress waits one minute without spending an attempt and records the waited seconds', () => {
    const item = outcome({ attempts: 2 });
    failOutcome(item, 'still publishing', 'publish_in_progress', NOW);
    expect(item).toMatchObject({ status: 'retrying', code: 'publish_in_progress', attempts: 1, inProgressWaitSeconds: 60 });
    expect(item.retryAt).toBe('2026-11-27T12:01:00.000Z');
  });

  it('in progress never goes below zero attempts', () => {
    const item = outcome({ attempts: 0 });
    failOutcome(item, 'still publishing', 'publish_in_progress', NOW);
    expect(item.attempts).toBe(0);
  });

  it('in progress at the wait cap fails as an unknown publish that needs the user', () => {
    const item = outcome({ attempts: 1, inProgressWaitSeconds: 1740 });
    failOutcome(item, 'still publishing', 'publish_in_progress', NOW);
    expect(item).toMatchObject({ status: 'failed', code: 'publish_unknown', requiresUser: true, retryAt: null });
    expect(item.notice).toContain('may already have published');
  });

  it('in progress just below the wait cap keeps waiting', () => {
    const item = outcome({ attempts: 1, inProgressWaitSeconds: 1680 });
    failOutcome(item, 'still publishing', 'publish_in_progress', NOW);
    expect(item.status).toBe('retrying');
    expect(item.inProgressWaitSeconds).toBe(1740);
  });

  it('scrubs the stored error', () => {
    const item = outcome({ attempts: 1 });
    failOutcome(item, 'failed token=SECRET123', 'transient', NOW);
    expect(item.error).toBe('failed token=[redacted]');
  });
});

describe('exhaustOutcome and publishOutcome', () => {
  it('exhaust is terminal without user copy', () => {
    const item = outcome({ attempts: 3 });
    exhaustOutcome(item);
    expect(item).toMatchObject({ status: 'failed', code: 'retries_exhausted', requiresUser: false });
    expect(isTerminal(item)).toBe(true);
  });

  it('publish copies the links and the string warnings only, and clears a failure', () => {
    const item = outcome({ attempts: 1, error: 'old', code: 'transient' });
    publishOutcome(item, { videoUrl: 'https://yt/1', postId: 'p1', warnings: ['first_comment_failed', 7, ''] });
    expect(item).toMatchObject({
      status: 'published',
      code: null,
      error: null,
      videoUrl: 'https://yt/1',
      postId: 'p1',
      warnings: ['first_comment_failed'],
    });
  });

  it('publish clears stale warnings when the result has none or a non-list', () => {
    const item = outcome({ warnings: ['stale'] });
    publishOutcome(item, { warnings: 'nope' });
    expect(item.warnings).toBeUndefined();
  });
});

describe('isTerminal, isDue and priorAttempts', () => {
  it('published and user failures are terminal, a transient failure only at the cap', () => {
    expect(isTerminal(outcome({ status: 'published' }))).toBe(true);
    expect(isTerminal(outcome({ status: 'failed', requiresUser: true }))).toBe(true);
    expect(isTerminal(outcome({ status: 'failed', code: 'publish_rejected' }))).toBe(true);
    expect(isTerminal(outcome({ status: 'failed', code: 'transient', attempts: 2 }))).toBe(false);
    expect(isTerminal(outcome({ status: 'failed', code: 'transient', attempts: 3 }))).toBe(true);
    expect(isTerminal(outcome({ status: 'retrying' }))).toBe(false);
    expect(isTerminal(undefined)).toBe(false);
  });

  it('a retrying outcome is due only once its wake time has passed', () => {
    expect(isDue(outcome({ status: 'retrying', retryAt: '2026-11-27T12:00:30.000Z' }), NOW)).toBe(false);
    expect(isDue(outcome({ status: 'retrying', retryAt: '2026-11-27T12:00:00.000Z' }), NOW)).toBe(true);
    expect(isDue(outcome({ status: 'retrying', retryAt: null }), NOW)).toBe(true);
    expect(isDue(outcome({ status: 'retrying', retryAt: 'not a date' }), NOW)).toBe(true);
    expect(isDue(outcome({ status: 'retrying', attempts: 3, retryAt: '2030-01-01T00:00:00.000Z' }), NOW)).toBe(true);
    expect(isDue(undefined, NOW)).toBe(true);
    expect(isDue(outcome({ status: 'published' }), NOW)).toBe(false);
  });

  it('a new account starts at zero, a legacy slot keeps the slot counter, a legacy outcome too', () => {
    expect(priorAttempts(undefined, 5, false)).toBe(0);
    expect(priorAttempts(undefined, 2, true)).toBe(2);
    expect(priorAttempts(outcome({ attempts: 2 }), 5, false)).toBe(2);
    expect(priorAttempts(outcome({ attempts: null }), 4, false)).toBe(4);
  });
});

describe('hasLiveOutcome', () => {
  it('is false with no outcomes or only terminal ones, true while any account still has live work', () => {
    expect(hasLiveOutcome([])).toBe(false);
    expect(hasLiveOutcome([outcome({ status: 'published' })])).toBe(true);
    expect(hasLiveOutcome([outcome({ status: 'retrying' })])).toBe(true);
    expect(hasLiveOutcome([outcome({ status: 'failed', code: 'transient', attempts: 2 })])).toBe(false);
    expect(hasLiveOutcome([outcome({ status: 'failed', requiresUser: true })])).toBe(false);
    expect(hasLiveOutcome([outcome({ status: 'failed', code: 'publish_rejected' })])).toBe(false);
  });
});

describe('index and upsert', () => {
  it('keys outcomes by provider, account and video', () => {
    const a = outcome();
    const b = outcome({ accountId: 'yt-2' });
    const index = indexOutcomes([a, b]);
    expect(index.get(outcomeKey('youtube', 'yt-2', 'clip.mp4'))).toBe(b);
  });

  it('upsert replaces the same key and appends a new one', () => {
    const list = [outcome({ attempts: 1 })];
    upsertOutcome(list, outcome({ attempts: 2 }));
    upsertOutcome(list, outcome({ accountId: 'yt-2' }));
    expect(list.map((item) => [item.accountId, item.attempts])).toEqual([
      ['yt-1', 2],
      ['yt-2', 1],
    ]);
  });
});
