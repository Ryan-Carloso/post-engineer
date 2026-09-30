import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { isPersonaAllowed } from '@/lib/api-keys';
import { computeVideoTokens, toFiniteNumber, type FaceQuality } from '@/lib/tokens';
import {
  datePartsInTimezone,
  isValidTimezone,
  zonedTimeToUtc,
} from '@/lib/timezone';
import { logger } from '@/lib/logger';

//---------------
// POST /api/schedule/batch — manual video batch (finite, user-requested).
//
// The caller sends an array of items; each item becomes exactly one video.
// Fail-fast: the whole batch is validated and the TOTAL token cost is
// deducted in one atomic spend_tokens call BEFORE anything is created.
// Insufficient balance -> 400 INSUFFICIENT with have/need, zero side effects.
//
// On accept: one schedules row + N scheduled_posts rows with
// exact slot datetimes (next N occurrences of `times` in `timezone`).
// Tokens are prepaid, so the engine generate() pass uses each slot's
// stored topic with no LLM call and no further spend.
//---------------

// Bluesky is intentionally NOT offered here: batch publishing requires
// per-provider account ids and the engine has no bluesky target support
// (no bluesky_account_ids column, unlike youtube/instagram/linkedin).
const BATCH_PROVIDERS = ['youtube', 'instagram', 'linkedin'] as const;
type BatchProvider = (typeof BATCH_PROVIDERS)[number];

const MAX_BATCH_ITEMS = 30;
const TIME_RE = /^(\d{1,2}):(\d{2})$/;

export interface BatchItem {
  topic: string;
}

export interface ParsedBatchBody {
  personaId: string;
  items: BatchItem[];
  providers: BatchProvider[];
  times: string[];
  timezone: string;
}

type ParseResult = { ok: true; value: ParsedBatchBody } | { ok: false; error: string };

function errorResponse(status: number, error: string, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ success: false, error, ...extra }, { status });
}

//---------------
// parseBatchBody — pure validation, no side effects. Every rejection maps
// to a 400 before any token or database touch.
//---------------
export function parseBatchBody(body: unknown): ParseResult {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'Invalid JSON payload.' };
  }
  const input = body as Record<string, unknown>;

  const personaId = typeof input.personaId === 'string' ? input.personaId.trim() : '';
  if (!personaId) return { ok: false, error: 'personaId is required.' };

  if (!Array.isArray(input.items) || input.items.length === 0) {
    return { ok: false, error: 'items must be a non-empty array (1-30).' };
  }
  if (input.items.length > MAX_BATCH_ITEMS) {
    return { ok: false, error: `items cannot contain more than ${MAX_BATCH_ITEMS} entries.` };
  }
  const items: BatchItem[] = [];
  for (const entry of input.items) {
    const topic =
      typeof entry === 'object' && entry !== null && typeof (entry as Record<string, unknown>).topic === 'string'
        ? ((entry as Record<string, unknown>).topic as string).trim()
        : '';
    if (!topic) return { ok: false, error: 'Every item needs a non-empty topic.' };
    items.push({ topic });
  }

  if (!Array.isArray(input.providers) || input.providers.length === 0) {
    return { ok: false, error: 'providers must be a non-empty array.' };
  }
  const providers: BatchProvider[] = [];
  for (const provider of input.providers) {
    if (typeof provider !== 'string' || !(BATCH_PROVIDERS as readonly string[]).includes(provider)) {
      return { ok: false, error: `providers must contain only ${BATCH_PROVIDERS.join(', ')}.` };
    }
    if (!providers.includes(provider as BatchProvider)) providers.push(provider as BatchProvider);
  }

  const rawTimes = input.times;
  if (!Array.isArray(rawTimes) || rawTimes.length === 0) {
    return { ok: false, error: 'times must be a non-empty array of "HH:MM".' };
  }
  const times = new Set<string>();
  for (const entry of rawTimes) {
    if (typeof entry !== 'string') return { ok: false, error: 'times must be a non-empty array of "HH:MM".' };
    const match = TIME_RE.exec(entry.trim());
    if (!match) return { ok: false, error: `Invalid time "${entry}": expected "HH:MM".` };
    const hour = Number.parseInt(match[1], 10);
    const minute = Number.parseInt(match[2], 10);
    if (hour > 23 || minute > 59) return { ok: false, error: `Invalid time "${entry}": expected "HH:MM".` };
    times.add(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
  }

  const timezone = typeof input.timezone === 'string' ? input.timezone.trim() : '';
  if (!isValidTimezone(timezone)) {
    return { ok: false, error: 'timezone must be a valid IANA timezone (e.g. "Europe/Lisbon").' };
  }

  return { ok: true, value: { personaId, items, providers, times: [...times].sort(), timezone } };
}

