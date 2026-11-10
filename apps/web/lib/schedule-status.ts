import { HttpStatusError } from '@/lib/errors';
import type { PublishProviderFailure, PublishUserNotice } from '@/lib/publish-user-notice';

// Schedule-status shapes and fetcher, extracted from lib/api.ts so that
// file stays under the file-size ratchet. Import sites keep using
// `@/lib/api`, which re-exports everything here.

export interface ScheduledSlot {
  id: string;
  scheduleId: string;
  slotAt: string;
  status: 'awaiting' | 'generating' | 'ready' | 'publishing' | 'published' | 'failed';
  title: string | null;
  error?: string | null;
  publishedAt?: string | null;
  taskId?: string | null;
  progress: number;
  stage: string | null;
  queuePosition: number | null;
  queueTotal: number | null;
  retryable: boolean | null;
  userNotices?: PublishUserNotice[];
  providerFailures?: PublishProviderFailure[];
}

export interface SlotRow {
  id: string;
  schedule_id: string;
  slot_at: string;
  status: ScheduledSlot['status'];
  title: string | null;
  error?: string | null;
  published_at?: string | null;
  task_id?: string | null;
  progress?: number;
  stage?: string | null;
  queuePosition?: number | null;
  queueTotal?: number | null;
  retryable?: boolean | null;
  userNotices?: PublishUserNotice[];
  providerFailures?: PublishProviderFailure[];
}

interface ScheduleStatusPayload {
  success: boolean;
  upcoming?: SlotRow[];
  recent?: SlotRow[];
  // Whether the account has any post at all, in any month: the lists
  // cannot answer it (a stale past pending/ready slot is in neither).
  hasAnyPost?: boolean;
}

export function mapSlot(row: SlotRow): ScheduledSlot {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    slotAt: row.slot_at,
    status: row.status,
    title: row.title,
    error: row.error,
    publishedAt: row.published_at,
    taskId: row.task_id ?? null,
    progress: typeof row.progress === 'number' ? row.progress : 0,
    stage: typeof row.stage === 'string' ? row.stage : null,
    queuePosition: typeof row.queuePosition === 'number' ? row.queuePosition : null,
    queueTotal: typeof row.queueTotal === 'number' ? row.queueTotal : null,
    retryable: typeof row.retryable === 'boolean' ? row.retryable : null,
    userNotices: row.userNotices,
    providerFailures: row.providerFailures,
  };
}

export async function fetchScheduleStatus(limit?: number): Promise<{
  upcoming: ScheduledSlot[];
  recent: ScheduledSlot[];
  hasAnyPost: boolean;
}> {
  const url = typeof limit === 'number' ? `/api/schedule/status?limit=${limit}` : '/api/schedule/status';
  const response = await fetch(url);
  const data: ScheduleStatusPayload | null = await response.json().catch(() => null);
  if (!response.ok || !data?.success) throw new HttpStatusError('Failed to fetch schedule status', response.status);
  const upcoming = (data.upcoming ?? []).map(mapSlot);
  const recent = (data.recent ?? []).map(mapSlot);
  return {
    upcoming,
    recent,
    // The route answers "any post at all" directly; responses from before
    // the field existed fall back to the lists (which miss stale slots).
    hasAnyPost: data.hasAnyPost ?? (upcoming.length > 0 || recent.length > 0),
  };
}
