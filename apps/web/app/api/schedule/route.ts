import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { isPersonaAllowed } from '@/lib/api-keys';
import { apiErrorResponse } from '@/lib/api-error';

//---------------
// /api/schedule — read and cancel the automatic fill-schedule timetables.
// Schedules are created by POST /api/videos/generate-and-schedule (the web
// form and the MCP generate_persona_videos tool); this route only lists
// them (GET) and cancels one (DELETE, used by the MCP cancel_schedule
// tool). There is no edit verb.
//
// One schedule per persona (schedules_persona_owner constraint). The engine
// (fill-schedule-scheduler thread, starts with the app) reads these tables
// via the service role and does the rest: LLM topic, video in the 06:00 UTC
// batch, and publishing at each slot's time via /api/upload-content.
//---------------

const VALID_PROVIDERS = ['youtube', 'instagram', 'linkedin', 'bluesky'] as const;
export const VALID_SCHEDULE_PROVIDERS = VALID_PROVIDERS;

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
