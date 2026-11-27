import type { ScheduledSlot } from '@/lib/api';
import type { DetailedCalendarEvent, EventColor } from '@/components/calendar-types';
import { calendarGroupOf, type CalendarGroup } from './status';

const CALENDAR_GROUP_EVENT_COLOR: Record<CalendarGroup, EventColor> = {
  failed: 'red',
  published: 'green',
  inProgress: 'blue',
  scheduled: 'gray',
  expired: 'gray',
  paused: 'gray',
};

export type AdapterSlot = Pick<ScheduledSlot, 'id' | 'scheduleId' | 'slotAt' | 'title'> & { status: string };

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

export function slotsToCalendarEvents(slots: AdapterSlot[], titleFallback: string): DetailedCalendarEvent[] {
  return slots.map((slot) => slotToCalendarEvent(slot, titleFallback));
}