//---------------
// Timezone math (pure): next N occurrences of `times` in `timezone`,
// strictly after `now`, ascending. Skips times already past today.
// Wall-clock conversion lives in `@/lib/timezone` (shared with the
// one-off schedule route).
//---------------
export function computeBatchSlotDatetimes(
  times: string[],
  timezone: string,
  count: number,
  now: Date = new Date(),
): Date[] {
  const result: Date[] = [];
  const nowMs = now.getTime();
  const base = datePartsInTimezone(now, timezone);
  const baseUtcDay = Date.UTC(base.year, base.month - 1, base.day);
  // A year of days is a hard stop; count <= 30 always terminates far earlier.
  for (let dayOffset = 0; dayOffset < 366 && result.length < count; dayOffset++) {
    const day = new Date(baseUtcDay + dayOffset * 86_400_000);
    for (const time of times) {
      const [hour, minute] = time.split(':').map(Number);
      const candidate = zonedTimeToUtc(
        day.getUTCFullYear(),
        day.getUTCMonth() + 1,
        day.getUTCDate(),
        hour,
        minute,
        timezone,
      );
      if (candidate.getTime() > nowMs) {
        result.push(candidate);
        if (result.length >= count) break;
      }
    }
  }
  return result;
}

function parseFaceQuality(value: unknown): FaceQuality | null {
  return value === 'ok' || value === 'very_good' ? value : null;
}

