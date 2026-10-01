//---------------
// slot-distribution — the shared slot math used by the API route and the
// UI preview. Both must agree, so the contract is pinned here.
//---------------

import { describe, expect, it } from 'vitest';

import {
  SlotDistributionError,
  distributeSlots,
} from '../schedule/slot-distribution';

describe('distributeSlots', () => {
  it('places a single topic on the first slot', () => {
    const slots = distributeSlots({
      startAtISO: '2026-10-02T18:00:00+01:00',
      times: ['18:00'],
      timezone: 'Europe/Lisbon',
      count: 1,
    });
    expect(slots).toEqual([
      { slotAtISO: '2026-10-02T17:00:00.000Z', dayIndex: 0, timeIndex: 0 },
    ]);
  });

  it('distributes the spec example across days preserving topic order', () => {
    const slots = distributeSlots({
      startAtISO: '2026-10-02T18:00:00+01:00',
      times: ['18:00', '21:00'],
      timezone: 'Europe/Lisbon',
      count: 4,
    });
    expect(slots.map((s) => s.slotAtISO)).toEqual([
      '2026-10-02T17:00:00.000Z', // 02/10 18:00
      '2026-10-02T20:00:00.000Z', // 02/10 21:00
      '2026-10-03T17:00:00.000Z', // 03/10 18:00
      '2026-10-03T20:00:00.000Z', // 03/10 21:00
    ]);
    expect(slots.map((s) => s.dayIndex)).toEqual([0, 0, 1, 1]);
    expect(slots.map((s) => s.timeIndex)).toEqual([0, 1, 0, 1]);
  });

  it('spreads 10 topics over 4 days with 3 daily times', () => {
    const slots = distributeSlots({
      startAtISO: '2026-10-02T08:00:00+01:00',
      times: ['09:00', '13:00', '18:00'],
      timezone: 'Europe/Lisbon',
      count: 10,
    });
    expect(slots).toHaveLength(10);
    expect(slots.map((s) => s.dayIndex)).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 2, 3]);
    expect(slots.map((s) => s.timeIndex)).toEqual([0, 1, 2, 0, 1, 2, 0, 1, 2, 0]);
    // Strictly ascending instants.
    const instants = slots.map((s) => new Date(s.slotAtISO).getTime());
    for (let i = 1; i < instants.length; i += 1) {
      expect(instants[i]).toBeGreaterThan(instants[i - 1]);
    }
  });

  it('sorts unsorted times ascending', () => {
    const slots = distributeSlots({
      startAtISO: '2026-10-02T08:00:00+01:00',
      times: ['21:00', '18:00'],
      timezone: 'Europe/Lisbon',
      count: 2,
    });
    expect(slots.map((s) => s.slotAtISO)).toEqual([
      '2026-10-02T17:00:00.000Z',
      '2026-10-02T20:00:00.000Z',
    ]);
  });

  it('skips slots strictly before startAt and keeps iterating forward', () => {
    const slots = distributeSlots({
      startAtISO: '2026-10-02T20:00:00+01:00',
      times: ['18:00', '21:00'],
      timezone: 'Europe/Lisbon',
      count: 2,
    });
    // 02/10 18:00 is before startAt, so topic 1 takes 02/10 21:00 and
    // topic 2 moves to the next day — no shared slots.
    expect(slots).toEqual([
      { slotAtISO: '2026-10-02T20:00:00.000Z', dayIndex: 0, timeIndex: 1 },
      { slotAtISO: '2026-10-03T17:00:00.000Z', dayIndex: 1, timeIndex: 0 },
    ]);
  });

  it('dedupes identical times so topics never share a slot', () => {
    const slots = distributeSlots({
      startAtISO: '2026-10-02T08:00:00+01:00',
      times: ['18:00', '18:00'],
      timezone: 'Europe/Lisbon',
      count: 2,
    });
    expect(slots.map((s) => s.slotAtISO)).toEqual([
      '2026-10-02T17:00:00.000Z',
      '2026-10-03T17:00:00.000Z',
    ]);
  });

  it('crosses month boundaries', () => {
    const slots = distributeSlots({
      startAtISO: '2026-11-30T18:00:00+00:00',
      times: ['18:00'],
      timezone: 'Europe/Lisbon',
      count: 3,
    });
    expect(slots.map((s) => s.slotAtISO)).toEqual([
      '2026-11-30T18:00:00.000Z',
      '2026-12-01T18:00:00.000Z',
      '2026-12-02T18:00:00.000Z',
    ]);
  });

  it('keeps wall-clock times across the Europe/Lisbon DST transition', () => {
    // DST ends 2026-10-25: 18:00 local stays 18:00, the UTC instant shifts.
    const slots = distributeSlots({
      startAtISO: '2026-10-24T18:00:00+01:00',
      times: ['18:00'],
      timezone: 'Europe/Lisbon',
      count: 3,
    });
    expect(slots.map((s) => s.slotAtISO)).toEqual([
      '2026-10-24T17:00:00.000Z', // 18:00 WEST
      '2026-10-25T18:00:00.000Z', // 18:00 WET
      '2026-10-26T18:00:00.000Z', // 18:00 WET
    ]);
  });

  it('keeps wall-clock times across a DST transition (America/New_York)', () => {
    // DST ends 2026-11-01: 09:00 local stays 09:00, the UTC instant shifts.
    const slots = distributeSlots({
      startAtISO: '2026-10-31T08:00:00-04:00',
      times: ['09:00'],
      timezone: 'America/New_York',
      count: 3,
    });
    expect(slots.map((s) => s.slotAtISO)).toEqual([
      '2026-10-31T13:00:00.000Z', // 09:00 EDT
      '2026-11-01T14:00:00.000Z', // 09:00 EST
      '2026-11-02T14:00:00.000Z', // 09:00 EST
    ]);
  });

  it('rejects malformed times with the times field', () => {
    for (const times of [['25:00'], ['abc'], [''], ['9'], []]) {
      try {
        distributeSlots({
          startAtISO: '2026-10-02T18:00:00+01:00',
          times,
          timezone: 'Europe/Lisbon',
          count: 1,
        });
        expect.unreachable(`should throw for ${JSON.stringify(times)}`);
      } catch (error) {
        expect(error).toBeInstanceOf(SlotDistributionError);
        expect((error as SlotDistributionError).field).toBe('times');
      }
    }
  });

  it('rejects unknown timezones with the timezone field', () => {
    try {
      distributeSlots({
        startAtISO: '2026-10-02T18:00:00+01:00',
        times: ['18:00'],
        timezone: 'Not/AZone',
        count: 1,
      });
      expect.unreachable('should throw');
    } catch (error) {
      expect(error).toBeInstanceOf(SlotDistributionError);
      expect((error as SlotDistributionError).field).toBe('timezone');
    }
  });

  it('rejects invalid startAt and non-positive counts', () => {
    expect(() =>
      distributeSlots({
        startAtISO: 'not-a-date',
        times: ['18:00'],
        timezone: 'Europe/Lisbon',
        count: 1,
      }),
    ).toThrowError(SlotDistributionError);
    for (const count of [0, -2, 1.5]) {
      expect(() =>
        distributeSlots({
          startAtISO: '2026-10-02T18:00:00+01:00',
          times: ['18:00'],
          timezone: 'Europe/Lisbon',
          count,
        }),
      ).toThrowError(SlotDistributionError);
    }
  });
});
