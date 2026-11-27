import { CalendarX2, Check, Clock, Loader, Pause, TriangleAlert } from 'lucide-react';
import type { TranslationKey } from '@/lib/i18n';

export const STATUS_STYLE: Record<string, string> = {
  ready: 'bg-warning-soft text-warning',
  awaiting_approval: 'bg-warning-soft text-warning',
  publishing: 'bg-info-soft text-info',
  published: 'bg-success-soft text-success',
  failed: 'bg-destructive-soft text-destructive',
  expired: 'bg-line text-muted-foreground',
  paused: 'bg-sunken text-ink-soft',
  cancelled: 'bg-line text-ink-soft',
};

export const STATUS_KEY: Record<string, TranslationKey> = {
  ready: 'posts.statusReady',
  awaiting_approval: 'posts.statusAwaitingApproval',
  publishing: 'posts.statusPublishing',
  published: 'posts.statusPublished',
  failed: 'posts.statusFailed',
  expired: 'posts.statusExpired',
  paused: 'posts.statusPaused',
  cancelled: 'posts.statusCancelled',
};

export type DisplayStatus = 'ready' | 'awaiting_approval' | 'publishing' | 'published' | 'failed' | 'expired' | 'cancelled' | 'paused';

export function slotDisplayStatus(status: string, hasAccess: boolean): string {
  if (!hasAccess && (status === 'ready' || status === 'publishing')) return 'paused';
  return status;
}

export type CalendarGroup = 'published' | 'failed' | 'expired' | 'paused' | 'inProgress' | 'scheduled';

export const CALENDAR_GROUP_ORDER: readonly CalendarGroup[] = ['failed', 'expired', 'published', 'inProgress', 'paused', 'scheduled'];

const IN_PROGRESS_STATUSES = new Set(['publishing']);

export function calendarGroupOf(status: string): CalendarGroup {
  if (status === 'published') return 'published';
  if (status === 'failed') return 'failed';
  if (status === 'expired') return 'expired';
  if (status === 'paused') return 'paused';
  if (IN_PROGRESS_STATUSES.has(status)) return 'inProgress';
  return 'scheduled';
}

export const CALENDAR_GROUP_PILL: Record<CalendarGroup, string> = {
  failed: 'bg-destructive-soft text-destructive',
  published: 'bg-success-soft text-success',
  inProgress: 'bg-info-soft text-info',
  scheduled: 'bg-line text-ink-soft',
  expired: 'bg-line text-muted-foreground',
  paused: 'bg-sunken text-ink-soft',
};

export const CALENDAR_GROUP_DOT: Record<CalendarGroup, string> = {
  failed: 'bg-destructive',
  published: 'bg-success',
  inProgress: 'bg-info',
  scheduled: 'bg-muted-text',
  expired: 'bg-muted-foreground',
  paused: 'bg-ink-soft',
};

export const CALENDAR_GROUP_KEY: Record<CalendarGroup, TranslationKey> = {
  published: 'posts.groupPublished',
  failed: 'posts.groupFailed',
  inProgress: 'posts.groupInProgress',
  scheduled: 'posts.groupScheduled',
  expired: 'posts.groupExpired',
  paused: 'posts.groupPaused',
};

export const CALENDAR_GROUP_ICON: Record<CalendarGroup, typeof Check> = {
  published: Check,
  failed: TriangleAlert,
  inProgress: Loader,
  scheduled: Clock,
  expired: CalendarX2,
  paused: Pause,
};
