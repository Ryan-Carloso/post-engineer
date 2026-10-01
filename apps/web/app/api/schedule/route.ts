import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { isPersonaAllowed } from '@/lib/api-keys';
import { validateScheduleWindow } from '@/lib/schedule-window';
import { isValidTimezone, parseZonedDateTime, zonedTimeOnDate } from '@/lib/timezone';
import { computeVideoTokens, toFiniteNumber, type FaceQuality } from '@/lib/tokens';
import { apiErrorResponse } from '@/lib/api-error';
import { logger } from '@/lib/logger';
import { trackApiEvent } from '@/lib/analytics';

//---------------
// /api/schedule — CRUD for the automatic fill-schedule timetables.
// One schedule per persona (schedules_persona_owner constraint). The engine
// (fill-schedule-scheduler thread, starts with the app) reads these tables
// via the service role and does the rest: LLM topic, video in the 06:00 UTC
// batch, and publishing at each slot's time via /api/upload-content.
//---------------

const VALID_PROVIDERS = ['youtube', 'instagram', 'linkedin', 'bluesky'] as const;
export const VALID_SCHEDULE_PROVIDERS = VALID_PROVIDERS;
const MAX_DAYS_AHEAD = 7;

interface ScheduleRequestBody {
  personaId?: unknown;
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
  topics?: unknown;
  timezone?: unknown;
  scheduledAt?: unknown;
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
async function assertAccountsOwned(
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
// - { kind: 'time', time } — a wall-clock "HH:MM" applied to scheduledAt's
//   calendar date in the request timezone (legacy behavior);
// - { kind: 'datetime', at } — a full ISO datetime, so a single request can
//   batch videos across several different days. Naive wall clocks are read
//   in the request timezone; an explicit offset (Z or ±hh:mm) is respected
//   as-is, exactly like scheduledAt.
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

//---------------
// parseTopics — one explicit topic per video (1–10 non-empty strings).
// The engine generates each slot's video from its stored topic; there is
// no LLM fallback, so topics are required up front (fail fast).
//---------------
export function parseTopics(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 10) return null;
  const topics: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.trim() === '') return null;
    topics.push(item.trim());
  }
  return topics;
}

export interface OneOffSlot {
  topic: string;
  slotAt: Date;
}

//---------------
// computeOneOffSlots — (topic, slotAt) pairs for the one-off contract:
// - times given: one slot per (time, topic) pair. "HH:MM" entries land on
//   the scheduledAt calendar date in `timezone`; explicit datetime entries
//   are parsed in `timezone` (or via their own offset), so one request can
//   span several days.
// - times empty: exactly one topic → a single slot at scheduledAt.
// Returns null when the combination is invalid (the caller maps it to a
// 400 with a specific message).
//---------------
export function computeOneOffSlots(
  topics: string[],
  times: SlotTime[],
  scheduledAt: Date,
  timezone: string,
): OneOffSlot[] | null {
  if (times.length > 0) {
    if (times.length !== topics.length) return null;
    const slots: OneOffSlot[] = [];
    for (let i = 0; i < topics.length; i++) {
      const t = times[i];
      const slotAt =
        t.kind === 'time' ? zonedTimeOnDate(scheduledAt, t.time, timezone) : parseZonedDateTime(t.at, timezone);
      if (!slotAt) return null;
      slots.push({ topic: topics[i], slotAt });
    }
    return slots;
  }
  if (topics.length !== 1) return null;
  return [{ topic: topics[0], slotAt: scheduledAt }];
}

