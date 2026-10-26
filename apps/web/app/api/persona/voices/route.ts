import { NextResponse } from 'next/server';
import { requireSupabaseSession } from '@/lib/request-auth';
import { fetchPersonaVoiceOptions } from '@/lib/voice-catalog-fetch';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';

//---------------
// GET /api/persona/voices — proxy of the house voice catalog to
// money-print. Single source of truth: the ids used in samples and in
// video jobs are always money-print's.
// Auth = Supabase session (cookie) OR personal API key (Bearer/x-api-key, MCP).
//---------------

async function getHandler(request?: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;

  const result = await fetchPersonaVoiceOptions(auth.userId);
  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json({ voices: result.voices });
}

//---------------
// 5xx reporting: handled server errors reach PostHog error tracking.
//---------------
export const GET = withApiErrorReporting('GET /api/persona/voices', getHandler, { getUserId: resolveReportingUserId });