export async function POST(request: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const supabase =
    auth.isApiKey === true ? createSupabaseServiceClient() : await createSupabaseServerClient();
  // Token RPCs (spend_tokens, refund_generation_tokens, grant_signup_bonus)
  // are service_role-only (migrations 0020-0022), so they must always run
  // through the service client; table queries stay on the caller's client.
  const serviceSupabase = createSupabaseServiceClient();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Invalid JSON payload.');
  }

  const parsed = parseBatchBody(body);
  if (!parsed.ok) return errorResponse(400, parsed.error);
  const { personaId, items, providers, times, timezone } = parsed.value;

  if (!isPersonaAllowed(auth.personaIds, personaId)) {
    return errorResponse(403, 'This API key does not have access to this persona.');
  }

  const { data: persona } = await supabase
    .from('personas')
    .select('id, user_id, face_mix_percent, face_quality')
    .eq('id', personaId)
    .eq('user_id', auth.userId)
    .single();
  if (!persona) {
    return errorResponse(404, 'Persona not found.');
  }

  const faceMix = toFiniteNumber((persona as Record<string, unknown>).face_mix_percent, 0);
  const faceQuality = parseFaceQuality((persona as Record<string, unknown>).face_quality) ?? 'ok';
  const perVideoCost = computeVideoTokens(faceMix, faceQuality);
  const totalCost = items.length * perVideoCost;

  // Fail-fast: every requested provider (youtube/instagram/linkedin) needs
  // at least one connected account; the batch stores ALL of the user's
  // accounts per provider.
  const accountIds: Record<'youtube' | 'instagram' | 'linkedin', string[]> = {
    youtube: [],
    instagram: [],
    linkedin: [],
  };
  for (const provider of ['youtube', 'instagram', 'linkedin'] as const) {
    if (!providers.includes(provider)) continue;
    const { data: accounts, error: accountsError } = await supabase
      .from('social_accounts')
      .select('provider_account_id')
      .eq('user_id', auth.userId)
      .eq('provider', provider);
    if (accountsError) {
      logger.error('[api/schedule/batch] connected accounts lookup failed', accountsError, { provider });
      return errorResponse(500, 'Failed to check connected accounts. Please try again.');
    }
    const ids = (accounts ?? [])
      .map((row) => (row as Record<string, unknown>).provider_account_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (ids.length === 0) {
      return errorResponse(
        400,
        `No connected ${provider} account. Connect one before scheduling a batch.`,
        { code: 'NO_CONNECTED_ACCOUNTS', provider },
      );
    }
    accountIds[provider] = ids;
  }

  // Batch id doubles as the spend generation_id: the engine's 6h pass
  // refunds per video under `batch:{scheduleId}:slot:{slotId}`.
  const scheduleId = randomUUID();
  const generationId = `batch:${scheduleId}`;

  // Lazy signup bonus, same best-effort grant as single video generations.
  try {
    await serviceSupabase.rpc('grant_signup_bonus', { p_user_id: auth.userId });
  } catch {
    // Best-effort: the spend below is the real gate.
  }

  // Fail-fast: ONE atomic check-and-deduct of the whole batch. spent=false
  // means insufficient balance -> 400 with have/need, nothing created.
  const { data: spendData, error: spendError } = await serviceSupabase.rpc('spend_tokens', {
    p_user_id: auth.userId,
    p_amount: totalCost,
    p_generation_id: generationId,
    p_reason: `Manual video batch (${items.length} videos)`,
  });
  if (spendError) {
    logger.error('[api/schedule/batch] spend failed', spendError);
    return errorResponse(500, 'Failed to process tokens. Please try again.');
  }
  const spendRecord = (spendData ?? {}) as Record<string, unknown>;
  if (spendRecord.spent !== true) {
    const have = toFiniteNumber(spendRecord.balance, 0);
    return errorResponse(400, `INSUFFICIENT_TOKENS: batch needs ${totalCost} tokens but the balance is ${have}.`, {
      code: 'INSUFFICIENT',
      have,
      need: totalCost,
    });
  }

  const slotAts = computeBatchSlotDatetimes(times, timezone, items.length);
  if (slotAts.length !== items.length) {
    // Defensive: cannot happen (a year of days always yields 30 slots), but
    // never leave a batch half-created.
    await serviceSupabase.rpc('refund_generation_tokens', {
      p_user_id: auth.userId,
      p_generation_id: generationId,
      p_reason: 'Batch slot computation failed; tokens refunded',
    });
    return errorResponse(500, 'Failed to schedule batch. Please try again.');
  }

  const { error: scheduleError } = await supabase
    .from('schedules')
    .insert({
      id: scheduleId,
      user_id: auth.userId,
      persona_id: personaId,
      providers,
      youtube_account_ids: accountIds.youtube,
      instagram_account_ids: accountIds.instagram,
      linkedin_account_ids: accountIds.linkedin,
      // days_of_week/start_hour/end_hour/posts_per_day are inert for batches;
      // they only satisfy NOT NULL/CHECK.
      days_of_week: [],
      start_hour: 0,
      end_hour: 23,
      posts_per_day: 1,
      times,
      timezone,
      active: true,
    })
    .select('id')
    .single();
  if (scheduleError) {
    logger.error('[api/schedule/batch] schedule insert failed', scheduleError);
    await serviceSupabase.rpc('refund_generation_tokens', {
      p_user_id: auth.userId,
      p_generation_id: generationId,
      p_reason: 'Batch schedule insert failed; tokens refunded',
    });
    return errorResponse(500, 'Failed to create batch. Please try again.');
  }

  const { error: slotsError } = await supabase.from('scheduled_posts').insert(
    items.map((item, index) => ({
      schedule_id: scheduleId,
      user_id: auth.userId,
      slot_at: slotAts[index].toISOString(),
      status: 'pending',
      topic: item.topic,
    })),
  );
  if (slotsError) {
    logger.error('[api/schedule/batch] slots insert failed', slotsError);
    await supabase.from('scheduled_posts').delete().eq('schedule_id', scheduleId);
    await supabase.from('schedules').delete().eq('id', scheduleId);
    await serviceSupabase.rpc('refund_generation_tokens', {
      p_user_id: auth.userId,
      p_generation_id: generationId,
      p_reason: 'Batch slots insert failed; tokens refunded',
    });
    return errorResponse(500, 'Failed to create batch. Please try again.');
  }

  return NextResponse.json({
    success: true,
    scheduleId,
    perVideoCost,
    tokensSpent: totalCost,
    slots: items.map((item, index) => ({
      topic: item.topic,
      slotAt: slotAts[index].toISOString(),
    })),
  });
}
