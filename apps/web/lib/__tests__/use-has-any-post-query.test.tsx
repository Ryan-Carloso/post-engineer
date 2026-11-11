import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

//---------------
// Tests for useHasAnyPostQuery (lib/schedule-range): the hook behind the
// calendar's "no posts this month" vs "no posts yet" distinction. It reads
// the route's hasAnyPost field, which the lists alone cannot answer.
//---------------

vi.mock('@/lib/api', () => ({
  fetchScheduleStatus: vi.fn(),
  mapSlot: vi.fn((row: unknown) => row),
}));

import { fetchScheduleStatus } from '@/lib/api';
import { useHasAnyPostQuery } from '../schedule-range';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useHasAnyPostQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when the route reports any post', async () => {
    vi.mocked(fetchScheduleStatus).mockResolvedValue({ upcoming: [], recent: [], hasAnyPost: true });
    const { result } = renderHook(() => useHasAnyPostQuery(true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(true);
    expect(fetchScheduleStatus).toHaveBeenCalledWith(1);
  });

  it('returns false when the route reports no post', async () => {
    vi.mocked(fetchScheduleStatus).mockResolvedValue({ upcoming: [], recent: [], hasAnyPost: false });
    const { result } = renderHook(() => useHasAnyPostQuery(true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(false);
  });

  it('does not fetch while disabled', () => {
    vi.mocked(fetchScheduleStatus).mockResolvedValue({ upcoming: [], recent: [], hasAnyPost: true });
    const { result } = renderHook(() => useHasAnyPostQuery(false), { wrapper });
    expect(result.current.isPending).toBe(true);
    expect(fetchScheduleStatus).not.toHaveBeenCalled();
  });
});
