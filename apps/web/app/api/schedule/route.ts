import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { isPersonaAllowed } from '@/lib/api-keys';
import { apiErrorResponse } from '@/lib/api-error';

//---------------
// /api/schedule — CRUD (GET/PATCH/DELETE) for video publishing timetables.
// One schedule per persona (schedules_persona_owner constraint). Schedules
// are created by POST /api/videos/generate-and-schedule (1-10 topics, each
// becoming a video + slot + task); the engine (fill-schedule-scheduler
// thread, starts with the app) reads these tables via the service role and
// does the rest: video generation per slot, then publishing at each slot's
// time via /api/upload-content.
//---------------

const VALID_PROVIDERS = ['youtube', 'instagram', 'linkedin', 'bluesky'] as const;
export const VALID_SCHEDULE_PROVIDERS = VALID_PROVIDERS;

interface ScheduleRequestBody {
  active?: unknown;
  providers?: unknown;
  youtubeAccountIds?: unknown;
  instagramAccountIds?: unknown;
  linkedinAccountIds?: unknown;
  blueskyAccountIds?: unknown;
  daysOfWeek?: unknown;
  startHour?: unknown;
  endHour?: unknown;
  postsPerDay?: unknown;
  times?: unknown;
  timezone?: unknown;
}

function errorResponse(
  status: number,
  error: string,
  route: string,
  extra?: Record<string, unknown>,
  options?: { cause?: unknown; logMessage?: string; metadata?: Record<string, unknown> },
): NextResponse {
  return apiErrorResponse(status, error, { route, extra, ...options });
}

//---------------
// assertScheduleScope — resolves the persona that owns a schedule and
// rejects access outside a persona-scoped API key's allowed personas.
// Returns an error response when the caller must stop (404 unknown,
// 403 out of scope), or null when the caller may proceed.
//---------------
async function assertScheduleScope(
  supabase: SupabaseClient,
  personaScope: readonly string[] | null | undefined,
  scheduleId: string,
  userId: string,
  method: string,
): Promise<NextResponse | null> {
  const { data, error } = await supabase
    .from('schedules')
    .select('persona_id')
    .eq('id', scheduleId)
    .eq('user_id', userId)
    .single();
  if (error && error.code !== 'PGRST116') {
    return errorResponse(500, 'Failed to fetch schedule.', `${method} /api/schedule`, undefined, {
      cause: error,
    });
  }
  if (!data) return errorResponse(404, 'Schedule not found.', `${method} /api/schedule`);
  if (!isPersonaAllowed(personaScope, data.persona_id)) {
    return errorResponse(403, 'This API key does not have access to this schedule.', `${method} /api/schedule`);
  }
  return null;
}

//---------------
// parseDaysOfWeek — validates and normalizes to a unique int[], 0 (Sunday) to 6.
//---------------
export function parseDaysOfWeek(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const days = new Set<number>();
  for (const item of value) {
    const day = typeof item === 'number' ? Math.floor(item) : Number.NaN;
    if (!Number.isInteger(day) || day < 0 || day > 6) return null;
    days.add(day);
  }
  return [...days].sort((a, b) => a - b);
}

export function parseHour(value: unknown): number | null {
  const hour = typeof value === 'number' ? Math.floor(value) : Number.NaN;
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null;
}

export function parseAccountIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((item) => item.trim()))];
}

type ScheduleSupabaseClient =
  | Awaited<ReturnType<typeof createSupabaseServerClient>>
  | ReturnType<typeof createSupabaseServiceClient>;

//---------------
// ACCOUNT_ID_HINTS — per-provider pointer to the list_social_accounts field
// that callers must use. That endpoint returns both `recordId` (internal row
// id) and the provider's real account id; callers (especially agents) mix
// them up, so the ownership 400 below names the right field explicitly.
//---------------
const ACCOUNT_ID_HINTS: Record<(typeof VALID_PROVIDERS)[number], string> = {
  youtube: 'the channelId field from list_social_accounts, not recordId',
  instagram: 'the igUserId field from list_social_accounts, not recordId',
  linkedin: 'the providerAccountId field from list_social_accounts, not recordId',
  bluesky: 'Bluesky DIDs (the did field from list_social_accounts), not recordIds',
};

