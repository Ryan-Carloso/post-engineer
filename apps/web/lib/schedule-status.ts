import { HttpStatusError } from '@/lib/errors';
import type { PublishProviderFailure, PublishUserNotice } from '@/lib/publish-user-notice';
import { narrowSlotMedia, type SlotMedia } from '@/lib/slot-detail';

export interface ScheduledSlot {
  id: string;
  scheduleId: string;
  slotAt: string;
  status: 'ready' | 'awaiting_approval' | 'publishing' | 'published' | 'failed' | 'expired' | 'cancelled';
  title: string | null;
  description?: string | null;
  media?: SlotMedia | null;
  error?: string | null;
  publishedAt?: string | null;
  userNotices?: PublishUserNotice[];
  providerFailures?: PublishProviderFailure[];
}

export interface SlotRow {
  id: string;
  schedule_id: string;
  slot_at: string;
  status: ScheduledSlot['status'];
  title: string | null;
  description?: string | null;
  media?: SlotMedia | null;
  error?: string | null;
  published_at?: string | null;
  userNotices?: PublishUserNotice[];
  providerFailures?: PublishProviderFailure[];
}

interface ScheduleStatusPayload {
  success: boolean;
  upcoming?: SlotRow[];
  recent?: SlotRow[];
  hasAnyPost?: boolean;
  awaitingCount?: number;
}

export function mapSlot(row: SlotRow): ScheduledSlot {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    slotAt: row.slot_at,
    status: row.status,
    title: row.title,
    description: row.description ?? null,
    media: narrowSlotMedia(row.media),
    error: row.error,
    publishedAt: row.published_at,
    userNotices: row.userNotices,
    providerFailures: row.providerFailures,
  };
}

export async function fetchScheduleStatus(limit?: number): Promise<{
  upcoming: ScheduledSlot[];
  recent: ScheduledSlot[];
  hasAnyPost: boolean;
  awaitingCount?: number;
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
    hasAnyPost: data.hasAnyPost ?? (upcoming.length > 0 || recent.length > 0),
    awaitingCount: data.awaitingCount,
  };
}
