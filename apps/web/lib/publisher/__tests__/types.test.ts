import { describe, expect, it } from 'vitest';
import { attemptsOf, loadOutcomes, parseClaimedSlot } from '@/lib/publisher/types';

const SCHEDULE = {
  id: 'sch-1',
  user_id: 'user-1',
  persona_id: 'per-1',
  providers: ['youtube', 'threads'],
  youtube_account_ids: ['yt-1', ''],
  threads_account_ids: ['th-1'],
  pinterest_board_id: 'board',
  personas: { name: 'Maya', ai_label: true },
};

describe('parseClaimedSlot', () => {
  it('maps the claim row, its schedule accounts and persona', () => {
    const slot = parseClaimedSlot({
      id: 'slot-1',
      user_id: 'user-1',
      title: 'Porto',
      description: 'copy',
      first_comment: 'hi',
      media_kind: 'upload',
      media_ref: 'up-1',
      media_content_type: 'video/mp4',
      media_claimed_at: '2026-11-27T11:00:00+00:00',
      publish_attempts: 2,
      resumed: true,
      publish_outcomes: [{ provider: 'youtube', accountId: 'yt-1', video: 'v.mp4', status: 'published', attempts: 1 }],
      schedules: SCHEDULE,
    });
    expect(slot).toMatchObject({
      id: 'slot-1',
      userId: 'user-1',
      title: 'Porto',
      firstComment: 'hi',
      mediaKind: 'upload',
      attempts: 2,
      resumed: true,
    });
    expect(slot.schedule).toMatchObject({
      id: 'sch-1',
      personaId: 'per-1',
      providers: ['youtube', 'threads'],
      pinterestBoardId: 'board',
      personaName: 'Maya',
      aiLabel: true,
    });
    expect(slot.schedule.accountIds.youtube).toEqual(['yt-1']);
    expect(slot.schedule.accountIds.threads).toEqual(['th-1']);
    expect(slot.schedule.accountIds.fanvue).toEqual([]);
    expect(slot.outcomes).toHaveLength(1);
  });

  it('takes the owner from the schedule when the row has none', () => {
    expect(parseClaimedSlot({ id: 's', schedules: SCHEDULE }).userId).toBe('user-1');
  });

  it('tolerates a slot without a schedule or persona and blank optional values', () => {
    const slot = parseClaimedSlot({ id: 's', title: '', schedules: null, publish_outcomes: 'x' });
    expect(slot.userId).toBeNull();
    expect(slot.title).toBeNull();
    expect(slot.attempts).toBe(0);
    expect(slot.resumed).toBe(false);
    expect(slot.outcomes).toEqual([]);
    expect(slot.schedule).toMatchObject({ providers: [], personaId: null, personaName: null, aiLabel: false });
  });

  it('rejects a row without an id', () => {
    expect(() => parseClaimedSlot({})).toThrow('claim_next_publish_slot returned a row without an id');
    expect(() => parseClaimedSlot(null)).toThrow();
  });
});

describe('loadOutcomes', () => {
  it('keeps the persisted shape, defaulting what an older outcome lacks', () => {
    const [outcome] = loadOutcomes([
      { provider: 'youtube', accountId: 'a', video: 'v', status: 'failed', attempts: 2, code: 'x', requiresUser: true, notice: 'n', error: 'e', retryAt: 't', inProgressWaitSeconds: 60, videoUrl: 'u', permalink: 'p', postId: 'i', warnings: ['w', 3] },
      'junk',
    ]);
    expect(outcome).toEqual({
      provider: 'youtube',
      accountId: 'a',
      video: 'v',
      status: 'failed',
      attempts: 2,
      code: 'x',
      requiresUser: true,
      notice: 'n',
      error: 'e',
      retryAt: 't',
      inProgressWaitSeconds: 60,
      videoUrl: 'u',
      permalink: 'p',
      postId: 'i',
      warnings: ['w'],
    });
    expect(loadOutcomes([{}])[0]).toMatchObject({ provider: '', status: '', attempts: null, requiresUser: false });
    expect(loadOutcomes(undefined)).toEqual([]);
  });

  it('attemptsOf treats a missing count as zero', () => {
    expect(attemptsOf({ attempts: null })).toBe(0);
    expect(attemptsOf({ attempts: 2.9 })).toBe(2);
  });
});
