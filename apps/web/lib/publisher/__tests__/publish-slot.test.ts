// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { logger } from '@/lib/logger';
import { failedOutcomes, failSlotPermanently, publishSlot, type PublishSlotDeps } from '@/lib/publisher/publish-slot';
import type { PublishFn } from '@/lib/publisher/publish-accounts';
import { blankOutcome } from '@/lib/publisher/outcomes';
import type { PublisherStore } from '@/lib/publisher/store-types';
import type { PublishContentResult } from '@/lib/upload/publish-content';
import { NOW, PERSONA_ID, SLOT_ID, UPLOAD_ID, USER_ID, emptyAccountIds, makeSchedule, makeSlot, makeStore, readyUpload } from './helpers';

function completed(results: Array<Record<string, unknown>>): PublishContentResult {
  return { ok: true, response: { success: results.some((r) => r.success === true), results: results as never } };
}

function rejected(status: number, errorCode: string, error: string): PublishContentResult {
  return { ok: false, status, errorCode: errorCode as never, error, cause: new Error(error) };
}

function build(publish: PublishFn, storeOverrides: Partial<PublisherStore> = {}) {
  const store = makeStore(storeOverrides);
  const events: Array<[string, Record<string, unknown>]> = [];
  const deps: PublishSlotDeps = {
    store,
    publish,
    clock: () => NOW,
    track: (event, properties) => {
      events.push([event, properties]);
    },
    discord: vi.fn(async () => true),
    mailFailed: vi.fn(async () => undefined),
    mailPartial: vi.fn(async () => undefined),
    newLogId: () => 'log-1',
  };
  return { deps, store, events };
}

const publishedOk = (): PublishFn => vi.fn(async () => completed([{ accountId: 'yt-1', success: true, videoUrl: 'https://yt/1' }]));
const eventNames = (events: Array<[string, unknown]>): string[] => events.map(([name]) => name);

function twoProviders() {
  return makeSlot({
    schedule: makeSchedule({
      providers: ['youtube', 'bluesky'],
      accountIds: { ...emptyAccountIds(), youtube: ['yt-1'], bluesky: ['bs-1'] },
    }),
  });
}

