import { NextResponse } from 'next/server';
import { requireSupabaseSession } from '@/lib/request-auth';
import { fetchPersonaVoiceOptions } from '@/lib/voice-catalog-fetch';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';

async function getHandler(request?: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;

  const result = await fetchPersonaVoiceOptions(auth.userId);
  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json({ voices: result.voices });
}

export const GET = withApiErrorReporting('GET /api/persona/voices', getHandler, { getUserId: resolveReportingUserId });
