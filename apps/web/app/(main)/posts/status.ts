import { Check, Clock, TriangleAlert } from 'lucide-react';
import type { TranslationKey } from '@/lib/i18n';

// Shared by the posts list and the post detail page. Colors are semantic
// tokens (see globals.css), so both light and dark themes stay readable.
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
  awaiting: 'posts.statusPending',
  generating: 'posts.statusGenerating',
  running: 'posts.statusRunning',
  ready: 'posts.statusReady',
  publishing: 'posts.statusPublishing',
  published: 'posts.statusPublished',
  completed: 'posts.statusCompleted',
  failed: 'posts.statusFailed',
};

// Grouping of the real slot and generation statuses. `STATUS_STYLE` stays
// the per-status badge; the group is what the post card icon encodes (so
// status never relies on color alone) and what shows the progress bar.
export type StatusGroup = 'inProgress' | 'published' | 'failed';

const GROUP_BY_STATUS: Record<string, StatusGroup> = {
  pending: 'inProgress',
  awaiting: 'inProgress',
  generating: 'inProgress',
  ready: 'inProgress',
  publishing: 'inProgress',
  published: 'published',
  completed: 'published',
  failed: 'failed',
};

export function statusGroupOf(status: string): StatusGroup {
  // An unknown status is still pending work, never silently "published".
  return GROUP_BY_STATUS[status] ?? 'inProgress';
}

export const GROUP_ICON: Record<StatusGroup, typeof Check> = { inProgress: Clock, published: Check, failed: TriangleAlert };

// Calendar groups — the calendar shows only outcomes (published / failed);
// anything not yet published is scheduled, with no status color of its own.
// Post cards and the detail page keep their per-status badges above.
export type CalendarGroup = 'published' | 'failed' | 'scheduled';

export const CALENDAR_GROUP_ORDER: readonly CalendarGroup[] = ['published', 'failed', 'scheduled'];

export function calendarGroupOf(status: string): CalendarGroup {
  if (status === 'published' || status === 'completed') return 'published';
  if (status === 'failed') return 'failed';
  // An unknown status is still unpublished work, never silently "published".
  return 'scheduled';
}

export const CALENDAR_GROUP_STYLE: Record<CalendarGroup, string> = {
  published: 'bg-success-soft text-success',
  failed: 'bg-destructive-soft text-destructive',
  scheduled: 'bg-sunken text-muted-text',
};

export const CALENDAR_GROUP_KEY: Record<CalendarGroup, TranslationKey> = {
  published: 'posts.groupPublished',
  failed: 'posts.groupFailed',
  scheduled: 'posts.groupScheduled',
};

export const CALENDAR_GROUP_ICON: Record<CalendarGroup, typeof Check> = {
  published: Check,
  failed: TriangleAlert,
  scheduled: Clock,
};
