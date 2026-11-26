import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { isScopedApiKey } from '@/lib/api-keys';
import { logger } from '@/lib/logger';

import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import {
  parseStatusLimit,
  parseStatusRange,
  RANGE_MAX_SLOTS,
  RANGE_STATUSES,
} from '@/lib/contracts/schedule';
import { mergeBySlotAt, presentPublishRows, USER_NOTICE_OUTCOME_FILTER } from '@/lib/publish-user-notice';
import { postUrlFor } from '@/lib/post-url';
import { applyRateLimit, CALLER_RATE_LIMITS, profileForCaller } from '@/lib/rate-limit';

const RESULT_SELECT =
  'id, slot_at, status, title, error, published_at, schedule_id, publish_outcomes';

function withPostUrl<T extends { id?: unknown }>(slots: T[]): (T & { postUrl: string | null })[] {
  return slots.map((slot) => ({
    ...slot,
    postUrl: typeof slot.id === 'string' ? postUrlFor(slot.id) : null,
  }));
}

async function getHandler(request: Request): Promise<NextResponse> {
  const range = parseStatusRange(new URL(request.url).searchParams);
  if (range.kind === 'error') {
    return NextResponse.json({ success: false, error: range.message }, { status: 400 });
  }
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const limited = await applyRateLimit(request, profileForCaller(auth, CALLER_RATE_LIMITS.scheduleStatus), auth.userId);
  if (limited) return limited;
  const supabase =
    auth.isApiKey === true || auth.isOAuth === true
      ? createSupabaseServiceClient()
      : await createSupabaseServerClient();
  const userId = auth.userId;

  let scheduleIds: string[] | null = null;
  if (isScopedApiKey(auth)) {
    const { data, error } = await supabase
      .from('schedules')
      .select('id, persona_id')
      .eq('user_id', userId);
    if (error) {
      logger.error('[api/schedule/status] scope lookup failed', error);
      return NextResponse.json(
        { success: false, error: 'Failed to load schedule status.' },
        { status: 500 },
      );
    }
    const allowed = auth.personaIds ?? [];
    scheduleIds = (data ?? [])
      .filter(
        (row: { persona_id: string | null }) =>
          row.persona_id === null || allowed.includes(row.persona_id),
      )
      .map((row: { id: string }) => row.id);
    if (scheduleIds.length === 0) {
      return range.kind === 'range'
        ? NextResponse.json({ success: true, slots: [], truncated: false })
        : NextResponse.json({ success: true, upcoming: [], recent: [], hasAnyPost: false });
    }
  }

  if (range.kind === 'range') {
    let rangeQuery = supabase
      .from('scheduled_posts')
      .select(RESULT_SELECT)
      .eq('user_id', userId)
      .in('status', [...RANGE_STATUSES])
      .gte('slot_at', range.from)
      .lt('slot_at', range.to)
      .order('slot_at', { ascending: true })
      .order('id', { ascending: true });
    if (scheduleIds) rangeQuery = rangeQuery.in('schedule_id', scheduleIds);
    const { data, error } = await rangeQuery.limit(RANGE_MAX_SLOTS + 1);
    if (error) {
      logger.error('[api/schedule/status] range query failed', error);
      return NextResponse.json(
        { success: false, error: 'Failed to load schedule status.' },
        { status: 500 },
      );
    }
    const rows = data ?? [];
    const truncated = rows.length > RANGE_MAX_SLOTS;
    const slots = withPostUrl(presentPublishRows(rows.slice(0, RANGE_MAX_SLOTS)));
    return NextResponse.json({ success: true, slots, truncated });
  }

  const limit = parseStatusLimit(
    request ? new URL(request.url).searchParams.get('limit') : null,
  );
  const nowIso = new Date().toISOString();

  let upcomingQuery = supabase
    .from('scheduled_posts')
    .select('id, slot_at, status, title, error, published_at, schedule_id')
    .eq('user_id', userId)
    .in('status', ['ready'])
    .gte('slot_at', nowIso)
    .order('slot_at', { ascending: true });
  let awaitingQuery = supabase
    .from('scheduled_posts')
    .select('id, slot_at, status, title, error, published_at, schedule_id')
    .eq('user_id', userId)
    .in('status', ['awaiting_approval'])
    .order('slot_at', { ascending: true });
  let recentQuery = supabase
    .from('scheduled_posts')
    .select(RESULT_SELECT)
    .eq('user_id', userId)
    .in('status', ['published', 'failed'])
    .order('slot_at', { ascending: false });
  let publishingQuery = supabase
    .from('scheduled_posts')
    .select(RESULT_SELECT)
    .eq('user_id', userId)
    .in('status', ['publishing'])
    .contains('publish_outcomes', USER_NOTICE_OUTCOME_FILTER)
    .order('slot_at', { ascending: true });
  let anyPostQuery = supabase.from('scheduled_posts').select('id').eq('user_id', userId);
  if (scheduleIds) {
    upcomingQuery = upcomingQuery.in('schedule_id', scheduleIds);
    awaitingQuery = awaitingQuery.in('schedule_id', scheduleIds);
    recentQuery = recentQuery.in('schedule_id', scheduleIds);
    publishingQuery = publishingQuery.in('schedule_id', scheduleIds);
    anyPostQuery = anyPostQuery.in('schedule_id', scheduleIds);
  }

  const [upcoming, awaiting, recent, publishing, anyPost] = await Promise.all([
    upcomingQuery.limit(limit),
    awaitingQuery.limit(limit),
    recentQuery.limit(limit),
    publishingQuery.limit(limit),
    anyPostQuery.limit(1),
  ]);

  if (upcoming.error || awaiting.error || recent.error || publishing.error || anyPost.error) {
    logger.error('[api/schedule/status] query failed', upcoming.error ?? awaiting.error ?? recent.error ?? publishing.error ?? anyPost.error, {
      upcoming: upcoming.error,
      awaiting: awaiting.error,
      recent: recent.error,
      publishing: publishing.error,
      anyPost: anyPost.error,
    });
    return NextResponse.json(
      { success: false, error: 'Failed to load schedule status.' },
      { status: 500 },
    );
  }
  const upcomingEnriched = withPostUrl(
    mergeBySlotAt(
      presentPublishRows(publishing.data),
      presentPublishRows([...(upcoming.data ?? []), ...(awaiting.data ?? [])]),
      limit,
    ),
  );
  const recentEnriched = withPostUrl(presentPublishRows(recent.data));

  return NextResponse.json({
    success: true,
    upcoming: upcomingEnriched,
    recent: recentEnriched,
    hasAnyPost: (anyPost.data?.length ?? 0) > 0,
  });
}

export const GET = withApiErrorReporting('GET /api/schedule/status', getHandler, {
  reportSuccess: false,
  getUserId: resolveReportingUserId,
});
