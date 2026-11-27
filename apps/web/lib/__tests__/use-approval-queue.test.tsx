import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ScheduledSlot } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  useScheduleStatusQuery: vi.fn(),
}));

import { useScheduleStatusQuery } from '@/lib/api';
import { useApprovalQueue } from '@/lib/approval-queue';

function slot(partial: Partial<ScheduledSlot> = {}): ScheduledSlot {
  return {
    id: 'slot-1',
    scheduleId: 's1',
    slotAt: '2030-06-01T10:00:00.000Z',
    status: 'awaiting_approval',
    title: 'Held video',
    ...partial,
  };
}

function statusResult(partial: {
  upcoming?: ScheduledSlot[];
  awaitingCount?: number;
} = {}) {
  return {
    data: {
      upcoming: partial.upcoming ?? [],
      recent: [],
      hasAnyPost: true,
      ...(partial.awaitingCount !== undefined ? { awaitingCount: partial.awaitingCount } : {}),
    },
    isLoading: false,
    isError: false,
  };
}

describe('useApprovalQueue count', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('counts every awaiting slot from the server count, not the capped list', () => {
    vi.mocked(useScheduleStatusQuery).mockReturnValue(
      statusResult({ upcoming: [slot()], awaitingCount: 5 }) as never,
    );

    const { result } = renderHook(() => useApprovalQueue());

    expect(result.current.slots).toHaveLength(1);
    expect(result.current.count).toBe(5);
  });

  it('falls back to the listed slots when the server sends no count', () => {
    vi.mocked(useScheduleStatusQuery).mockReturnValue(
      statusResult({ upcoming: [slot(), slot({ id: 'slot-2' })] }) as never,
    );

    const { result } = renderHook(() => useApprovalQueue());

    expect(result.current.count).toBe(2);
  });
});
