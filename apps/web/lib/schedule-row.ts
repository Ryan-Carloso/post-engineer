import type { ScheduleConfig } from '@/lib/api';

//---------------
// schedule-row — the /api/schedule row shape and its client mapping.
//---------------

export interface ScheduleRow {
  id: string;
  /** Null for a schedule created without a persona (migration 012). */
  persona_id: string | null;
  providers: string[];
  youtube_account_ids: string[];
  instagram_account_ids: string[];
  linkedin_account_ids: string[];
  bluesky_account_ids: string[];
  threads_account_ids: string[];
  facebook_account_ids: string[];
  pinterest_account_ids: string[];
  /** The board a schedule's Pinterest pins go to (migration 050). */
  pinterest_board_id: string | null;
  threespeak_account_ids: string[];
  days_of_week: number[] | null;
  start_hour: number | null;
  end_hour: number | null;
  posts_per_day: number;
  timezone: string;
  active: boolean;
  /** Migration 015. Read defensively: only the literal 'asap' counts. */
  publish_mode: string | null;
}

export function mapSchedule(row: ScheduleRow): ScheduleConfig {
  return {
    id: row.id,
    personaId: row.persona_id,
    providers: row.providers,
    youtubeAccountIds: row.youtube_account_ids ?? [],
    instagramAccountIds: row.instagram_account_ids ?? [],
    linkedinAccountIds: row.linkedin_account_ids ?? [],
    blueskyAccountIds: row.bluesky_account_ids ?? [],
    threadsAccountIds: row.threads_account_ids ?? [],
    facebookAccountIds: row.facebook_account_ids ?? [],
    pinterestAccountIds: row.pinterest_account_ids ?? [],
    pinterestBoardId: row.pinterest_board_id ?? null,
    threespeakAccountIds: row.threespeak_account_ids ?? [],
    daysOfWeek: row.days_of_week ?? [],
    startHour: row.start_hour ?? null,
    endHour: row.end_hour ?? null,
    postsPerDay: row.posts_per_day,
    timezone: row.timezone,
    active: row.active,
    publishMode: row.publish_mode === 'asap' ? 'asap' : 'scheduled',
  };
}
