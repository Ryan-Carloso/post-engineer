// @vitest-environment node
import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchReplay, refundRollbackSpend, trackApiEvent, loggerError } = vi.hoisted(() => ({
  fetchReplay: vi.fn(),
  refundRollbackSpend: vi.fn(),
  trackApiEvent: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('../replay', () => ({ fetchReplay }));
vi.mock('../rollback-refund', () => ({ refundRollbackSpend }));
vi.mock('@/lib/analytics', () => ({ trackApiEvent }));
vi.mock('@/lib/logger', () => ({
  logger: { error: loggerError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { answerSchedulePkRace } from '../pk-race';

const supabase = {} as never;

function input(alreadySpent: boolean): Parameters<typeof answerSchedulePkRace>[1] {
  return {
    userId: 'user-1',
    scheduleId: 'schedule-1',
    generationId: 'generation-1',
    perVideoCost: 3,
    alreadySpent,
    scheduleError: { code: '23505' },
    constraint: 'schedules_pkey',
    voiceFallbackWarning: null,
  };
}

describe('answerSchedulePkRace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refundRollbackSpend.mockResolvedValue(true);
  });

  it('refunds our redundant spend once and returns the winner replay', async () => {
    const replay = NextResponse.json({ replayed: true });
    fetchReplay.mockResolvedValue(replay);

    const result = await answerSchedulePkRace(supabase, input(false));

    expect(result).toBe(replay);
    expect(refundRollbackSpend).toHaveBeenCalledTimes(1);
    expect(refundRollbackSpend).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({ amount: 3, generationId: 'generation-1', reason: expect.stringMatching(/PK race/) }),
    );
  });

  it('does not refund when the spend was skipped (already spent)', async () => {
    const replay = NextResponse.json({ replayed: true });
    fetchReplay.mockResolvedValue(replay);

    const result = await answerSchedulePkRace(supabase, input(true));

    expect(result).toBe(replay);
    expect(refundRollbackSpend).toHaveBeenCalledTimes(0);
  });

  it('answers 500 without a second refund when the replay read fails', async () => {
    fetchReplay.mockResolvedValue(null);

    const result = await answerSchedulePkRace(supabase, input(false));

    expect(result.status).toBe(500);
    expect(refundRollbackSpend).toHaveBeenCalledTimes(1);
    expect(loggerError).toHaveBeenCalledWith(
      '[generate-and-schedule] PK race replay failed; no further refund',
      { code: '23505' },
      { scheduleId: 'schedule-1', userId: 'user-1' },
    );
  });

  it('answers 500 without any refund when already spent and the replay read fails', async () => {
    fetchReplay.mockResolvedValue(null);

    const result = await answerSchedulePkRace(supabase, input(true));

    expect(result.status).toBe(500);
    expect(refundRollbackSpend).toHaveBeenCalledTimes(0);
  });

  it('tracks the race as IDEMPOTENCY_CONFLICT', async () => {
    fetchReplay.mockResolvedValue(NextResponse.json({ replayed: true }));

    await answerSchedulePkRace(supabase, input(false));

    expect(trackApiEvent).toHaveBeenCalledWith(
      'video_creation_failed',
      expect.objectContaining({ errorCode: 'IDEMPOTENCY_CONFLICT', failureStage: 'schedule_insert_race' }),
    );
  });
});
