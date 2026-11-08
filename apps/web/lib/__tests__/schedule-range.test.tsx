// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';
import { fetchScheduleRange, RANGE_MAX_SLOTS } from '../schedule-range';

vi.mock('@/lib/supabase/client', () => ({ createSupabaseClient: () => ({ auth: { getSession: vi.fn() } }) }));

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchScheduleRange', () => {
  it('requests the range and maps rows to slots', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        success: true,
        truncated: true,
        slots: [{ id: 'a', schedule_id: 's1', slot_at: '2030-06-05T12:00:00Z', status: 'awaiting', title: 'T' }],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchScheduleRange('2030-06-01T03:00:00.000Z', '2030-07-01T03:00:00.000Z');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/schedule/status?from=2030-06-01T03%3A00%3A00.000Z&to=2030-07-01T03%3A00%3A00.000Z',
    );
    expect(result.truncated).toBe(true);
    expect(result.slots).toMatchObject([{ id: 'a', scheduleId: 's1', slotAt: '2030-06-05T12:00:00Z', status: 'awaiting' }]);
  });

  it.each([
    ['a non-2xx status', jsonResponse(500, { success: false })],
    ['success:false', jsonResponse(200, { success: false })],
    ['a body without slots', jsonResponse(200, { success: true })],
  ])('throws on %s', async (_name, response) => {
    vi.stubGlobal('fetch', vi.fn(async () => response));
    await expect(fetchScheduleRange('a', 'b')).rejects.toThrow('Failed to fetch schedule range');
  });

  it('throws on a non-JSON body (proxy HTML)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad'); } }) as unknown as Response));
    await expect(fetchScheduleRange('a', 'b')).rejects.toThrow('Failed to fetch schedule range');
  });
});

describe('RANGE_MAX_SLOTS sync', () => {
  it('matches the API route constant', () => {
    const root = findRepoRoot(import.meta.url);
    const source = readFileSync(join(root, 'apps/web/app/api/schedule/status/range.ts'), 'utf8');
    expect(source.includes(`export const RANGE_MAX_SLOTS = ${RANGE_MAX_SLOTS};`)).toBe(true);
  });
});
