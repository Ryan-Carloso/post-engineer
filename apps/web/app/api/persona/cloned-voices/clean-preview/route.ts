import { NextResponse } from 'next/server';

import { validateCloneReferenceBuffer } from '@/lib/cloned-voice-audio';
import { engineBaseUrl } from '@/lib/engine-proxy';
import { logger } from '@/lib/logger';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { engineAuthHeaders, requireSupabaseSession } from '@/lib/request-auth';

//---------------
// POST /api/persona/cloned-voices/clean-preview — proxy of the engine's
// reference-audio cleaning (denoise chain) for the picker's A/B preview.
// Returns the cleaned WAV (audio/wav); nothing is stored upstream.
//---------------

const POST_ROUTE = 'POST /api/persona/cloned-voices/clean-preview';

async function postHandler(request: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) {
    return authError;
  }

  const limited = await applyRateLimit(request, RATE_LIMITS.voiceCloneCleanPreview, auth.userId);
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
  const file = fileEntry as File;
  const buffer = Buffer.from(await file.arrayBuffer());
  // Fast pre-check only (magic bytes/size): the engine's ffmpeg decode
  // is the authoritative validation and re-checks everything.
  const validation = validateCloneReferenceBuffer(buffer);
  if (!validation.ok) {
    return NextResponse.json({ success: false, error: validation.error }, { status: 400 });
  }

  let baseUrl: string;
  try {
    baseUrl = engineBaseUrl();
  } catch (error) {
    logger.error('[api/persona/cloned-voices/clean-preview] env missing', error);
    return NextResponse.json({ success: false, error: 'Configuration error.' }, { status: 500 });
  }

  const upstreamForm = new FormData();
  upstreamForm.set(
    'file',
    new Blob([buffer], { type: file.type || 'application/octet-stream' }),
    file.name || 'reference.bin',
  );

  try {
    const upstream = await fetch(`${baseUrl}/api/v1/cloned-voices/clean-preview`, {
      method: 'POST',
      headers: engineAuthHeaders(auth.userId),
      body: upstreamForm,
    });
    if (!upstream.ok) {
      logger.error('[api/persona/cloned-voices/clean-preview] upstream error', undefined, {
        status: upstream.status,
      });
      return NextResponse.json(
        { success: false, error: 'Could not clean the reference audio.' },
        { status: upstream.status === 400 ? 400 : 502 },
      );
    }
    const audio = await upstream.arrayBuffer();
    return new NextResponse(audio, {
      status: 200,
      headers: {
        'Content-Type': upstream.headers.get('content-type') ?? 'audio/wav',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    logger.error('[api/persona/cloned-voices/clean-preview] unreachable', error);
    return NextResponse.json({ success: false, error: 'Clean preview service unreachable.' }, { status: 502 });
  }
}

export const POST = withApiErrorReporting(POST_ROUTE, postHandler, {
  getUserId: resolveReportingUserId,
});
