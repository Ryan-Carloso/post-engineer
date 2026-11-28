import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { logger } from '@/lib/logger';
import { PUBLISH_CALL_TIMEOUT_MS } from '@/lib/publisher/constants';
import { publishSlotAccounts, type PublishFn, type SlotMedia } from '@/lib/publisher/publish-accounts';
import { blankOutcome } from '@/lib/publisher/outcomes';
import type { AccountOutcome, PublishSlot } from '@/lib/publisher/types';
import type { PublishContentResult } from '@/lib/upload/publish-content';
import { NOW, SLOT_ID, USER_ID, emptyAccountIds, makeSchedule, makeSlot } from './helpers';

const MEDIA: SlotMedia = { name: 'clip.mp4', bytes: new Uint8Array([1, 2, 3]), contentType: 'video/mp4' };

function completed(results: Array<Record<string, unknown>>): PublishContentResult {
  return { ok: true, response: { success: results.some((r) => r.success === true), results: results as never } };
}

function rejected(status: number, errorCode: string, error: string): PublishContentResult {
  return { ok: false, status, errorCode: errorCode as never, error, cause: new Error(error) };
}

function setup(slot: PublishSlot, publish: PublishFn) {
  const persisted: Array<{ outcomes: AccountOutcome[]; fields: Record<string, unknown> }> = [];
  const run = () =>
    publishSlotAccounts({
      slot,
      media: MEDIA,
      title: 'Porto in one minute',
      description: 'A short guide',
      publish,
      persistOutcomes: async (outcomes, fields) => {
        persisted.push({ outcomes: JSON.parse(JSON.stringify(outcomes)), fields });
      },
      clock: () => NOW,
      logId: 'log-1',
    });
  return { run, persisted };
}

function twoYoutubeAccounts(overrides: Partial<PublishSlot> = {}): PublishSlot {
  return makeSlot({
    schedule: makeSchedule({ accountIds: { ...emptyAccountIds(), youtube: ['yt-1', 'yt-2'] } }),
    ...overrides,
  });
}

