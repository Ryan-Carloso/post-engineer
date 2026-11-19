// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { NextResponse } from 'next/server';

import { resolvePublishAtSlot } from '../schedule-slot';

const ROUTE = 'POST /api/media/publish-existing';
const HOUR_MS = 60 * 60 * 1000;

async function errorOf(result: unknown): Promise<Record<string, unknown>> {
  expect(result).toBeInstanceOf(NextResponse);
  return (await (result as NextResponse).json()) as Record<string, unknown>;
}

describe('resolvePublishAtSlot', () => {
  it('places one slot at the instant, dropping seconds', () => {
    const at = new Date(Date.now() + 48 * HOUR_MS);
    at.setUTCSeconds(37, 250);
    const result = resolvePublishAtSlot(at.toISOString(), 'UTC', ROUTE);
    if (result instanceof NextResponse) throw new Error('expected a slot');
    const minute = new Date(at);
    minute.setUTCSeconds(0, 0);
    expect(result.slots).toEqual([{ slotAtISO: minute.toISOString(), dayIndex: 0, timeIndex: 0 }]);
    expect(result.time).toBe(minute.toISOString().slice(11, 16));
  });

  it('reads a naive publishAt as wall-clock in the timezone', () => {
    const at = new Date(Date.now() + 72 * HOUR_MS);
    const local = new Date(at.getTime() + 9 * HOUR_MS).toISOString().slice(0, 16);
    const result = resolvePublishAtSlot(local, 'Asia/Tokyo', ROUTE);
    if (result instanceof NextResponse) throw new Error('expected a slot');
    expect(result.slots[0]?.slotAtISO).toBe(new Date(`${local}:00+09:00`).toISOString());
    expect(result.time).toBe(local.slice(11, 16));
  });

  it('keeps an offset instant inside a DST fall-back hour on that exact instant', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-25T00:00:00Z'));
    try {
      const result = resolvePublishAtSlot('2026-11-01T06:30:00Z', 'America/New_York', ROUTE);
      if (result instanceof NextResponse) throw new Error('expected a slot');
      expect(result.slots[0]?.slotAtISO).toBe('2026-11-01T06:30:00.000Z');
      expect(result.time).toBe('01:30');
    } finally {
      vi.useRealTimers();
    }
  });

  it('answers 400 SCHEDULE_OUT_OF_RANGE inside the lead time', async () => {
    const body = await errorOf(resolvePublishAtSlot(new Date(Date.now() + HOUR_MS).toISOString(), 'UTC', ROUTE));
    expect(body).toMatchObject({ code: 'SCHEDULE_OUT_OF_RANGE', field: 'publishing.schedule.publishAt' });
  });

  it('answers 400 for an unknown timezone and for text that is not a datetime', async () => {
    const zone = await errorOf(resolvePublishAtSlot(new Date(Date.now() + 48 * HOUR_MS).toISOString(), 'Mars/Olympus', ROUTE));
    expect(zone).toMatchObject({ code: 'VALIDATION_FAILED', field: 'publishing.schedule.timezone' });
    const at = await errorOf(resolvePublishAtSlot('tomorrow evening', 'UTC', ROUTE));
    expect(at).toMatchObject({ code: 'VALIDATION_FAILED', field: 'publishing.schedule.publishAt' });
  });
});
