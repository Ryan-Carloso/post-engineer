import { NextResponse } from 'next/server';

import { engineBaseUrl } from '@/lib/engine-proxy';
import { logger } from '@/lib/logger';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { engineAuthHeaders, requireSupabaseSession } from '@/lib/request-auth';

//---------------
// GET /api/persona/voices/sample?voice_id=<id> — proxy of the engine's
// per-voice TTS sample (audio/mpeg). The engine synthesizes samples on
// demand with the local providers and caches them per voice.
//---------------

const GET_ROUTE = 'GET /api/persona/voices/sample';

async function getHandler(request: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) {
    return authError;
  }

  const limited = await applyRateLimit(request, RATE_LIMITS.voiceSample, auth.userId);
  if (limited) {
    return limited;
  }

  const voiceId = new URL(request.url).searchParams.get('voice_id');
  if (voiceId === null || !voiceId.trim()) {
    return NextResponse.json({ success: false, error: 'Voice id is required.' }, { status: 400 });
  }
  if (voiceId.length > 200) {
    return NextResponse.json({ success: false, error: 'Voice id is too long.' }, { status: 400 });
  }

  let baseUrl: string;
  try {
    baseUrl = engineBaseUrl();
  } catch (error) {
    logger.error('[api/persona/voices/sample] env missing', error);
    return NextResponse.json({ success: false, error: 'Configuration error.' }, { status: 500 });
  }

  try {
    const upstream = await fetch(
      `${baseUrl}/api/v1/personas/voices/${encodeURIComponent(voiceId.trim())}/sample`,
      { headers: engineAuthHeaders(auth.userId), cache: 'no-store' },
    );
    if (!upstream.ok) {
      logger.error('[api/persona/voices/sample] money-print error', undefined, {
        status: upstream.status,
      });
      return NextResponse.json({ success: false, error: 'Sample unavailable.' }, { status: 502 });
    }
    const audio = await upstream.arrayBuffer();
    return new NextResponse(audio, {
      status: 200,
      headers: {
        'Content-Type': upstream.headers.get('content-type') ?? 'audio/mpeg',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    logger.error('[api/persona/voices/sample] money-print unreachable', error);
    return NextResponse.json({ success: false, error: 'Sample service unreachable.' }, { status: 502 });
  }
}

export const GET = withApiErrorReporting(GET_ROUTE, getHandler, {
  getUserId: resolveReportingUserId,
});
