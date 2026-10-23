import { NextResponse } from 'next/server';

import { validateCloneReferenceBuffer } from '@/lib/cloned-voice-audio';
import { engineBaseUrl, parseEngineJson } from '@/lib/engine-proxy';
import { logger } from '@/lib/logger';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { engineAuthHeaders, requireSupabaseSession } from '@/lib/request-auth';

const POST_ROUTE = 'POST /api/persona/cloned-voices/denoise-preview';

//---------------
// POST /api/persona/cloned-voices/denoise-preview — returns the cleaned
// (denoised) WAV of a reference recording so the user can compare it with
// the original before cloning. Nothing is stored. Rate-limited: each call
// runs an ffmpeg pass on the engine.
//---------------
async function postHandler(request: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) {
    return authError;
  }

  const limited = await applyRateLimit(request, RATE_LIMITS.voiceCloneDenoisePreview, auth.userId);
  if (limited) {
    return limited;
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid multipart body.' }, { status: 400 });
  }
  const fileEntry = formData.get('file');
  if (typeof fileEntry === 'string' || fileEntry === null) {
    return NextResponse.json({ success: false, error: 'Reference audio file is required.' }, { status: 400 });
  }
  const buffer = Buffer.from(await fileEntry.arrayBuffer());
  const validation = validateCloneReferenceBuffer(buffer);
  if (!validation.ok) {
    return NextResponse.json({ success: false, error: validation.error }, { status: 400 });
  }

  let baseUrl: string;
  try {
    baseUrl = engineBaseUrl();
  } catch (error) {
    logger.error('[api/persona/cloned-voices/denoise-preview] env missing', error);
    return NextResponse.json({ success: false, error: 'Configuration error.' }, { status: 500 });
  }

  const upstreamForm = new FormData();
  upstreamForm.set(
    'file',
    new Blob([buffer], { type: fileEntry.type || 'application/octet-stream' }),
    fileEntry.name || 'reference.bin',
  );

  try {
    const upstream = await fetch(`${baseUrl}/api/v1/cloned-voices/denoise-preview`, {
      method: 'POST',
      headers: engineAuthHeaders(auth.userId),
      body: upstreamForm,
    });
    if (!upstream.ok) {
      const payload = await parseEngineJson(upstream);
      const message =
        typeof payload === 'object' &&
        payload !== null &&
        'message' in payload &&
        typeof payload.message === 'string'
          ? payload.message
          : 'Could not clean the audio.';
      return NextResponse.json({ success: false, error: message }, { status: upstream.status });
    }
    if (upstream.headers.get('content-type') !== 'audio/wav') {
      logger.error('[api/persona/cloned-voices/denoise-preview] non-audio upstream body');
      return NextResponse.json({ success: false, error: 'Invalid denoise response.' }, { status: 502 });
    }
    const audio = await upstream.arrayBuffer();
    return new NextResponse(audio, { status: 200, headers: { 'content-type': 'audio/wav' } });
  } catch (error) {
    logger.error('[api/persona/cloned-voices/denoise-preview] unreachable', error);
    return NextResponse.json({ success: false, error: 'Cloned voices service unreachable.' }, { status: 502 });
  }
}

export const POST = withApiErrorReporting(POST_ROUTE, postHandler, {
  getUserId: resolveReportingUserId,
});
