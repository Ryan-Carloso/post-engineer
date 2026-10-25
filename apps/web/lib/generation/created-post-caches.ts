//---------------
// created-post-caches — cache seeding for freshly created posts.
//
// Extracted from lib/api.ts so the route's response contract additions
// (issue #277 warnings) fit the file-size ratchet: this module imports only
// TYPES from '@/lib/api', so there is no runtime import cycle.
//---------------

import type { QueryClient } from '@tanstack/react-query';
import type { CreatePostInput, CreatePostResult, ScheduledSlot, ScheduleConfig } from '@/lib/api';

//---------------
// seedCreatedPostCaches — write the mutation response straight into the
// list caches so the new post is visible the instant the user lands back
// on /posts. Seeded slots merge into `upcoming` (deduped by id, sorted
// by slot time); progress starts at 0 and the next poll fills live values.
//---------------
export function seedCreatedPostCaches(
  queryClient: QueryClient,
  input: CreatePostInput,
  result: CreatePostResult,
): void {
  const scheduleId = result.scheduleId;
  if (scheduleId === null || result.slots.length === 0) return;

  // Sort by slot time first: the queue position is the chronological
  // position among the created slots.
  const ordered = [...result.slots].sort((a, b) => (a.slotAt < b.slotAt ? -1 : a.slotAt > b.slotAt ? 1 : 0));
  const seededSlots: ScheduledSlot[] = ordered.map((slot, index) => ({
    id: slot.slotId,
    scheduleId,
    slotAt: slot.slotAt,
    // The API presents the DB 'pending' state as 'awaiting' (see
    // presentStatus in lib/schedule-slot-presentation.ts).
    status: (slot.status === 'pending' ? 'awaiting' : slot.status) as ScheduledSlot['status'],
    topic: slot.topic,
    error: null,
    publishedAt: null,
    taskId: slot.taskId,
    progress: 0,
    stage: null,
    // Queue position is local to this created batch (ordered by slot time);
    // the next poll overwrites it with the true engine queue position.
    queuePosition: index + 1,
    queueTotal: ordered.length,
    retryable: null,
  }));

  const seededSchedule: ScheduleConfig = {
    id: scheduleId,
    personaId: input.personaId ?? null,
    providers: input.providers,
    youtubeAccountIds: input.accounts.youtube ?? [],
    instagramAccountIds: input.accounts.instagram ?? [],
    linkedinAccountIds: input.accounts.linkedin ?? [],
    blueskyAccountIds: input.accounts.bluesky ?? [],
    daysOfWeek: [],
    startHour: null,
    endHour: null,
    postsPerDay: result.slots.length,
    timezone: input.timezone ?? 'UTC',
    active: true,
    publishMode: input.mode ?? 'scheduled',
  };

  const statusCaches = queryClient.getQueriesData<{ upcoming: ScheduledSlot[]; recent: ScheduledSlot[] }>({
    queryKey: ['fill-schedule-status'],
  });
  for (const [key, data] of statusCaches) {
    if (!data) continue;
    const knownIds = new Set(data.upcoming.map((slot) => slot.id));
    const merged = [...data.upcoming, ...seededSlots.filter((slot) => !knownIds.has(slot.id))].sort((a, b) =>
      a.slotAt < b.slotAt ? -1 : a.slotAt > b.slotAt ? 1 : 0,
    );
    queryClient.setQueryData(key, { ...data, upcoming: merged });
  }

  const schedules = queryClient.getQueryData<ScheduleConfig[]>(['fill-schedules']) ?? [];
  if (!schedules.some((schedule) => schedule.id === scheduleId)) {
    queryClient.setQueryData(['fill-schedules'], [...schedules, seededSchedule]);
  }
}