function parseFaceQuality(value: unknown): FaceQuality | null {
  return value === 'ok' || value === 'very_good' ? value : null;
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
    .select('id, persona_id, providers, youtube_account_ids, instagram_account_ids, linkedin_account_ids, bluesky_account_ids, days_of_week, start_hour, end_hour, posts_per_day, timezone, scheduled_at, active, created_at')
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

//---------------
// POST — ONE-OFF schedules only (since PR #21 removed recurring automation).
// Recurring fields (daysOfWeek/startHour/endHour) sent by legacy callers are
// ignored on purpose: every row is a single scheduled_at row with the
// recurring columns stored as NULL. A missing scheduledAt is a 400 — there is
// no longer a recurring fallback.
//---------------
export async function POST(request: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const user = { id: auth.userId };
  const supabase = auth.isApiKey === true
    ? createSupabaseServiceClient()
    : await createSupabaseServerClient();

  let body: ScheduleRequestBody;
  try {
    body = (await request.json()) as ScheduleRequestBody;
  } catch {
    trackApiEvent('schedule_request_failed', { reason: 'invalid_json' });
    return errorResponse(400, 'Invalid JSON payload.', 'POST /api/schedule');
  }

  const personaId = typeof body.personaId === 'string' ? body.personaId : null;
  if (!personaId) {
    trackApiEvent('schedule_request_failed', { reason: 'missing_personaId' });
    return errorResponse(400, 'personaId is required.', 'POST /api/schedule');
  }
  trackApiEvent('schedule_requested', { personaId });
  if (!isPersonaAllowed(auth.personaIds, personaId)) {
    trackApiEvent('schedule_request_failed', { personaId, reason: 'persona_not_allowed' });
    return errorResponse(403, 'This API key does not have access to this persona.', 'POST /api/schedule');
  }

  // One-off schedules always carry a target datetime (same rule as the MCP
  // server): it must be between 24h and 30 days ahead.
  //
  // Timezone rule: a naive "2026-10-01T14:00:00" is a wall clock in
  // `timezone`, NOT 14:00 UTC (`new Date(naive)` would assume UTC per
  // spec). An explicit offset (Z or ±hh:mm) is respected as-is.
  const timezone = typeof body.timezone === 'string' && body.timezone ? body.timezone : 'UTC';
  if (!isValidTimezone(timezone)) {
    return errorResponse(400, 'timezone must be a valid IANA timezone (e.g. "Europe/Lisbon").', 'POST /api/schedule');
  }
  if (body.scheduledAt === undefined || body.scheduledAt === null) {
    return errorResponse(400, 'scheduledAt is required.', 'POST /api/schedule');
  }
  const scheduledAt = parseZonedDateTime(body.scheduledAt, timezone);
  if (!scheduledAt) {
    return errorResponse(400, 'scheduledAt must be a valid ISO date.', 'POST /api/schedule');
  }
  // The 24h/30d window is validated against the converted instant, so a
  // wall clock in UTC+14 is not measured as if it were UTC.
  const windowCheck = validateScheduleWindow(scheduledAt);
  if (!windowCheck.ok) return errorResponse(400, windowCheck.error, 'POST /api/schedule');

  const providers = Array.isArray(body.providers)
    ? body.providers.filter(
      (provider): provider is (typeof VALID_PROVIDERS)[number] =>
        typeof provider === 'string' &&
          (VALID_PROVIDERS as readonly string[]).includes(provider),
    )
    : [];
  if (providers.length === 0) {
    return errorResponse(400, 'providers must contain youtube, instagram, linkedin and/or bluesky.', 'POST /api/schedule');
  }
  const youtubeAccountIds = parseAccountIds(body.youtubeAccountIds);
  const instagramAccountIds = parseAccountIds(body.instagramAccountIds);
  const linkedinAccountIds = parseAccountIds(body.linkedinAccountIds);
  const blueskyAccountIds = parseAccountIds(body.blueskyAccountIds);
  if (providers.includes('youtube') && youtubeAccountIds.length === 0) {
    return errorResponse(400, 'youtubeAccountIds must contain at least one account.', 'POST /api/schedule');
  }
  if (providers.includes('instagram') && instagramAccountIds.length === 0) {
    return errorResponse(400, 'instagramAccountIds must contain at least one account.', 'POST /api/schedule');
  }
  if (providers.includes('linkedin') && linkedinAccountIds.length === 0) {
    return errorResponse(400, 'linkedinAccountIds must contain at least one account.', 'POST /api/schedule');
  }
  if (providers.includes('bluesky') && blueskyAccountIds.length === 0) {
    return errorResponse(400, 'blueskyAccountIds must contain at least one account.', 'POST /api/schedule');
  }

  const postsPerDay = typeof body.postsPerDay === 'number' ? Math.floor(body.postsPerDay) : 1;
  if (!Number.isInteger(postsPerDay) || postsPerDay < 1 || postsPerDay > 10) {
    return errorResponse(400, 'postsPerDay must be between 1 and 10.', 'POST /api/schedule');
  }

  // One topic per video, up front: the engine generates each slot from its
  // stored topic (no LLM fallback), so a missing topic is a 400 here —
  // never a silent slot that fails at publish time.
  const topics = parseTopics(body.topics);
  if (!topics) {
    return errorResponse(400, 'topics must be a non-empty array of 1–10 non-empty strings, one per video.', 'POST /api/schedule');
  }
  if (postsPerDay !== topics.length) {
    return errorResponse(400, `postsPerDay (${postsPerDay}) must equal the number of topics (${topics.length}).`, 'POST /api/schedule');
  }

  // Explicit times pair 1:1 with topics (computeOneOffSlots enforces the
  // count); without times exactly one topic is allowed (single slot at
  // scheduledAt).
  const times = parseTimes(body.times);
  if (times === null) {
    return errorResponse(
      400,
      'times must be an array of "HH:MM" strings (00:00–23:59) or full ISO datetimes ("2026-10-02T15:00").', 'POST /api/schedule',
    );
  }
  // Explicit datetimes are independent instants: each must sit inside the
  // 24h–30d scheduling window ("HH:MM" entries ride on scheduledAt's date,
  // which was validated above). Fail fast naming the offending entry.
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    if (t.kind !== 'datetime') continue;
    const at = parseZonedDateTime(t.at, timezone);
    if (!at) {
      return errorResponse(400, `times[${i}] ("${t.at}") is not a valid ISO datetime.`, 'POST /api/schedule', undefined, {
        logMessage: 'times[i] is not a valid ISO datetime.',
        metadata: { index: i, value: String(t.at).slice(0, 100) },
      });
    }
    if (!validateScheduleWindow(at).ok) {
      return errorResponse(400, `times[${i}] ("${t.at}") must be between 24 hours and 30 days ahead.`, 'POST /api/schedule', undefined, {
        logMessage: 'times[i] is outside the 24h-30d scheduling window.',
        metadata: { index: i, value: String(t.at).slice(0, 100) },
      });
    }
  }
  const slots = computeOneOffSlots(topics, times, scheduledAt, timezone);
  if (!slots) {
    return errorResponse(
      400,
      times.length > 0
        ? `times (${times.length}) must contain exactly one entry per topic (${topics.length}).`
        : 'provide times for multiple videos: topics has more than one entry but times is empty.', 'POST /api/schedule',
    );
  }

  // `timezone` was validated above (before scheduledAt parsing).

  // The persona must exist and belong to the user (RLS enforces it too).
  const { data: persona } = await supabase
    .from('personas')
    .select('id, face_mix_percent, face_quality')
    .eq('id', personaId)
    .eq('user_id', user.id)
    .single();
  if (!persona) return errorResponse(404, 'Persona not found.', 'POST /api/schedule');

  // Multiple schedules per persona are allowed: each one-off schedule is an
  // independent set of slots (own times, own providers, prepaid tokens), so
  // a persona can hold e.g. a 15h Bluesky schedule and a 17h
  // YouTube+Bluesky schedule at the same time.

  const accountIdsByProvider = {
    youtube: youtubeAccountIds,
    instagram: instagramAccountIds,
    linkedin: linkedinAccountIds,
    bluesky: blueskyAccountIds,
  } as const;
  // Only the selected providers carry an account requirement.
  const ownedError = await assertAccountsOwned(
    supabase,
    user.id,
    VALID_PROVIDERS.map((provider) => ({
      provider,
      ids: providers.includes(provider) ? accountIdsByProvider[provider] : [],
    })),
  );
  if (ownedError) return errorResponse(400, ownedError, 'POST /api/schedule');

  // Fail-fast token charging, mirroring POST /api/schedule/batch: the whole
  // schedule is prepaid in ONE atomic spend BEFORE anything is created, so a
  // generation failure later is a per-slot refund, never an unpaid video.
  // generation_id = batch:{scheduleId} reuses the engine's existing
  // per-slot refund path (refund_batch_tokens) unchanged.
  const faceMix = toFiniteNumber((persona as Record<string, unknown>).face_mix_percent, 0);
  const faceQuality = parseFaceQuality((persona as Record<string, unknown>).face_quality) ?? 'ok';
  const perVideoCost = computeVideoTokens(faceMix, faceQuality);
  const totalCost = slots.length * perVideoCost;

  const scheduleId = randomUUID();
  const generationId = `batch:${scheduleId}`;

  // Token RPCs (spend_tokens, refund_generation_tokens, grant_signup_bonus)
  // are service_role-only, so they must always run through the service
  // client; table writes stay on the caller's client.
  const serviceSupabase = createSupabaseServiceClient();
  try {
    await serviceSupabase.rpc('grant_signup_bonus', { p_user_id: user.id });
  } catch {
    // Best-effort: the spend below is the real gate.
  }

  const { data: spendData, error: spendError } = await serviceSupabase.rpc('spend_tokens', {
    p_user_id: user.id,
    p_amount: totalCost,
    p_generation_id: generationId,
    p_reason: `One-off schedule (${slots.length} video${slots.length === 1 ? '' : 's'})`,
  });
  if (spendError) {
    return errorResponse(500, 'Failed to process tokens. Please try again.', 'POST /api/schedule', undefined, {
      cause: spendError,
    });
  }
  const spendRecord = (spendData ?? {}) as Record<string, unknown>;
  if (spendRecord.spent !== true) {
    const have = toFiniteNumber(spendRecord.balance, 0);
    return errorResponse(
      400,
      `INSUFFICIENT_TOKENS: schedule needs ${totalCost} tokens but the balance is ${have}.`, 'POST /api/schedule',
      { code: 'INSUFFICIENT', have, need: totalCost },
    );
  }

  const refundCharge = async (reason: string): Promise<boolean> => {
    const { error } = await serviceSupabase.rpc('refund_generation_tokens', {
      p_user_id: user.id,
      p_generation_id: generationId,
      p_reason: reason,
    });
    return !error;
  };

  const { data: schedule, error: insertError } = await supabase
    .from('schedules')
    .insert({
      id: scheduleId,
      user_id: user.id,
      persona_id: personaId,
      // kind='batch': a one-off schedule is a finite prepaid set of slots,
      // exactly what the DB's kind values mean. Never leave the
      // kind='recurring' default: the partial unique index
      // schedules_persona_owner_recurring would reject the persona's
      // second schedule with a 500 (the app-level 409 guard is gone since
      // PR #28, but the DB guard still fires on the default).
      //
      // Backfill note: one-off schedules created before this fix keep
      // kind='recurring' and still trip the index. One-time manual fix in
      // the Supabase dashboard SQL editor:
      //   update schedules set kind='batch' where kind='recurring'
      //   and id not in (select schedule_id from scheduled_posts ...);
      // (Scope the WHERE to actual one-off rows for the affected personas.)
      kind: 'batch',
      providers,
      youtube_account_ids: youtubeAccountIds,
      instagram_account_ids: instagramAccountIds,
      linkedin_account_ids: linkedinAccountIds,
      bluesky_account_ids: blueskyAccountIds,
      days_of_week: null,
      start_hour: null,
      end_hour: null,
      posts_per_day: postsPerDay,
      times: times.map(slotTimeToString),
      timezone,
      scheduled_at: scheduledAt.toISOString(),
      active: true,
    })
    .select('id, persona_id, providers, youtube_account_ids, instagram_account_ids, linkedin_account_ids, bluesky_account_ids, days_of_week, start_hour, end_hour, posts_per_day, times, timezone, scheduled_at, active')
    .single();

  if (insertError || !schedule) {
    await refundCharge('Schedule insert failed; tokens refunded');
    return errorResponse(500, 'Failed to create schedule.', 'POST /api/schedule', undefined, {
      cause: insertError,
    });
  }

  // One row per video: the engine's tick picks pending slots up immediately
  // (generation starts at creation, not at publish time) and publishes each
  // at its slot_at. Topics are stored up front — no LLM fallback.
  // NOTE: no explicit `id` — scheduled_posts.id is database-generated
  // (the batch route omits it too); sending a client uuid breaks the insert.
  // The response is built from the rows the database returned (id, topic,
  // slot_at) — never by zipping the insert payload with the returned ids,
  // because INSERT order is not a pairing contract.
  const slotRows = slots.map((slot) => ({
    schedule_id: scheduleId,
    user_id: user.id,
    slot_at: slot.slotAt.toISOString(),
    status: 'pending',
    topic: slot.topic,
  }));
  const { data: insertedSlots, error: slotsError } = await supabase
    .from('scheduled_posts')
    .insert(slotRows)
    .select('id, topic, slot_at');
  if (slotsError || !insertedSlots || insertedSlots.length !== slotRows.length) {
    // When the insert succeeded but .select came back short/empty,
    // slotsError is null: log a distinct message with observed vs expected
    // counts instead of the misleading generic insert failure.
    const mismatch = !slotsError;
    // Rollback failures are loud: if a compensating delete fails, the engine
    // tick could pick up orphaned pending slots and generate videos whose
    // charge was refunded. Log both results.
    const { error: delSlotsError } = await supabase.from('scheduled_posts').delete().eq('schedule_id', scheduleId).eq('user_id', user.id);
    const { error: delScheduleError } = await supabase.from('schedules').delete().eq('id', scheduleId).eq('user_id', user.id);
    if (delSlotsError || delScheduleError) {
      logger.error('[schedule] rollback deletes failed after slot insert failure', undefined, {
        route: 'POST /api/schedule',
        scheduleId,
        delSlotsError: delSlotsError?.message,
        delScheduleError: delScheduleError?.message,
      });
    }
    const refunded = await refundCharge('Schedule slots insert failed; tokens refunded');
    if (!refunded) {
      logger.error('[schedule] token refund failed after slot insert failure', undefined, {
        route: 'POST /api/schedule',
        scheduleId,
      });
    }
    return errorResponse(500, 'Failed to create schedule.', 'POST /api/schedule', undefined, {
      cause: slotsError ?? undefined,
      logMessage: mismatch
        ? `slots insert returned ${insertedSlots?.length ?? 0} ids for ${slotRows.length} rows`
        : undefined,
      metadata: mismatch
        ? { returnedIds: insertedSlots?.length ?? 0, expectedRows: slotRows.length }
        : undefined,
    });
  }

  // Product analytics: a schedule was created successfully.
  trackApiEvent('schedule_created', {
    scheduleId,
    slots: insertedSlots.length,
    providers: providers.length,
    personaId,
  });

  return NextResponse.json(
    {
      success: true,
      schedule,
      // Slots are created pending, presented as awaiting; the generation
      // queue starts here, so the position follows the returned order.
      // Every field comes from the inserted row itself — see the note on
      // the .select() above.
      slots: insertedSlots.map((row, index) => {
        const inserted = row as { id: unknown; topic: string; slot_at: string };
        return {
          id: inserted.id,
          topic: inserted.topic,
          slotAt: inserted.slot_at,
          status: 'awaiting',
          progress: 0,
          stage: null,
          queuePosition: index + 1,
          queueTotal: insertedSlots.length,
          retryable: null,
        };
      }),
    },
    { status: 201 },
  );
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

// Exported for contract tests and the status route.
export const SCHEDULE_MAX_DAYS_AHEAD = MAX_DAYS_AHEAD;