//---------------
// assertAccountsOwned — an account selection may only reference accounts
// registered to the caller. Queries social_accounts per provider and requires
// an exact match between the requested ids and the user's own ones. Returns
// an actionable error message, or null when every selection is owned.
// Used by PATCH (merged final selection), so a PATCH cannot point a
// schedule at another user's account.
//---------------
export async function assertAccountsOwned(
  supabase: ScheduleSupabaseClient,
  userId: string,
  selections: ReadonlyArray<{ provider: (typeof VALID_PROVIDERS)[number]; ids: readonly string[] }>,
): Promise<string | null> {
  for (const { provider, ids } of selections) {
    if (ids.length === 0) continue;
    const { data: accounts, error } = await supabase
      .from('social_accounts')
      .select('provider_account_id')
      .eq('user_id', userId)
      .eq('provider', provider)
      .in('provider_account_id', [...ids]);
    const foundIds = (accounts ?? []).map((account) => account.provider_account_id).sort();
    const requestedIds = [...ids].sort();
    if (error || foundIds.length !== requestedIds.length || foundIds.some((id, index) => id !== requestedIds[index])) {
      return `Invalid ${provider} account selection — expected ${ACCOUNT_ID_HINTS[provider]}.`;
    }
  }
  return null;
}

//---------------
// SlotTime — one entry of the `times` array:
// - { kind: 'time', time } — a wall-clock "HH:MM" publishing time, read in
//   the request timezone;
// - { kind: 'datetime', at } — a full ISO datetime, so a single request can
//   batch videos across several different days. Naive wall clocks are read
//   in the request timezone; an explicit offset (Z or ±hh:mm) is respected
//   as-is.
//---------------
export type SlotTime = { kind: 'time'; time: string } | { kind: 'datetime'; at: string };

//---------------
// parseTimes — validates and normalizes the `times` array. Each entry is
// either "HH:MM" (00:00–23:59) or a full ISO datetime with a time part
// ("2026-10-02T15:00", "2026-10-02T15:00:00+01:00"); a bare date is
// rejected as ambiguous. Entries are unique. Pure "HH:MM" arrays keep the
// legacy chronological sort; arrays with explicit datetimes keep input
// order so topics stay paired with the day the caller sent. Empty/absent
// array → []. Returns null when any item is invalid.
//---------------
export function parseTimes(value: unknown): SlotTime[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const out: SlotTime[] = [];
  const seen = new Set<string>();
  let hasDatetime = false;
  for (const item of value) {
    if (typeof item !== 'string') return null;
    const text = item.trim();
    const hm = /^(\d{1,2}):(\d{2})$/.exec(text);
    if (hm) {
      const hour = Number.parseInt(hm[1], 10);
      const minute = Number.parseInt(hm[2], 10);
      if (hour > 23 || minute > 59) return null;
      const norm = `${String(hour).padStart(2, '0')}:${hm[2]}`;
      const key = `t:${norm}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ kind: 'time', time: norm });
      }
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:?\d{2})?$/.test(text)) return null;
    hasDatetime = true;
    const key = `d:${text}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ kind: 'datetime', at: text });
    }
  }
  if (!hasDatetime) {
    out.sort((a, b) => (a.kind === 'time' && b.kind === 'time' ? a.time.localeCompare(b.time) : 0));
  }
  return out;
}

//---------------
// slotTimeToString — the string persisted on the schedules row for a
// SlotTime ("HH:MM" stays as-is; datetimes keep the caller's input).
//---------------
export function slotTimeToString(t: SlotTime): string {
  return t.kind === 'time' ? t.time : t.at;
}