describe('publishSlot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('publishes an upload slot, marks it published, removes the single-use bytes and notifies', async () => {
    const { deps, store, events } = build(publishedOk());
    const published = await publishSlot(deps, makeSlot());

    expect(published).toBe(true);
    expect(store.updates.at(-1)).toMatchObject({
      status: 'published',
      published_at: NOW.toISOString(),
      publish_not_before: null,
      publish_attempts: 1,
    });
    expect(store.removeStorageObject).toHaveBeenCalledWith('videos', `${USER_ID}/${UPLOAD_ID}.mp4`);
    expect(eventNames(events)).toEqual(['video_publish_started', 'video_published']);
    expect(events[1]![1]).toMatchObject({ slotId: SLOT_ID, user_id: USER_ID, providers: ['youtube'] });
    expect(deps.discord).toHaveBeenCalledWith(expect.stringContaining('Post published — persona: Maya | title: Porto in one minute | providers: youtube'));
    expect(deps.mailFailed).not.toHaveBeenCalled();
    expect(deps.mailPartial).not.toHaveBeenCalled();
  });

  it('a resumed slot does not emit video_publish_started again', async () => {
    const { deps, events } = build(publishedOk());
    await publishSlot(deps, makeSlot({ resumed: true }));
    expect(eventNames(events)).toEqual(['video_published']);
  });

  it('one provider failing and another publishing is a partial publish: published, alerted, no retry', async () => {
    const publish = vi
      .fn<PublishFn>()
      .mockResolvedValueOnce(rejected(400, 'publish_rejected', 'bad media'))
      .mockResolvedValueOnce(completed([{ accountId: 'bs-1', success: true, postId: 'p1' }]));
    const { deps, store, events } = build(publish);
    const published = await publishSlot(deps, twoProviders());

    expect(published).toBe(true);
    expect(store.updates.at(-1)).toMatchObject({ status: 'published' });
    expect(eventNames(events)).toEqual(['video_publish_started', 'publish_provider_failed', 'video_published', 'video_publish_partial_failure']);
    expect(events[3]![1]).toMatchObject({ failed_providers: ['youtube'], published_providers: ['bluesky'], reason: 'bad media' });
    expect(deps.discord).toHaveBeenCalledWith('⚠️ Partial publish — slot: slot-1 | failed providers: youtube');
    expect(deps.mailPartial).toHaveBeenCalledWith({
      userId: USER_ID,
      slotId: SLOT_ID,
      title: 'Porto in one minute',
      persona: 'Maya',
      failures: [{ provider: 'youtube', accountId: 'yt-1', reason: 'bad media' }],
    });
  });

  it('a partial publish that failed only on user problems skips the partial Discord alert but still mails the owner', async () => {
    const publish = vi
      .fn<PublishFn>()
      .mockResolvedValueOnce(completed([{ accountId: 'yt-1', success: false, error: 'revoked', errorCode: 'token_expired' }]))
      .mockResolvedValueOnce(completed([{ accountId: 'bs-1', success: true, postId: 'p1' }]));
    const { deps } = build(publish);
    await publishSlot(deps, twoProviders());
    const messages = vi.mocked(deps.discord).mock.calls.map(([message]) => message);
    expect(messages.some((message) => message.startsWith('⚠️ Partial publish'))).toBe(false);
    expect(messages.some((message) => message.includes('reconnect YouTube'))).toBe(true);
    expect(deps.mailPartial).toHaveBeenCalledTimes(1);
  });

  it('every provider failing for good fails the slot once with the failed accounts, the cleanup and the alerts', async () => {
    const publish = vi.fn<PublishFn>(async () => rejected(400, 'publish_rejected', 'bad media'));
    const { deps, store, events } = build(publish);
    const published = await publishSlot(deps, makeSlot());

    expect(published).toBe(false);
    expect(store.updates.at(-1)).toMatchObject({
      status: 'failed',
      error: 'publish failed after 1 attempts: all providers failed: youtube: bad media',
      publish_not_before: null,
      publish_attempts: 1,
    });
    expect(store.removeStorageObject).toHaveBeenCalledWith('videos', `${USER_ID}/${UPLOAD_ID}.mp4`);
    expect(eventNames(events)).toEqual(['video_publish_started', 'publish_provider_failed', 'video_publish_failed']);
    expect(events[2]![1]).toMatchObject({ retryable: false, attempts: 1 });
    expect(deps.mailFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        slotId: SLOT_ID,
        failures: [{ provider: 'youtube', accountId: 'yt-1', reason: 'bad media' }],
      }),
    );
    expect(deps.discord).toHaveBeenCalledWith(expect.stringContaining('❌ Slot failed — persona: Maya | title: Porto in one minute | reason: all providers failed: youtube: bad media'));
  });

  it('a transient failure parks the slot publishing until the soonest retry and keeps the media', async () => {
    const publish = vi.fn<PublishFn>(async () => rejected(503, 'transient', 'upstream busy'));
    const { deps, store, events } = build(publish);
    const published = await publishSlot(deps, makeSlot());

    expect(published).toBe(false);
    expect(store.updates.at(-1)).toMatchObject({
      status: 'publishing',
      publish_not_before: '2026-11-27T12:00:30.000Z',
      publish_attempts: 1,
    });
    expect(store.removeStorageObject).not.toHaveBeenCalled();
    expect(deps.mailFailed).not.toHaveBeenCalled();
    expect(events.at(-1)).toEqual(['video_publish_failed', expect.objectContaining({ retryable: true, attempts: 1 })]);
  });

  it('picks the earliest retry time across accounts', async () => {
    const soon = { ...blankOutcome('youtube', 'yt-1', `${UPLOAD_ID}.mp4`, 1), retryAt: '2026-11-27T12:05:00.000Z' };
    const later = { ...blankOutcome('youtube', 'yt-2', `${UPLOAD_ID}.mp4`, 1), retryAt: '2026-11-27T12:20:00.000Z' };
    const slot = makeSlot({
      resumed: true,
      outcomes: [later, soon],
      schedule: makeSchedule({ accountIds: { ...emptyAccountIds(), youtube: ['yt-1', 'yt-2'] } }),
    });
    const { deps, store } = build(vi.fn<PublishFn>());
    await publishSlot(deps, slot);
    expect(store.updates.at(-1)).toMatchObject({ status: 'publishing', publish_not_before: '2026-11-27T12:05:00.000Z' });
  });

  it('fails a slot whose account is not bound to the persona before touching the media', async () => {
    const { deps, store, events } = build(vi.fn<PublishFn>(), { personaBoundAccounts: vi.fn(async () => ({ youtube: ['other'] })) });
    const published = await publishSlot(deps, makeSlot());

    expect(published).toBe(false);
    expect(store.personaBoundAccounts).toHaveBeenCalledWith(PERSONA_ID);
    expect(store.updates).toHaveLength(1);
    expect(store.updates[0]).toMatchObject({
      status: 'failed',
      error: 'account yt-1 is not bound to persona persona-1: bind it to the persona or remove it from the schedule',
    });
    expect(store.getVideoUpload).not.toHaveBeenCalled();
    expect(eventNames(events)).toEqual(['video_publish_failed']);
    expect(deps.mailFailed).toHaveBeenCalledTimes(1);
  });

  it('removes the bytes a resumed slot claimed on its first attempt when the plan fails', async () => {
    const claimed = readyUpload({ status: 'consumed', consumed_at: '2026-11-27T11:00:00.000Z' });
    const { deps, store } = build(vi.fn<PublishFn>(), {
      getVideoUpload: vi.fn(async () => claimed),
      personaBoundAccounts: vi.fn(async () => ({})),
    });
    await publishSlot(deps, makeSlot({ resumed: true, mediaClaimedAt: '2026-11-27T11:00:00.000Z' }));
    expect(store.removeStorageObject).toHaveBeenCalledWith('videos', `${USER_ID}/${UPLOAD_ID}.mp4`);
  });

  it('keeps a foreign claim and removes nothing on a first attempt when the plan fails', async () => {
    const { deps, store } = build(vi.fn<PublishFn>(), { personaBoundAccounts: vi.fn(async () => ({})) });
    await publishSlot(deps, makeSlot());
    expect(store.removeStorageObject).not.toHaveBeenCalled();
  });

  it('fails a slot with an invalid plan, such as a blank description, once', async () => {
    const { deps, store } = build(vi.fn<PublishFn>());
    await publishSlot(deps, makeSlot({ description: '   ' }));
    expect(store.updates[0]).toMatchObject({ status: 'failed', error: 'slot has no video description: the agent must send one' });
  });

  it('leaves the slot for a quick retry when the binding read fails', async () => {
    const { deps, store, events } = build(vi.fn<PublishFn>(), {
      personaBoundAccounts: vi.fn(async () => {
        throw new Error('db down');
      }),
    });
    const published = await publishSlot(deps, makeSlot());
    expect(published).toBe(false);
    expect(store.updates).toEqual([{ publish_not_before: '2026-11-27T12:01:00.000Z' }]);
    expect(events).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith('[publisher] binding read failed, leaving the slot for the next tick', {
      slotId: SLOT_ID,
      reason: 'db down',
    });
  });

  it('skips the binding read and plan check for a slot without a persona', async () => {
    const slot = makeSlot({ schedule: makeSchedule({ personaId: null }) });
    const { deps, store } = build(publishedOk());
    expect(await publishSlot(deps, slot)).toBe(true);
    expect(store.personaBoundAccounts).not.toHaveBeenCalled();
  });

  it('fails a slot without uploaded media', async () => {
    const { deps, store } = build(vi.fn<PublishFn>());
    await publishSlot(deps, makeSlot({ mediaKind: null }));
    expect(store.updates.at(-1)).toMatchObject({ status: 'failed', error: 'slot has no uploaded media' });
    expect(store.downloadStorageObject).not.toHaveBeenCalled();
  });

  it('stops without publishing when the media cannot be resolved, leaving the lease in place', async () => {
    const publish = vi.fn<PublishFn>();
    const { deps, store } = build(publish, {
      downloadStorageObject: vi.fn(async () => {
        throw new Error('storage 503');
      }),
    });
    expect(await publishSlot(deps, makeSlot())).toBe(false);
    expect(publish).not.toHaveBeenCalled();
    expect(store.updates).toEqual([]);
    expect(store.claimVideoUpload).not.toHaveBeenCalled();
  });

  it('fails the slot once when the upload was already used', async () => {
    const { deps, store } = build(vi.fn<PublishFn>(), { claimVideoUpload: vi.fn(async () => null) });
    await publishSlot(deps, makeSlot());
    expect(store.updates.at(-1)).toMatchObject({ status: 'failed', error: 'scheduled video upload was already used' });
  });

  it('publishes an image slot from the uploads bucket and removes it afterwards', async () => {
    const ref = `scheduled-media/${USER_ID}/photo.jpg`;
    const slot = makeSlot({
      mediaKind: 'image',
      mediaRef: ref,
      schedule: makeSchedule({ providers: ['bluesky'], accountIds: { ...emptyAccountIds(), bluesky: ['bs-1'] } }),
    });
    const publish = vi.fn<PublishFn>(async () => completed([{ accountId: 'bs-1', success: true, postId: 'p' }]));
    const { deps, store } = build(publish, { personaBoundAccounts: vi.fn(async () => ({ bluesky: ['bs-1'] })) });
    expect(await publishSlot(deps, slot)).toBe(true);
    expect(store.downloadStorageObject).toHaveBeenCalledWith('uploads', ref);
    expect(store.removeStorageObject).toHaveBeenCalledWith('uploads', ref);
    expect(publish.mock.calls[0]![0].formData.get('video')).toBeInstanceOf(File);
  });

  it('sends the slot first comment through to the publish form', async () => {
    const publish = publishedOk();
    const { deps } = build(publish);
    await publishSlot(deps, makeSlot({ firstComment: 'Link in bio' }));
    expect(vi.mocked(publish).mock.calls[0]![0].formData.get('firstComment')).toBe('Link in bio');
  });

  it('defaults the title and the persona name in the alerts', async () => {
    const { deps } = build(publishedOk());
    await publishSlot(deps, makeSlot({ title: null, schedule: makeSchedule({ personaName: null }) }));
    expect(deps.discord).toHaveBeenCalledWith(expect.stringContaining('persona: Persona | title: Scheduled post'));
  });
});

