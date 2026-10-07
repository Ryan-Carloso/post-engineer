import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { isScopedApiKey } from '@/lib/api-keys';
import { logger } from '@/lib/logger';

//---------------
// GET /api/schedule/status — upcoming slots + recent results of the
// user's schedules (for the home schedule card and the MCP list_posts tool).
// Optional ?limit= (default 10, max 500) — the posts page raises it
// to render the full history.
// Auth: cookie session (web) or API key / OAuth token (MCP clients)
// via requireSupabaseSession. Persona-scoped API keys only see posts whose
// schedule belongs to one of their allowed personas.
//---------------

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 500;

//---------------
// parseLimit — validates the ?limit= query param; invalid or out of
// range falls back to DEFAULT_LIMIT. The whole string must be digits —
// Number.parseInt('12abc') would silently return 12 otherwise.
//---------------
export function parseLimit(value: string | null): number {
  if (value === null || !/^\d+$/.test(value)) return DEFAULT_LIMIT;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

import {
  enrichSlot,
  type QueuePositions,
  type SlotEnrichment,
} from '@/lib/schedule-slot-presentation';
import { recordProgressHistory, type ProgressSample } from '@/lib/schedule-progress-history';
import { withApiErrorReporting } from '@/lib/api-error-reporting';

//---------------
// buildQueuePositions — 1-based position of every awaiting+generating
// slot within its schedule, ordered by slot_at, plus the schedule total.
// The queue query is already ordered by slot_at, so positions follow row
// order. Malformed rows are skipped instead of failing the request.
//---------------
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

//---------------
// withSlotPresentation — attach the presentation fields to every slot
// (shared enrichSlot from lib/schedule-slot-presentation). Engine task
// lookups run concurrently (Promise.all): sequential one-off generation
// means at most one generating slot per schedule, but a caller may list
// many schedules. The fan-out is capped (PR #41 rule): past the cap,
// generating/failed slots degrade to progress 0 instead of firing
// unbounded concurrent engine calls.
//---------------
const ENGINE_LOOKUP_CAP = 25;

async function withSlotPresentation<T extends { status?: unknown; task_id?: unknown }>(
  slots: T[],
  userId: string,
  queuePositions: QueuePositions,
): Promise<(T & SlotEnrichment)[]> {
  let remaining = ENGINE_LOOKUP_CAP;
  const enrichments = await Promise.all(
    slots.map((slot) => {
      const needsEngine =
        (slot.status === 'generating' || slot.status === 'failed') &&
        typeof slot.task_id === 'string';
      const allowEngineLookup = !needsEngine || remaining-- > 0;
      return enrichSlot(slot, userId, queuePositions, { allowEngineLookup });
    }),
  );
  return slots.map((slot, index) => ({ ...slot, ...enrichments[index] }));
}

async function getHandler(request?: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  // API-key/OAuth callers have no cookie session, so the service client
  // (scoped by user_id below) is used; web sessions keep the server client.
  const supabase =
    auth.isApiKey === true || auth.isOAuth === true
      ? createSupabaseServiceClient()
      : await createSupabaseServerClient();
  const userId = auth.userId;

  // Persona-scoped API keys only see posts whose schedule belongs to one of
  // their allowed personas; resolve those schedule ids first. A schedule with
  // no persona (migration 012) belongs to no persona scope, so it is included
  // like an unrestricted one — otherwise a scoped key that just created a
  // persona-less post could never see it again.
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
      return NextResponse.json({ success: true, upcoming: [], recent: [] });
    }
  }

  const limit = parseLimit(
    request ? new URL(request.url).searchParams.get('limit') : null,
  );
  const nowIso = new Date().toISOString();

  // task_id is included on BOTH selects so callers can poll per-video
  // progress: the engine sets it on the slot when generation dispatches,
  // and the MCP get_video_task_progress tool reads the engine task by
  // that id. The recent select needs it too — failed slots report their
  // last known engine progress.
  let upcomingQuery = supabase
    .from('scheduled_posts')
    .select('id, slot_at, status, topic, schedule_id, task_id')
    .eq('user_id', userId)
    .in('status', ['pending', 'generating', 'ready'])
    .gte('slot_at', nowIso)
    .order('slot_at', { ascending: true });
  let recentQuery = supabase
    .from('scheduled_posts')
    .select('id, slot_at, status, topic, error, published_at, schedule_id, task_id')
    .eq('user_id', userId)
    .in('status', ['published', 'failed'])
    .order('slot_at', { ascending: false });
  if (scheduleIds) {
    upcomingQuery = upcomingQuery.in('schedule_id', scheduleIds);
    recentQuery = recentQuery.in('schedule_id', scheduleIds);
  }

  // Queue positions come from a dedicated un-limited query: the paginated
  // upcoming list can cut a schedule's queue mid-way, which would corrupt
  // positions computed from the returned page alone.
  let queueQuery = supabase
    .from('scheduled_posts')
    .select('id, schedule_id, slot_at')
    .eq('user_id', userId)
    .in('status', ['pending', 'generating'])
    .order('slot_at', { ascending: true });
  if (scheduleIds) {
    queueQuery = queueQuery.in('schedule_id', scheduleIds);
  }

  const [upcoming, recent, queueResult] = await Promise.all([
    upcomingQuery.limit(limit),
    recentQuery.limit(limit),
    queueQuery,
  ]);

  if (upcoming.error || recent.error) {
    logger.error('[api/schedule/status] query failed', undefined, {
      upcoming: upcoming.error,
      recent: recent.error,
    });
    return NextResponse.json(
      { success: false, error: 'Failed to load schedule status.' },
      { status: 500 },
    );
  }
  // A failed queue lookup degrades queuePosition/queueTotal to null — the
  // status itself still resolves.
  if (queueResult.error) {
    logger.warn('[api/schedule/status] queue lookup failed', { error: queueResult.error });
  }
  const queuePositions = buildQueuePositions(queueResult.error ? [] : (queueResult.data ?? []));

  const upcomingEnriched = await withSlotPresentation(upcoming.data ?? [], userId, queuePositions);
  const recentEnriched = await withSlotPresentation(recent.data ?? [], userId, queuePositions);

  // Best-effort progress history: every observation of a live (generating)
  // or dead (failed) slot records a (progress, stage) row when it changed
  // since the last one, so regressions like 40% -> 0% stay visible after
  // the fact. recordProgressHistory never throws; a history failure must
  // not fail the status request it rides on.
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
  });
}

//---------------
// 5xx reporting: handled server errors reach PostHog error tracking.
//---------------
export const GET = withApiErrorReporting('GET /api/schedule/status', getHandler);