export async function GET(request?: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const user = { id: auth.userId };
  const supabase = auth.isApiKey === true
    ? createSupabaseServiceClient()
    : await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('schedules')
    .select('id, persona_id, providers, youtube_account_ids, instagram_account_ids, linkedin_account_ids, bluesky_account_ids, days_of_week, start_hour, end_hour, posts_per_day, timezone, active, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });

  if (error) {
    return errorResponse(500, 'Failed to list schedules.', 'GET /api/schedule', undefined, {
      cause: error,
    });
  }

  // Persona-scoped API keys may only see schedules of their own personas.
  // Browser sessions and unrestricted keys (personaIds null/undefined)
  // keep the full list.
  const schedules = (data ?? []).filter((schedule) =>
    isPersonaAllowed(auth.personaIds, schedule.persona_id),
  );

  return NextResponse.json({ success: true, schedules });
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const user = { id: auth.userId };
  const supabase = auth.isApiKey === true
    ? createSupabaseServiceClient()
    : await createSupabaseServerClient();

  let body: (ScheduleRequestBody & { id?: unknown }) | null = null;
  try {
    body = (await request.json()) as ScheduleRequestBody & { id?: unknown };
  } catch {
    return errorResponse(400, 'Invalid JSON payload.', 'PATCH /api/schedule');
  }
  const scheduleId = typeof body?.id === 'string' ? body.id : null;
  if (!scheduleId) return errorResponse(400, 'id is required.', 'PATCH /api/schedule');

  // A persona-scoped API key may only touch schedules of its own personas.
  // Sessions and unrestricted keys keep the previous behavior (no lookup).
  if (auth.isApiKey === true && Array.isArray(auth.personaIds)) {
    const scopeError = await assertScheduleScope(supabase, auth.personaIds, scheduleId, user.id, 'PATCH');
    if (scopeError) return scopeError;
  }

  const updates: Record<string, unknown> = {};
  if (body.providers !== undefined) {
    const providers = Array.isArray(body.providers)
      ? body.providers.filter(
        (provider): provider is (typeof VALID_PROVIDERS)[number] =>
          typeof provider === 'string' &&
            (VALID_PROVIDERS as readonly string[]).includes(provider),
      )
      : [];
    if (providers.length === 0) {
      return errorResponse(400, 'providers must contain youtube, instagram, linkedin and/or bluesky.', 'PATCH /api/schedule');
    }
    updates.providers = providers;
  }
  if (body.daysOfWeek !== undefined) {
    const daysOfWeek = parseDaysOfWeek(body.daysOfWeek);
    if (!daysOfWeek) return errorResponse(400, 'daysOfWeek must be a non-empty array of 0–6.', 'PATCH /api/schedule');
    updates.days_of_week = daysOfWeek;
  }
  if (body.startHour !== undefined || body.endHour !== undefined) {
    // The window changes as a pair: fetch current values to validate the final pair.
    const { data: current } = await supabase
      .from('schedules')
      .select('start_hour, end_hour')
      .eq('id', scheduleId)
      .eq('user_id', user.id)
      .single();
    if (!current) return errorResponse(404, 'Schedule not found.', 'PATCH /api/schedule');
    const startHour = body.startHour !== undefined ? parseHour(body.startHour) : current.start_hour;
    const endHour = body.endHour !== undefined ? parseHour(body.endHour) : current.end_hour;
    if (startHour === null || endHour === null || startHour > endHour) {
      return errorResponse(400, 'startHour/endHour must be hours 0–23 with startHour ≤ endHour.', 'PATCH /api/schedule');
    }
    updates.start_hour = startHour;
    updates.end_hour = endHour;
  }
  if (body.postsPerDay !== undefined) {
    const postsPerDay = typeof body.postsPerDay === 'number' ? Math.floor(body.postsPerDay) : Number.NaN;
    if (!Number.isInteger(postsPerDay) || postsPerDay < 1 || postsPerDay > 10) {
      return errorResponse(400, 'postsPerDay must be between 1 and 10.', 'PATCH /api/schedule');
    }
    updates.posts_per_day = postsPerDay;
  }
  if (body.times !== undefined) {
    const times = parseTimes(body.times);
    if (times === null) {
      return errorResponse(
        400,
        'times must be an array of "HH:MM" strings (00:00–23:59) or full ISO datetimes ("2026-10-02T15:00").', 'PATCH /api/schedule',
      );
    }
    const postsPerDay =
      typeof updates.posts_per_day === 'number'
        ? updates.posts_per_day
        : await (async () => {
          const { data: current } = await supabase
            .from('schedules')
            .select('posts_per_day')
            .eq('id', scheduleId)
            .eq('user_id', user.id)
            .single();
          if (!current) return null;
          return typeof current.posts_per_day === 'number' ? current.posts_per_day : null;
        })();
    if (postsPerDay === null) return errorResponse(404, 'Schedule not found.', 'PATCH /api/schedule');
    if (times.length > postsPerDay) {
      return errorResponse(400, 'times cannot contain more entries than postsPerDay.', 'PATCH /api/schedule');
    }
    updates.times = times.map(slotTimeToString);
  }
  if (body.timezone !== undefined) {
    if (typeof body.timezone !== 'string' || !body.timezone) {
      return errorResponse(400, 'timezone must be a non-empty string.', 'PATCH /api/schedule');
    }
    updates.timezone = body.timezone;
  }
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') return errorResponse(400, 'active must be a boolean.', 'PATCH /api/schedule');
    updates.active = body.active;
  }
  if (
    body.youtubeAccountIds !== undefined ||
    body.instagramAccountIds !== undefined ||
    body.linkedinAccountIds !== undefined ||
    body.blueskyAccountIds !== undefined
  ) {
    // Partial update: only the sent field replaces the column; the rest
    // keep their current value (fetched here for merge + validation).
    const { data: current } = await supabase
      .from('schedules')
      .select('youtube_account_ids, instagram_account_ids, linkedin_account_ids, bluesky_account_ids')
      .eq('id', scheduleId)
      .eq('user_id', user.id)
      .single();
    if (!current) return errorResponse(404, 'Schedule not found.', 'PATCH /api/schedule');
    const youtubeAccountIds =
      body.youtubeAccountIds !== undefined
        ? parseAccountIds(body.youtubeAccountIds)
        : current.youtube_account_ids ?? [];
    const instagramAccountIds =
      body.instagramAccountIds !== undefined
        ? parseAccountIds(body.instagramAccountIds)
        : current.instagram_account_ids ?? [];
    const linkedinAccountIds =
      body.linkedinAccountIds !== undefined
        ? parseAccountIds(body.linkedinAccountIds)
        : current.linkedin_account_ids ?? [];
    const blueskyAccountIds =
      body.blueskyAccountIds !== undefined
        ? parseAccountIds(body.blueskyAccountIds)
        : current.bluesky_account_ids ?? [];
    if (youtubeAccountIds.length === 0 && instagramAccountIds.length === 0 && linkedinAccountIds.length === 0 && blueskyAccountIds.length === 0) {
      return errorResponse(400, 'At least one publishing account is required.', 'PATCH /api/schedule');
    }
    // Ownership holds for the merged final selection: sent fields carry new
    // values, kept fields were validated at creation time but are re-checked
    // here so a PATCH can never point the schedule at another user's account.
    const ownedError = await assertAccountsOwned(supabase, user.id, [
      { provider: 'youtube', ids: youtubeAccountIds },
      { provider: 'instagram', ids: instagramAccountIds },
      { provider: 'linkedin', ids: linkedinAccountIds },
      { provider: 'bluesky', ids: blueskyAccountIds },
    ]);
    if (ownedError) return errorResponse(400, ownedError, 'PATCH /api/schedule');
    updates.youtube_account_ids = youtubeAccountIds;
    updates.instagram_account_ids = instagramAccountIds;
    updates.linkedin_account_ids = linkedinAccountIds;
    updates.bluesky_account_ids = blueskyAccountIds;
    updates.providers = [
      ...(youtubeAccountIds.length > 0 ? ['youtube'] : []),
      ...(instagramAccountIds.length > 0 ? ['instagram'] : []),
      ...(linkedinAccountIds.length > 0 ? ['linkedin'] : []),
      ...(blueskyAccountIds.length > 0 ? ['bluesky'] : []),
    ];
  }

  if (Object.keys(updates).length === 0) {
    return errorResponse(400, 'Nothing to update.', 'PATCH /api/schedule');
  }
  updates.updated_at = new Date().toISOString();

  const { error: updateError } = await supabase
    .from('schedules')
    .update(updates)
    .eq('id', scheduleId)
    .eq('user_id', user.id);

  if (updateError) {
    return errorResponse(500, 'Failed to update schedule.', 'PATCH /api/schedule', undefined, {
      cause: updateError,
    });
  }
  return NextResponse.json({ success: true });
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const user = { id: auth.userId };
  const supabase = auth.isApiKey === true
    ? createSupabaseServiceClient()
    : await createSupabaseServerClient();

  const scheduleId = new URL(request.url).searchParams.get('id');
  if (!scheduleId) return errorResponse(400, 'id query param is required.', 'DELETE /api/schedule');

  // A persona-scoped API key may only delete schedules of its own personas.
  // Sessions and unrestricted keys keep the previous behavior (no lookup).
  if (auth.isApiKey === true && Array.isArray(auth.personaIds)) {
    const scopeError = await assertScheduleScope(supabase, auth.personaIds, scheduleId, user.id, 'DELETE');
    if (scopeError) return scopeError;
  }

  const { error: deleteError } = await supabase
    .from('schedules')
    .delete()
    .eq('id', scheduleId)
    .eq('user_id', user.id);

  if (deleteError) {
    return errorResponse(500, 'Failed to delete schedule.', 'DELETE /api/schedule', undefined, {
      cause: deleteError,
    });
  }
  return NextResponse.json({ success: true });
}