describe('failSlotPermanently', () => {
  it('emits the failed event, scrubs the stored reason and mails the owner', async () => {
    const { deps, store, events } = build(vi.fn<PublishFn>());
    await failSlotPermanently(deps, makeSlot(), 'broke token=SECRET');
    expect(events).toEqual([['video_publish_failed', expect.objectContaining({ retryable: false, reason: 'broke token=[redacted]' })]]);
    expect(store.updates).toEqual([{ status: 'failed', error: 'broke token=[redacted]', publish_not_before: null }]);
    expect(deps.mailFailed).toHaveBeenCalledWith(expect.objectContaining({ reason: 'broke token=[redacted]', persona: 'Maya', failures: [] }));
  });

  it('skips the event for callers that already emitted it and stores the attempts and outcomes', async () => {
    const { deps, store, events } = build(vi.fn<PublishFn>());
    const outcome = { ...blankOutcome('youtube', 'yt-1', 'clip.mp4', 2), status: 'failed', error: 'nope' };
    await failSlotPermanently(deps, makeSlot(), 'done', { attempts: 2, emitFailedEvent: false, outcomes: [outcome] });
    expect(events).toEqual([]);
    expect(store.updates[0]).toMatchObject({ publish_attempts: 2, publish_outcomes: [expect.objectContaining({ accountId: 'yt-1' })] });
    expect(deps.mailFailed).toHaveBeenCalledWith(expect.objectContaining({ failures: [{ provider: 'youtube', accountId: 'yt-1', reason: 'nope' }] }));
  });

  it('never mails before the slot is stored as failed', async () => {
    const { deps } = build(vi.fn<PublishFn>(), {
      updateSlot: vi.fn(async () => {
        throw new Error('db down');
      }),
    });
    await expect(failSlotPermanently(deps, makeSlot(), 'x')).rejects.toThrow('db down');
    expect(deps.mailFailed).not.toHaveBeenCalled();
  });
});

describe('failedOutcomes', () => {
  it('keeps only failed outcomes and tolerates a missing list', () => {
    const failed = { ...blankOutcome('youtube', 'a', 'v', 1), status: 'failed', error: 'x' };
    const retrying = blankOutcome('youtube', 'b', 'v', 1);
    expect(failedOutcomes([failed, retrying])).toEqual([{ provider: 'youtube', accountId: 'a', reason: 'x' }]);
    expect(failedOutcomes(undefined)).toEqual([]);
    expect(failedOutcomes([{ ...failed, error: null }])[0]!.reason).toBe('');
  });
});
