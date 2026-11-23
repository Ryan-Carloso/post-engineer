import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { isScopedApiKey } from '@/lib/api-keys';
import { logger } from '@/lib/logger';

import {
  enrichSlot,
  type QueuePositions,
  type SlotEnrichment,
} from '@/lib/schedule-slot-presentation';
import { createEngineProbe, type EngineProbe } from '@/lib/engine-reachability';
import { recordProgressHistory, type ProgressSample } from '@/lib/schedule-progress-history';
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
  'id, slot_at, status, title, error, published_at, schedule_id, task_id, publish_outcomes';

function buildQueuePositions(rows: unknown): QueuePositions {
  const idsBySchedule = new Map<string, string[]>();
  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (typeof row !== 'object' || row === null) continue;
      const record = row as Record<string, unknown>;
      const scheduleId = record.schedule_id;
      const id = record.id;
      if (typeof scheduleId !== 'string' || typeof id !== 'string') continue;
      const list = idsBySchedule.get(scheduleId) ?? [];
      list.push(id);
      idsBySchedule.set(scheduleId, list);
    }
  }
  const positions: QueuePositions = new Map();
  for (const [scheduleId, ids] of idsBySchedule) {
    const byId = new Map<string, { position: number; total: number }>();
    ids.forEach((id, index) => byId.set(id, { position: index + 1, total: ids.length }));
    positions.set(scheduleId, byId);
  }
  return positions;
}

const ENGINE_LOOKUP_CAP = 25;

async function withSlotPresentation<T extends { status?: unknown; task_id?: unknown }>(
  slots: T[],
  userId: string,
  queuePositions: QueuePositions,
  engineProbe: EngineProbe,
): Promise<(T & SlotEnrichment & { postUrl: string | null })[]> {
  let remaining = ENGINE_LOOKUP_CAP;
  const plans = slots.map((slot) => {
    const needsEngine =
      (slot.status === 'generating' || slot.status === 'failed') &&
      typeof slot.task_id === 'string';
    return { slot, needsEngine, allowEngineLookup: !needsEngine || remaining-- > 0 };
  });
  const enrich = (plan: (typeof plans)[number]): Promise<SlotEnrichment> =>
    enrichSlot(plan.slot, userId, queuePositions, {
      allowEngineLookup: plan.allowEngineLookup,
      engineProbe,
    });
  const firstIndex = plans.findIndex((plan) => plan.needsEngine && plan.allowEngineLookup);
  const first = firstIndex === -1 ? null : await enrich(plans[firstIndex]);
  const enrichments = await Promise.all(
    plans.map((plan, index) =>
      index === firstIndex && first !== null ? first : enrich(plan),
    ),
  );
  return slots.map((slot, index) => {
    const id = (slot as { id?: unknown }).id;
    const postUrl = typeof id === 'string' ? postUrlFor(id) : null;
    return { ...slot, ...enrichments[index], postUrl };
  });
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
    const slots = await withSlotPresentation(
      presentPublishRows(rows.slice(0, RANGE_MAX_SLOTS)),
      userId,
      new Map(),
      createEngineProbe(),
    );
    return NextResponse.json({ success: true, slots, truncated });
  }

  const limit = parseStatusLimit(
    request ? new URL(request.url).searchParams.get('limit') : null,
  );
  const nowIso = new Date().toISOString();

  let upcomingQuery = supabase
    .from('scheduled_posts')
    .select('id, slot_at, status, title, error, published_at, schedule_id, task_id')
    .eq('user_id', userId)
    .in('status', ['pending', 'generating', 'ready'])
    .gte('slot_at', nowIso)
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
    recentQuery = recentQuery.in('schedule_id', scheduleIds);
    publishingQuery = publishingQuery.in('schedule_id', scheduleIds);
    anyPostQuery = anyPostQuery.in('schedule_id', scheduleIds);
  }

  let queueQuery = supabase
    .from('scheduled_posts')
    .select('id, schedule_id, slot_at')
    .eq('user_id', userId)
    .in('status', ['pending', 'generating'])
    .order('slot_at', { ascending: true });
  if (scheduleIds) {
    queueQuery = queueQuery.in('schedule_id', scheduleIds);
  }

  const [upcoming, recent, publishing, queueResult, anyPost] = await Promise.all([
    upcomingQuery.limit(limit),
    recentQuery.limit(limit),
    publishingQuery.limit(limit),
    queueQuery,
    anyPostQuery.limit(1),
  ]);

  if (upcoming.error || recent.error || publishing.error || anyPost.error) {
    logger.error('[api/schedule/status] query failed', undefined, {
      upcoming: upcoming.error,
      recent: recent.error,
      publishing: publishing.error,
      anyPost: anyPost.error,
    });
    return NextResponse.json(
      { success: false, error: 'Failed to load schedule status.' },
      { status: 500 },
    );
  }
  if (queueResult.error) {
    logger.warn('[api/schedule/status] queue lookup failed', { error: queueResult.error });
  }
  const queuePositions = buildQueuePositions(queueResult.error ? [] : (queueResult.data ?? []));

  const engineProbe = createEngineProbe();
  const upcomingEnriched = await withSlotPresentation(
    mergeBySlotAt(presentPublishRows(publishing.data), presentPublishRows(upcoming.data), limit),
    userId,
    queuePositions,
    engineProbe,
  );
  const recentEnriched = await withSlotPresentation(presentPublishRows(recent.data), userId, queuePositions, engineProbe);

  const samples: ProgressSample[] = [...upcomingEnriched, ...recentEnriched]
    .filter(
      (slot): slot is typeof slot & { id: string; task_id: string } =>
        (slot.status === 'generating' || slot.status === 'failed') &&
        typeof slot.id === 'string' &&
        typeof slot.task_id === 'string',
    )
    .map((slot) => ({ postId: slot.id, progress: slot.progress, stage: slot.stage }));
  await recordProgressHistory(supabase, userId, samples);

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
