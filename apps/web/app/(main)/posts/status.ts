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
// the per-status badge; the group is what a calendar cell counts and what
// the icon encodes (so status never relies on color alone).
export type StatusGroup = 'inProgress' | 'published' | 'failed';

export const STATUS_GROUP_ORDER: readonly StatusGroup[] = ['inProgress', 'published', 'failed'];

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

export const GROUP_STYLE: Record<StatusGroup, string> = {
  inProgress: 'bg-info-soft text-info',
  published: 'bg-success-soft text-success',
  failed: 'bg-destructive-soft text-destructive',
};

export const GROUP_KEY: Record<StatusGroup, TranslationKey> = {
  inProgress: 'posts.groupInProgress',
  published: 'posts.groupPublished',
  failed: 'posts.groupFailed',
};
