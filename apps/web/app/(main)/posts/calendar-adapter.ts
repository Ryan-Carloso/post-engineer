import type { ScheduledSlot } from '@/lib/api';
import type { DetailedCalendarEvent, EventColor } from '@/components/calendar-types';
import { calendarGroupOf, type CalendarGroup } from './status';

// A scheduled post as a CalendarCN event.
//
// The chip color is the post's calendar group (status.ts) mapped to the
// lib's seven event colors — the same vocabulary the day list's pills use,
// so a post never reads one way on the grid and another on its card.
// Scheduled is gray: a waiting time, not an event.
export const CALENDAR_GROUP_EVENT_COLOR: Record<CalendarGroup, EventColor> = {
  failed: 'red',
  published: 'green',
  inProgress: 'blue',
  scheduled: 'gray',
};

// The slot fields the adapter reads. The status stays a plain string:
// stored slots also carry legacy statuses (pending, completed, running)
// the API type does not list, and calendarGroupOf handles them.
export type AdapterSlot = Pick<ScheduledSlot, 'id' | 'scheduleId' | 'slotAt' | 'title'> & { status: string };

// A slot has no duration: the event starts and ends at its slot time, so
// month view draws it as a timed chip with its time and title. The title
// falls back to the caller's text when the slot has none, like the day
// list's PostRow. The instant is kept as-is: the lib draws it on the
// viewer's day, and the page's bucketByDay does the same for the list.
export function slotToCalendarEvent(slot: AdapterSlot, titleFallback: string): DetailedCalendarEvent {
  const at = new Date(slot.slotAt);
  return {
    id: slot.id,
    title: slot.title ?? titleFallback,
    start: at,
    end: at,
    color: CALENDAR_GROUP_EVENT_COLOR[calendarGroupOf(slot.status)],
    calendarId: slot.scheduleId,
  };
}

// Every slot as an event, in slot order.
export function slotsToCalendarEvents(slots: AdapterSlot[], titleFallback: string): DetailedCalendarEvent[] {
  return slots.map((slot) => slotToCalendarEvent(slot, titleFallback));
}
