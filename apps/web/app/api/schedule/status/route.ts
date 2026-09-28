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

export async function GET(request?: Request): Promise<NextResponse> {
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
  // their allowed personas; resolve those schedule ids first.
  let scheduleIds: string[] | null = null;
  if (isScopedApiKey(auth)) {
    const { data, error } = await supabase
      .from('schedules')
      .select('id')
      .eq('user_id', userId)
      .in('persona_id', auth.personaIds ?? []);
    if (error) {
      logger.error('[api/schedule/status] scope lookup failed', error);
      return NextResponse.json(
        { success: false, error: 'Failed to load schedule status.' },
        { status: 500 },
      );
    }
    scheduleIds = (data ?? []).map((row: { id: string }) => row.id);
    if (scheduleIds.length === 0) {
      return NextResponse.json({ success: true, upcoming: [], recent: [] });
    }
  }

  const limit = parseLimit(
    request ? new URL(request.url).searchParams.get('limit') : null,
  );
  const nowIso = new Date().toISOString();

  let upcomingQuery = supabase
    .from('scheduled_posts')
    .select('id, slot_at, status, topic, schedule_id')
    .eq('user_id', userId)
    .in('status', ['pending', 'generating', 'ready'])
    .gte('slot_at', nowIso)
    .order('slot_at', { ascending: true });
  let recentQuery = supabase
    .from('scheduled_posts')
    .select('id, slot_at, status, topic, error, published_at, schedule_id')
    .eq('user_id', userId)
    .in('status', ['published', 'failed'])
    .order('slot_at', { ascending: false });
  if (scheduleIds) {
    upcomingQuery = upcomingQuery.in('schedule_id', scheduleIds);
    recentQuery = recentQuery.in('schedule_id', scheduleIds);
  }

  const [upcoming, recent] = await Promise.all([
    upcomingQuery.limit(limit),
    recentQuery.limit(limit),
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

  return NextResponse.json({
    success: true,
    upcoming: upcoming.data ?? [],
    recent: recent.data ?? [],
  });
}
