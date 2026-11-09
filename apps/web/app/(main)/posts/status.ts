import { Check, Clock, LoaderCircle, TriangleAlert } from 'lucide-react';
import type { TranslationKey } from '@/lib/i18n';

// Per-status badges of the post detail page and the video generation cards
// (post cards use the calendar groups below). Colors are semantic tokens
// (see globals.css), so both light and dark themes stay readable.
// `awaiting` is what the API reports for a DB `pending` slot.
export const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-sunken text-muted-text',
  awaiting: 'bg-sunken text-muted-text',
  generating: 'bg-info-soft text-info',
  running: 'bg-info-soft text-info',
  ready: 'bg-warning-soft text-warning',
  publishing: 'bg-info-soft text-info',
  published: 'bg-success-soft text-success',
  completed: 'bg-success-soft text-success',
  failed: 'bg-destructive-soft text-destructive',
};

export const STATUS_KEY: Record<string, TranslationKey> = {
  pending: 'posts.statusPending',
  // An awaiting slot is a scheduled post whose work has not started: it
  // carries the calendar's own word (legend, day summary), so the card and
  // the calendar never name the same post differently.
  awaiting: 'posts.groupScheduled',
  generating: 'posts.statusGenerating',
  running: 'posts.statusRunning',
  ready: 'posts.statusReady',
  publishing: 'posts.statusPublishing',
  published: 'posts.statusPublished',
  completed: 'posts.statusCompleted',
  failed: 'posts.statusFailed',
};

// Calendar groups — ONE vocabulary for a post's state, shared by the day
// cell markers, the legend, the day summary and the post card pill, so a
// post is never named one way on the card and another on the calendar.
// In progress = work running right now (the video is generating or being
// published); scheduled = waiting for its time (not started yet, or its
// video is ready and waits for the publish slot). The card adds the exact
// stage (e.g. "Generating video 45%") under the pill.
export type CalendarGroup = 'published' | 'failed' | 'inProgress' | 'scheduled';

// Failure first: day markers, the legend, the day summary and the day's
// accessible name all list a failure before anything else.
export const CALENDAR_GROUP_ORDER: readonly CalendarGroup[] = ['failed', 'published', 'inProgress', 'scheduled'];

const IN_PROGRESS_STATUSES = new Set(['generating', 'publishing', 'running']);

export function calendarGroupOf(status: string): CalendarGroup {
  if (status === 'published' || status === 'completed') return 'published';
  if (status === 'failed') return 'failed';
  if (IN_PROGRESS_STATUSES.has(status)) return 'inProgress';
  // An unknown status is still unpublished work, never silently "published".
  return 'scheduled';
}

// The status marker in a day cell and in the legend. Solid fills so the
// icon stays readable without the legend; the cell itself is not painted.
// `text-on-ink` flips with the theme, so a light chip in dark mode keeps
// dark text and a dark chip in light mode keeps light text.
export const CALENDAR_GROUP_MARKER: Record<CalendarGroup, string> = {
  failed: 'bg-destructive text-destructive-foreground',
  published: 'bg-success text-on-ink',
  inProgress: 'bg-brand text-on-ink',
  scheduled: 'bg-ink-soft text-on-ink',
};

// The post card pill: the same hue as the marker, as a soft tint (a solid
// chip on every card would shout over the title).
export const CALENDAR_GROUP_PILL: Record<CalendarGroup, string> = {
  failed: 'bg-destructive-soft text-destructive',
  published: 'bg-success-soft text-success',
  inProgress: 'bg-info-soft text-info',
  scheduled: 'bg-line text-ink-soft',
};

export const CALENDAR_GROUP_KEY: Record<CalendarGroup, TranslationKey> = {
  published: 'posts.groupPublished',
  failed: 'posts.groupFailed',
  inProgress: 'posts.groupInProgress',
  scheduled: 'posts.groupScheduled',
};

export const CALENDAR_GROUP_ICON: Record<CalendarGroup, typeof Check> = {
  published: Check,
  failed: TriangleAlert,
  inProgress: LoaderCircle,
  scheduled: Clock,
};