describe('publishSlotAccounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('publishes through the shared core with the slot scope key, the owner and the video part', async () => {
    const publish = vi.fn<PublishFn>(async () => completed([{ accountId: 'yt-1', success: true, videoUrl: 'https://yt/1' }]));
    const { run } = setup(makeSlot(), publish);
    const result = await run();

    const input = publish.mock.calls[0]![0];
    expect(input.provider).toBe('youtube');
    expect(input.userId).toBe(USER_ID);
    expect(input.scopeKeyRaw).toBe(`slot:${SLOT_ID}:video:clip.mp4`);
    expect(input.formData.getAll('accountIds')).toEqual(['yt-1']);
    expect(input.formData.get('title')).toBe('Porto in one minute');
    const file = input.formData.get('video');
    expect(file).toBeInstanceOf(File);
    expect((file as File).name).toBe('clip.mp4');
    expect((file as File).type).toBe('video/mp4');
    expect(result.anyPublished).toBe(true);
    expect(result.publishedProviders).toEqual(['youtube']);
    expect(result.outcomes[0]).toMatchObject({ status: 'published', videoUrl: 'https://yt/1', attempts: 1 });
  });

  it('sends the instagram media under the file field', async () => {
    const publish = vi.fn<PublishFn>(async () => completed([{ accountId: 'ig-1', success: true, permalink: 'p' }]));
    const slot = makeSlot({
      schedule: makeSchedule({ providers: ['instagram'], accountIds: { ...emptyAccountIds(), instagram: ['ig-1'] } }),
    });
    await setup(slot, publish).run();
    const form = publish.mock.calls[0]![0].formData;
    expect(form.get('file')).toBeInstanceOf(File);
    expect(form.get('video')).toBeNull();
    expect(form.getAll('igAccountIds')).toEqual(['ig-1']);
  });

  it('persists the lease and the attempt count before publishing and the outcome after', async () => {
    const publish = vi.fn<PublishFn>(async () => completed([{ accountId: 'yt-1', success: true, videoUrl: 'u' }]));
    const { run, persisted } = setup(makeSlot(), publish);
    await run();
    expect(persisted[0]!.fields).toEqual({
      status: 'publishing',
      publish_attempts: 1,
      publish_not_before: '2026-11-27T12:30:00.000Z',
    });
    expect(persisted[0]!.outcomes[0]).toMatchObject({ status: 'retrying', attempts: 1 });
    expect(persisted.at(-1)!.outcomes[0]).toMatchObject({ status: 'published' });
    expect(persisted.at(-1)!.fields).toEqual({ publish_attempts: 1 });
  });

  it('a resumed slot does not republish the account that already succeeded', async () => {
    const published: AccountOutcome = { ...blankOutcome('youtube', 'yt-1', 'clip.mp4', 1), status: 'published', code: null, videoUrl: 'u' };
    const publish = vi.fn<PublishFn>(async () => completed([{ accountId: 'yt-2', success: true, videoUrl: 'u2' }]));
    const result = await setup(twoYoutubeAccounts({ outcomes: [published], resumed: true }), publish).run();
    expect(publish.mock.calls[0]![0].formData.getAll('accountIds')).toEqual(['yt-2']);
    expect(result.outcomes.map((o) => [o.accountId, o.status])).toEqual([
      ['yt-1', 'published'],
      ['yt-2', 'published'],
    ]);
  });

  it('does not call the core at all when every account is terminal or waiting', async () => {
    const published: AccountOutcome = { ...blankOutcome('youtube', 'yt-1', 'clip.mp4', 1), status: 'published', code: null };
    const waiting: AccountOutcome = {
      ...blankOutcome('youtube', 'yt-2', 'clip.mp4', 1),
      retryAt: '2026-11-27T12:00:30.000Z',
    };
    const publish = vi.fn<PublishFn>();
    const result = await setup(twoYoutubeAccounts({ outcomes: [published, waiting] }), publish).run();
    expect(publish).not.toHaveBeenCalled();
    expect(result.anyRetrying).toBe(true);
    expect(result.failureReason).toBe('some accounts still retrying: youtube');
  });

  it('keeps the first account live when the second one has an unverified email, notifying once', async () => {
    const publish = vi.fn<PublishFn>(async () =>
      completed([
        { accountId: 'yt-1', success: true, videoUrl: 'u' },
        { accountId: 'yt-2', success: false, error: 'email', errorCode: 'email_not_verified' },
      ]),
    );
    const result = await setup(twoYoutubeAccounts(), publish).run();
    expect(result.anyPublished).toBe(true);
    expect(result.newUserNotices).toHaveLength(1);
    expect(result.newUserNotices[0]).toContain('verify the email on YouTube');
    expect(result.nonUserFailedProviders).toEqual([]);
    expect(result.failedProviders).toEqual(['youtube']);
  });

  it('does not notify again for an account that already needed the user', async () => {
    const already: AccountOutcome = {
      ...blankOutcome('youtube', 'yt-1', 'clip.mp4', 1),
      status: 'failed',
      code: 'token_expired',
      requiresUser: true,
      notice: 'reconnect',
    };
    const result = await setup(makeSlot({ outcomes: [already] }), vi.fn<PublishFn>()).run();
    expect(result.newUserNotices).toEqual([]);
  });

  it('three transient failures exhaust the account without the user sentence', async () => {
    const publish = vi.fn<PublishFn>(async () => completed([{ accountId: 'yt-1', success: false, error: 'busy', errorCode: 'transient' }]));
    let slot = makeSlot();
    let result = await setup(slot, publish).run();
    expect(result.anyRetrying).toBe(true);
    expect(result.outcomes[0]).toMatchObject({ status: 'retrying', attempts: 1, retryAt: '2026-11-27T12:00:30.000Z' });

    slot = makeSlot({ outcomes: [{ ...result.outcomes[0]!, retryAt: '2026-11-27T11:00:00.000Z' }], resumed: true });
    result = await setup(slot, publish).run();
    expect(result.outcomes[0]).toMatchObject({ status: 'retrying', attempts: 2, retryAt: '2026-11-27T12:02:00.000Z' });

    slot = makeSlot({ outcomes: [{ ...result.outcomes[0]!, retryAt: '2026-11-27T11:00:00.000Z' }], resumed: true });
    result = await setup(slot, publish).run();
    expect(result.outcomes[0]).toMatchObject({ status: 'failed', code: 'retries_exhausted', requiresUser: false, attempts: 3 });
    expect(result.anyRetrying).toBe(false);
    expect(result.newUserNotices).toEqual([]);
    expect(result.failureReason).toBe('all providers failed: youtube');
  });

  it('an in-progress result waits without spending an attempt, then replays the success', async () => {
    const publish = vi
      .fn<PublishFn>()
      .mockResolvedValueOnce(completed([{ accountId: 'yt-1', success: false, error: 'still going', errorCode: 'publish_in_progress' }]))
      .mockResolvedValueOnce(completed([{ accountId: 'yt-1', success: true, videoUrl: 'u' }]));
    let result = await setup(makeSlot(), publish).run();
    expect(result.outcomes[0]).toMatchObject({ status: 'retrying', code: 'publish_in_progress', attempts: 0, inProgressWaitSeconds: 60 });
    result = await setup(makeSlot({ outcomes: [{ ...result.outcomes[0]!, retryAt: '2026-11-27T11:00:00.000Z' }], resumed: true }), publish).run();
    expect(result.outcomes[0]).toMatchObject({ status: 'published', attempts: 1, inProgressWaitSeconds: 60 });
  });

  it('an in-progress wait past the cap parks the account as an unknown publish for the user', async () => {
    const publish = vi.fn<PublishFn>(async () =>
      completed([{ accountId: 'yt-1', success: false, error: 'still going', errorCode: 'publish_in_progress' }]),
    );
    const previous: AccountOutcome = {
      ...blankOutcome('youtube', 'yt-1', 'clip.mp4', 1),
      code: 'publish_in_progress',
      retryAt: '2026-11-27T11:00:00.000Z',
      inProgressWaitSeconds: 1740,
    };
    const result = await setup(makeSlot({ outcomes: [previous], resumed: true }), publish).run();
    expect(result.outcomes[0]).toMatchObject({ status: 'failed', code: 'publish_unknown', requiresUser: true });
    expect(result.newUserNotices[0]).toContain('may already have published');
  });

  it('an unlabeled rejection applies to every pending account', async () => {
    const publish = vi.fn<PublishFn>(async () =>
      completed([{ accountId: '', success: false, error: 'No video file was sent', errorCode: 'publish_rejected' }]),
    );
    const result = await setup(twoYoutubeAccounts(), publish).run();
    expect(result.outcomes.map((o) => [o.accountId, o.status, o.code])).toEqual([
      ['yt-1', 'failed', 'publish_rejected'],
      ['yt-2', 'failed', 'publish_rejected'],
    ]);
  });

  it('a core rejection fails every started account by its code and records a provider failure', async () => {
    const publish = vi.fn<PublishFn>(async () => rejected(401, 'disconnected', 'Account yt-1 not found'));
    const result = await setup(makeSlot(), publish).run();
    expect(result.outcomes[0]).toMatchObject({ status: 'failed', code: 'disconnected', requiresUser: true });
    expect(result.providerFailures).toEqual([{ provider: 'youtube', status: 401, message: 'Account yt-1 not found' }]);
    expect(result.firstError).toBe('Account yt-1 not found');
    expect(result.failureReason).toBe('all providers failed: youtube: Account yt-1 not found');
    expect(logger.warn).toHaveBeenCalledWith(
      '[publisher] provider publish rejected',
      expect.objectContaining({ slotId: SLOT_ID, provider: 'youtube', status: 401 }),
    );
  });

  it('a transient core rejection retries', async () => {
    const publish = vi.fn<PublishFn>(async () => rejected(503, 'transient', 'upstream busy'));
    const result = await setup(makeSlot(), publish).run();
    expect(result.outcomes[0]).toMatchObject({ status: 'retrying', code: 'transient' });
    expect(result.anyRetrying).toBe(true);
  });

  it('a throwing core call is a transient failure with a provider failure and a logged error', async () => {
    const publish = vi.fn<PublishFn>(async () => {
      throw new Error('socket hang up');
    });
    const result = await setup(makeSlot(), publish).run();
    expect(result.outcomes[0]).toMatchObject({ status: 'retrying', code: 'transient' });
    expect(result.providerFailures).toEqual([{ provider: 'youtube', status: null, message: 'socket hang up' }]);
    expect(logger.error).toHaveBeenCalledWith('[publisher] publish call threw', expect.any(Error), {
      slotId: SLOT_ID,
      provider: 'youtube',
    });
  });

  it('a plan error rejects the accounts without being a provider failure', async () => {
    const publish = vi.fn<PublishFn>();
    const slot = makeSlot({
      schedule: makeSchedule({ providers: ['pinterest'], accountIds: { ...emptyAccountIds(), pinterest: ['pin-1'] }, pinterestBoardId: null }),
    });
    const result = await setup(slot, publish).run();
    expect(publish).not.toHaveBeenCalled();
    expect(result.outcomes[0]).toMatchObject({ status: 'failed', code: 'publish_rejected' });
    expect(result.providerFailures).toEqual([]);
    expect(result.firstError).toBe('pinterest publish requires a board id');
  });

  it('a call that never settles times out as a transient failure', async () => {
    vi.useFakeTimers();
    try {
      const publish = vi.fn<PublishFn>(() => new Promise<PublishContentResult>(() => undefined));
      const pending = setup(makeSlot(), publish).run();
      await vi.advanceTimersByTimeAsync(PUBLISH_CALL_TIMEOUT_MS + 1);
      const result = await pending;
      expect(result.outcomes[0]).toMatchObject({ status: 'retrying', code: 'transient' });
      expect(result.providerFailures[0]).toMatchObject({ provider: 'youtube', status: 504 });
      expect(result.firstError).toBe('publish timed out after 25 minutes');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a new account starts at attempt one, not at the slot counter', async () => {
    const publish = vi.fn<PublishFn>(async () => completed([{ accountId: 'yt-2', success: true, videoUrl: 'u' }]));
    const first: AccountOutcome = { ...blankOutcome('youtube', 'yt-1', 'clip.mp4', 3), status: 'failed', code: 'retries_exhausted' };
    const result = await setup(twoYoutubeAccounts({ outcomes: [first], attempts: 3 }), publish).run();
    expect(result.outcomes.find((o) => o.accountId === 'yt-2')!.attempts).toBe(1);
  });

  it('a legacy slot without outcomes keeps the slot counter', async () => {
    const publish = vi.fn<PublishFn>(async () => completed([{ accountId: 'yt-1', success: false, error: 'x', errorCode: 'transient' }]));
    const result = await setup(makeSlot({ attempts: 1 }), publish).run();
    expect(result.outcomes[0]!.attempts).toBe(2);
  });

  it('a legacy outcome without attempts keeps the slot counter', async () => {
    const legacy: AccountOutcome = { ...blankOutcome('youtube', 'yt-1', 'clip.mp4', 0), attempts: null, retryAt: '2026-11-27T11:00:00.000Z' };
    const publish = vi.fn<PublishFn>(async () => completed([{ accountId: 'yt-1', success: false, error: 'x', errorCode: 'transient' }]));
    const result = await setup(makeSlot({ outcomes: [legacy], attempts: 2, resumed: true }), publish).run();
    expect(result.outcomes[0]!.attempts).toBe(3);
  });

  it('exhausts a retrying account that is already at the cap without calling the core', async () => {
    const atCap: AccountOutcome = { ...blankOutcome('youtube', 'yt-1', 'clip.mp4', 3), retryAt: '2026-11-27T12:30:00.000Z' };
    const publish = vi.fn<PublishFn>();
    const result = await setup(makeSlot({ outcomes: [atCap], resumed: true }), publish).run();
    expect(publish).not.toHaveBeenCalled();
    expect(result.outcomes[0]).toMatchObject({ status: 'failed', code: 'retries_exhausted' });
  });

  it('names the retrying accounts in the reason of a partial publish', async () => {
    const publish = vi.fn<PublishFn>(async () =>
      completed([
        { accountId: 'yt-1', success: true, videoUrl: 'u' },
        { accountId: 'yt-2', success: false, error: 'busy', errorCode: 'transient' },
      ]),
    );
    const result = await setup(twoYoutubeAccounts(), publish).run();
    expect(result.failureReason).toBe('some accounts still retrying: youtube');
  });

  it('sends the first comment for a comment network only, and keeps the warning on the outcome', async () => {
    const publish = vi.fn<PublishFn>(async () =>
      completed([{ accountId: 'yt-1', success: true, videoUrl: 'u', warnings: ['first_comment_failed'] }]),
    );
    const result = await setup(makeSlot({ firstComment: 'Link in bio' }), publish).run();
    expect(publish.mock.calls[0]![0].formData.get('firstComment')).toBe('Link in bio');
    expect(result.outcomes[0]!.warnings).toEqual(['first_comment_failed']);

    const rumble = makeSlot({
      firstComment: 'Link in bio',
      schedule: makeSchedule({ providers: ['rumble'], accountIds: { ...emptyAccountIds(), rumble: ['ru-1'] } }),
    });
    const rumblePublish = vi.fn<PublishFn>(async () => completed([{ accountId: 'ru-1', success: true, videoUrl: 'u' }]));
    await setup(rumble, rumblePublish).run();
    expect(rumblePublish.mock.calls[0]![0].formData.has('firstComment')).toBe(false);
  });

  it('omits the first comment field when the slot has none', async () => {
    const publish = vi.fn<PublishFn>(async () => completed([{ accountId: 'yt-1', success: true, videoUrl: 'u' }]));
    await setup(makeSlot(), publish).run();
    expect(publish.mock.calls[0]![0].formData.has('firstComment')).toBe(false);
  });

  it('one provider failing does not stop the next provider', async () => {
    const publish = vi
      .fn<PublishFn>()
      .mockResolvedValueOnce(rejected(400, 'publish_rejected', 'bad media'))
      .mockResolvedValueOnce(completed([{ accountId: 'bs-1', success: true, postId: 'p' }]));
    const slot = makeSlot({
      schedule: makeSchedule({
        providers: ['youtube', 'bluesky'],
        accountIds: { ...emptyAccountIds(), youtube: ['yt-1'], bluesky: ['bs-1'] },
      }),
    });
    const result = await setup(slot, publish).run();
    expect(publish).toHaveBeenCalledTimes(2);
    expect(result.publishedProviders).toEqual(['bluesky']);
    expect(result.failedProviders).toEqual(['youtube']);
    expect(result.nonUserFailedProviders).toEqual(['youtube']);
  });

  it('uses a placeholder account for a schedule without accounts and fails it', async () => {
    const publish = vi.fn<PublishFn>(async () =>
      completed([{ accountId: '', success: false, error: 'At least one account ID is required', errorCode: 'publish_rejected' }]),
    );
    const slot = makeSlot({ schedule: makeSchedule({ personaId: null, accountIds: emptyAccountIds() }) });
    const result = await setup(slot, publish).run();
    expect(result.outcomes[0]).toMatchObject({ accountId: '', status: 'failed', code: 'publish_rejected' });
  });
});

afterEach(() => {
  vi.useRealTimers();
});
