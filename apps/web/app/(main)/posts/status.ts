import { Check, Clock, Loader, TriangleAlert } from 'lucide-react';
import type { TranslationKey } from '@/lib/i18n';

export const STATUS_STYLE: Record<string, string> = {
  ready: 'bg-warning-soft text-warning',
  publishing: 'bg-info-soft text-info',
  published: 'bg-success-soft text-success',
  failed: 'bg-destructive-soft text-destructive',
};

export const STATUS_KEY: Record<string, TranslationKey> = {
  ready: 'posts.statusReady',
  publishing: 'posts.statusPublishing',
  published: 'posts.statusPublished',
  failed: 'posts.statusFailed',
};

export type CalendarGroup = 'published' | 'failed' | 'inProgress' | 'scheduled';

export const CALENDAR_GROUP_ORDER: readonly CalendarGroup[] = ['failed', 'published', 'inProgress', 'scheduled'];

const IN_PROGRESS_STATUSES = new Set(['publishing']);

export function calendarGroupOf(status: string): CalendarGroup {
  if (status === 'published') return 'published';
  if (status === 'failed') return 'failed';
  if (IN_PROGRESS_STATUSES.has(status)) return 'inProgress';
  return 'scheduled';
}

export const CALENDAR_GROUP_PILL: Record<CalendarGroup, string> = {
  failed: 'bg-destructive-soft text-destructive',
  published: 'bg-success-soft text-success',
  inProgress: 'bg-info-soft text-info',
  scheduled: 'bg-line text-ink-soft',
};

export const CALENDAR_GROUP_DOT: Record<CalendarGroup, string> = {
  failed: 'bg-destructive',
  published: 'bg-success',
  inProgress: 'bg-info',
  scheduled: 'bg-muted-text',
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
  inProgress: Loader,
  scheduled: Clock,
};
