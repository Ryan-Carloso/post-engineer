import { describe, expect, it } from 'vitest';
import { slotToCalendarEvent, slotsToCalendarEvents } from '../calendar-adapter';
import type { ScheduledSlot } from '@/lib/api';

// The adapter takes the slot fields it reads, with a plain string status:
// stored slots also carry legacy statuses (pending, completed, running)
// the API type does not list, and the calendar group handles them.
type AdapterSlot = Pick<ScheduledSlot, 'id' | 'scheduleId' | 'slotAt' | 'title'> & { status: string };

function slot(overrides: Partial<AdapterSlot> = {}): AdapterSlot {
  return {
    id: 'slot-1',
    scheduleId: 'schedule-1',
    slotAt: '2030-06-01T10:00:00.000Z',
    status: 'awaiting',
    title: 'Morning topic',
    ...overrides,
  };
}

describe('slotToCalendarEvent', () => {
  it('maps the slot id, title, schedule and instant', () => {
    const event = slotToCalendarEvent(slot(), 'Unknown title');
    expect(event.id).toBe('slot-1');
    expect(event.title).toBe('Morning topic');
    expect(event.calendarId).toBe('schedule-1');
    expect(event.start.getTime()).toBe(Date.parse('2030-06-01T10:00:00.000Z'));
    expect(event.end.getTime()).toBe(Date.parse('2030-06-01T10:00:00.000Z'));
  });

  it('keeps the exact instant, never re-bucketed to a wall clock', () => {
    const event = slotToCalendarEvent(slot({ slotAt: '2030-06-01T02:30:00.000Z' }), 'Unknown title');
    expect(event.start.getTime()).toBe(Date.parse('2030-06-01T02:30:00.000Z'));
    expect(event.end).toEqual(event.start);
  });

  it('falls back to the caller text when the slot has no title', () => {
    expect(slotToCalendarEvent(slot({ title: null }), 'Unknown title').title).toBe('Unknown title');
  });

  it.each([
    ['failed', 'red'],
    ['published', 'green'],
    ['completed', 'green'],
    ['generating', 'blue'],
    ['publishing', 'blue'],
    ['running', 'blue'],
    ['awaiting', 'gray'],
    ['pending', 'gray'],
    ['ready', 'gray'],
    ['unknown-status', 'gray'],
  ] as const)('paints a %s slot %s', (status, color) => {
    expect(slotToCalendarEvent(slot({ status }), 'Unknown title').color).toBe(color);
  });
});

describe('slotsToCalendarEvents', () => {
  it('maps every slot in order and none for an empty month', () => {
    const events = slotsToCalendarEvents(
      [slot({ id: 'a', slotAt: '2030-06-01T10:00:00.000Z' }), slot({ id: 'b', slotAt: '2030-06-02T10:00:00.000Z' })],
      'Unknown title',
    );
    expect(events.map((event) => event.id)).toEqual(['a', 'b']);
    expect(slotsToCalendarEvents([], 'Unknown title')).toEqual([]);
  });
});
