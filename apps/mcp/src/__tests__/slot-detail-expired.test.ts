import { describe, expect, it } from 'vitest';
import { presentSlotDetail } from '../slot-detail-present.js';

describe('presentSlotDetail', () => {
  it('presents an expired slot as its own status', () => {
    const detail = {
      success: true as const,
      slot: {
        id: 'slot-1',
        scheduleId: 'sched-1',
        slotAt: '2026-11-01T10:00:00.000Z',
        status: 'expired',
        title: 'Post',
        error: null,
        publishedAt: null,
        publishLinks: [],
        userNotices: [],
        providerFailures: [],
        postUrl: null,
      },
      schedule: {
        id: 'sched-1',
        personaId: null,
        providers: [],
        youtubeAccountIds: [],
        instagramAccountIds: [],
        linkedinAccountIds: [],
        blueskyAccountIds: [],
        threadsAccountIds: [],
        facebookAccountIds: [],
        pinterestAccountIds: [],
        pinterestBoardId: null,
        threespeakAccountIds: [],
        rumbleAccountIds: [],
        fanvueAccountIds: [],
        telegramAccountIds: [],
        timezone: 'UTC',
        publishMode: 'scheduled' as const,
      },
      persona: null,
    };
    const presented = presentSlotDetail(detail as never);
    expect(presented.slot.status).toBe('expired');
    expect(presented.slot.publishedAt).toBeNull();
  });
});
